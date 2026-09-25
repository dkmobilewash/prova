/**
 * What would get this bid thrown out before anybody read the number.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THERE IS NO "COMPLIANT" VERDICT IN THIS FILE, AND THAT IS DELIBERATE.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Every other estimating module makes the number better. This one is about
 * the bid being READ at all: an Invitation to Bid carries requirements, and a
 * bid that misses one is non-responsive — rejected unread, however good the
 * price. That is worse than losing, because losing at least tells you your
 * price was high.
 *
 * So the shape here is `outstanding`, never `ready`. Nothing returns a green
 * tick. The screen can say "four things outstanding" or "nothing outstanding
 * that this app can see", and the second sentence is doing real work: this
 * app has never read the GC's actual ITB. It knows what somebody typed in.
 * A tick that read "compliant" would be a claim about a document nobody here
 * has seen, on the one screen where being wrong costs the whole bid.
 *
 * DERIVED VERSUS RECORDED, which is the other half of the design.
 *
 *   DERIVED, every time, never stored: an ALTERNATE with no amount, a
 *   UNIT_PRICE with no rate, an addendum with no acknowledgement. The data
 *   already answers these, so a stored "satisfied" flag could only disagree
 *   with it — tick "all alternates priced", add an unpriced alternate, keep
 *   the tick. `BidRequirementKind` deliberately has no member for any of
 *   them.
 *
 *   RECORDED, because nothing in the data could know: was the bond actually
 *   obtained, the form actually signed, the certificate actually attached.
 *   A person attests those with a date.
 *
 * Pure. No database, no React.
 */

import type { BidLineInput } from "@/lib/bid-lines";

/** A bid line plus its row id.
 *
 * `BidLineInput` deliberately carries no id — `bidTotals` sums and never
 * needs to point at a row. This file DOES: every outstanding item names the
 * thing to go and fix, so the screen can link to it. Extended rather than
 * redefined, so the two cannot drift about what a bid line is. */
export type ResponsivenessLine = BidLineInput & { id: string };

export type AddendumInput = {
  id: string;
  /** As the GC wrote it — "Addendum 3", "ASI 2". Never parsed. */
  reference: string;
  issuedOn: string | null;
  /** Null means not acknowledged. That null is the point of the model. */
  acknowledgedOn: string | null;
  affectsPricedScope: boolean;
  impactNote: string | null;
};

export type RequirementInput = {
  id: string;
  kind: string;
  label: string;
  required: boolean;
  satisfiedOn: string | null;
};

/** One thing standing between this bid and being read. */
export type Outstanding = {
  /** Stable enough to use as a React key and to test against. */
  key: string;
  /** What is wrong, in the estimator's language, naming the thing. */
  sentence: string;
  /** DERIVED items cannot be ticked — they go away when the data changes.
   * RECORDED ones are somebody's attestation. Shown differently, because
   * "go and price it" and "go and confirm you did it" are different jobs. */
  source: "DERIVED" | "RECORDED";
  /** An optional requirement that is outstanding is worth showing and is not
   * a reason to call the bid non-responsive. */
  blocking: boolean;
};

export type Responsiveness = {
  outstanding: Outstanding[];
  /** Blocking items only — the ones that would actually sink the bid. */
  blockingCount: number;
  /** Addenda that changed work already priced and have NOT been re-priced as
   * far as anybody has said. Reported separately because it is not a
   * paperwork failure, it is a number that may now be wrong. */
  repriceWarnings: string[];
};

const ordinal = (value: string) => value.trim() || "(unnamed)";

/**
 * Everything outstanding on one bid.
 *
 * `lines` and `addenda` drive the derived checks; `requirements` are the
 * attested ones. Ordering is deliberate — blocking first, then by how early
 * in the bid the work sits — because this list is read top-down by somebody
 * with an hour left before the due time.
 */
export function bidResponsiveness(input: {
  lines: ResponsivenessLine[];
  addenda: AddendumInput[];
  requirements: RequirementInput[];
}): Responsiveness {
  const outstanding: Outstanding[] = [];

  // ── DERIVED ──────────────────────────────────────────────────────────
  // An unacknowledged addendum is the single most common reason a complying
  // low bid is rejected, so it leads.
  for (const addendum of input.addenda) {
    if (addendum.acknowledgedOn === null) {
      outstanding.push({
        key: `addendum:${addendum.id}`,
        sentence: `${ordinal(addendum.reference)} has not been acknowledged. An unacknowledged addendum is the most common reason a low bid is thrown out.`,
        source: "DERIVED",
        blocking: true,
      });
    }
  }

  for (const line of input.lines) {
    if (line.kind === "ALTERNATE" && line.amount === null) {
      outstanding.push({
        key: `alternate:${line.id}`,
        sentence: `Alternate "${ordinal(line.label)}" has no price. A blank alternate makes the whole bid non-responsive, not just that line.`,
        source: "DERIVED",
        blocking: true,
      });
    }
    if (line.kind === "UNIT_PRICE" && line.unitPrice === null) {
      outstanding.push({
        key: `unit-price:${line.id}`,
        sentence: `Unit price "${ordinal(line.label)}" has no rate. The GC holds you to these for the life of the job.`,
        source: "DERIVED",
        blocking: true,
      });
    }
    if (line.kind === "ALLOWANCE" && line.amount === null) {
      outstanding.push({
        key: `allowance:${line.id}`,
        sentence: `Allowance "${ordinal(line.label)}" has no sum. It is carried INSIDE the base bid, so a blank one means the base is missing it.`,
        source: "DERIVED",
        blocking: true,
      });
    }
  }

  // ── RECORDED ─────────────────────────────────────────────────────────
  for (const requirement of input.requirements) {
    if (requirement.satisfiedOn === null) {
      outstanding.push({
        key: `requirement:${requirement.id}`,
        sentence: requirement.required
          ? `${ordinal(requirement.label)} — not recorded as done.`
          : `${ordinal(requirement.label)} — not recorded as done. Marked optional on this bid.`,
        source: "RECORDED",
        blocking: requirement.required,
      });
    }
  }

  // Blocking first. Within a group the input order is kept, which is the
  // order the caller sorted the rows in — addenda by issue date, lines by
  // the GC's own sequence. A stable sort is required for that to hold.
  const sorted = [...outstanding].sort((a, b) => Number(b.blocking) - Number(a.blocking));

  return {
    outstanding: sorted,
    blockingCount: sorted.filter((item) => item.blocking).length,
    repriceWarnings: input.addenda
      .filter((addendum) => addendum.affectsPricedScope)
      .map((addendum) =>
        addendum.impactNote
          ? `${ordinal(addendum.reference)} changed work you had already priced — ${addendum.impactNote}`
          : `${ordinal(addendum.reference)} changed work you had already priced.`,
      ),
  };
}

/**
 * The sentence to put at the top of the panel.
 *
 * NEVER "ready to submit". The best this can say is that nothing it can see
 * is outstanding, and it says exactly that — the app has not read the ITB,
 * it has read what somebody typed in from the ITB, and the difference is the
 * whole bid.
 */
export function responsivenessSentence(result: Responsiveness): string {
  if (result.blockingCount > 0) {
    const n = result.blockingCount;
    return `${n} thing${n === 1 ? "" : "s"} would make this bid non-responsive. A bid that misses one is rejected unread, whatever the price.`;
  }
  if (result.outstanding.length > 0) {
    return "Nothing outstanding that would sink the bid — but some optional items are still open. This app has only seen what was typed in from the ITB.";
  }
  return "Nothing outstanding that this app can see. It has not read the ITB itself, only what was typed in from it — check the form before you send.";
}

/** What is wrong with an addendum as typed, or null. */
export function addendumProblem(addendum: { reference: string }): string | null {
  if (!addendum.reference.trim()) {
    return "Say which addendum this is — whatever the GC called it, like “Addendum 3”.";
  }
  return null;
}

/** What is wrong with a requirement as typed, or null. */
export function requirementProblem(requirement: { label: string }): string | null {
  if (!requirement.label.trim()) {
    return "Say what the GC is asking for, in their words — that is what somebody has to go and satisfy.";
  }
  return null;
}
