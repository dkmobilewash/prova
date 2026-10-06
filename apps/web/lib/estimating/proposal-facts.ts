/**
 * WHAT THE SCOPE LETTER IS SILENT ABOUT.
 *
 * A sub's proposal is a risk document and its expensive failure is SILENCE. If
 * Division 09 demands Level 5 at the lobbies and the letter does not mention it,
 * the GC assumes it was priced. If Division 01 restricts work to night shift and
 * the letter says nothing, the sub eats the premium. The price is one line; the
 * letter decides who pays when the GC says "that was your scope".
 *
 * So this module is not a writer. It gathers the facts the app ALREADY KNOWS
 * about this bid, each one citable, and returns the ones no draft has answered
 * yet. A model then writes one sentence per gap — it decides nothing about which
 * facts exist, and it is given a citation it must not exceed.
 *
 * ── COVERAGE IS DECLARED, NEVER INFERRED ──
 *
 * A fact is answered when a DRAFT FOR ITS `ref` exists, not when some clause
 * happens to contain the words "Level 5". Text matching would be the one thing
 * this repo refuses everywhere else — `costCategory`, `craftClassificationId`,
 * the takeoff recipes and `estimate-crosschecks.ts` all take a declared value
 * over a read one. It also fails in the direction that costs money: a clause
 * reading "Level 5 finish is NOT included" contains the same words as one
 * reading "Level 5 finish IS included", and a coverage check built on the words
 * cannot tell those apart.
 *
 * A fact with a draft in ANY status — accepted or dismissed — is not proposed
 * again. That is what makes this a tool rather than a nag.
 *
 * ── WHAT CODE CAN AND CANNOT KNOW ABOUT "WAS IT PRICED" ──
 *
 * This is the line the whole design turns on, and it is not the same for every
 * fact:
 *
 *   `MISSING_INDIRECT`  — KNOWABLE. `missingIndirects` is a declared check
 *                         over `JobLineItem.indirectKind`, so "no dumpster line
 *                         exists" is a fact, not a reading.
 *   `CARRIED_PACKAGE`   — KNOWABLE. `estimate-crosschecks.ts` already matches a
 *                         carried quote to a line by exact description or by
 *                         cost to the cent.
 *   `SPEC_FINDING`      — NOT KNOWABLE, and pretending otherwise would be the
 *                         cry-wolf failure with a legal document attached.
 *                         Matching "Level 5 finish at public areas" to a line
 *                         item means reading line text for meaning. So the fact
 *                         carries `priced: null`, and the draft offers BOTH an
 *                         inclusion and an exclusion for the estimator to pick.
 *
 * `priced` is therefore `boolean | null` and the null is load-bearing. Nothing
 * downstream may treat it as false.
 */

export const PROPOSAL_FACT_KINDS = [
  "SPEC_FINDING",
  "MISSING_INDIRECT",
  "CARRIED_PACKAGE",
  "ADDENDA_BASIS",
  "DRAWING_BASIS",
] as const;

export type ProposalFactKind = (typeof PROPOSAL_FACT_KINDS)[number];

export type ProposalFact = {
  kind: ProposalFactKind;
  /**
   * Stable across re-runs, because it is what coverage is keyed on. A ref that
   * changed between reads would re-propose a fact somebody had already
   * dismissed — which is precisely the nagging this design exists to avoid.
   */
  ref: string;
  /** What code knows, in its own words. The model may not exceed this. */
  summary: string;
  /** The sentence it was read from and where, when there is one. A clause a GC
   *  can challenge is worth more than one nobody can check. */
  citation: string | null;
  /** True/false only where it is KNOWABLE — see the header. Never coerce the
   *  null to false. */
  priced: boolean | null;
};

/** A spec finding as `findingsFromJson` returns it, narrowed to what matters. */
export type FactSpecFinding = {
  ordinal: number;
  label: string;
  requirement: string;
  quote: string;
  sourcePageLabel: string | null;
};

/** One spec reading on this bid. */
export type FactSpecReading = {
  id: string;
  /** "09 21 16", as printed. Null when the document did not say. */
  sectionNumber: string | null;
  findings: readonly FactSpecFinding[];
};

/** A `missingIndirects` result, narrowed. */
export type FactMissingIndirect = {
  kind: string;
  label: string;
  covers: string;
};

/** A carried quote whose cost nothing on the estimate carries — the shape
 *  `estimate-crosschecks.ts` already computes. */
export type FactCarriedPackage = {
  id: string;
  vendorName: string;
  packageLabel: string;
};

/** The addenda this bid was priced against. */
export type FactAddenda = {
  /** "1", "2", "ASI-3" — as the GC numbered them, in order. */
  references: readonly string[];
};

/** The drawing set the quantities were measured from. */
export type FactDrawingBasis = {
  /** The sheet set's own name or revision, as printed. */
  label: string;
  /** The date it was issued, as the drawing states it. Null when it does not. */
  issuedOn: string | null;
};

/** A draft already raised for a fact, in any status. */
export type ExistingDraft = { factRef: string };

export type ProposalFactsInput = {
  specReadings: readonly FactSpecReading[];
  missingIndirects: readonly FactMissingIndirect[];
  carriedPackages: readonly FactCarriedPackage[];
  addenda: FactAddenda | null;
  drawingBasis: FactDrawingBasis | null;
  /** Every draft on this job, whatever its status. */
  drafts: readonly ExistingDraft[];
};

/**
 * Every fact this bid carries, before coverage is considered.
 *
 * Exported separately from `uncoveredFacts` so a screen can say "nine facts,
 * six of them already answered" rather than only showing a count of gaps. A
 * panel that can only count what is missing cannot tell "you have answered
 * everything" from "there was never anything to answer", and those are
 * different sentences.
 */
export function proposalFacts(input: ProposalFactsInput): ProposalFact[] {
  const facts: ProposalFact[] = [];

  for (const reading of input.specReadings) {
    for (const finding of reading.findings) {
      const section = reading.sectionNumber;
      facts.push({
        kind: "SPEC_FINDING",
        // The reading id and the finding's own ordinal. Stable across a
        // re-render and across a page reload; a NEW reading of the same
        // section is a new id and legitimately a new fact, because somebody
        // re-read the document and may have got a different answer.
        ref: `${reading.id}:${finding.ordinal}`,
        summary: section === null ? finding.requirement : `${section} requires: ${finding.requirement}`,
        citation: citationOf(finding, section),
        // NOT KNOWABLE. See the header.
        priced: null,
      });
    }
  }

  for (const indirect of input.missingIndirects) {
    facts.push({
      kind: "MISSING_INDIRECT",
      ref: `indirect:${indirect.kind}`,
      summary: `Nothing on the estimate carries ${indirect.label.toLowerCase()} (${indirect.covers}).`,
      // No document said this. It is a fact about OUR estimate, and inventing a
      // citation for it would make a derived check look like a quotation.
      citation: null,
      priced: false,
    });
  }

  for (const pkg of input.carriedPackages) {
    facts.push({
      kind: "CARRIED_PACKAGE",
      ref: `quote:${pkg.id}`,
      summary: `${pkg.packageLabel} is carried from ${pkg.vendorName}'s quote.`,
      citation: null,
      priced: true,
    });
  }

  if (input.addenda !== null && input.addenda.references.length > 0) {
    facts.push({
      kind: "ADDENDA_BASIS",
      // ONE fact for all of them, not one per addendum: the letter says "based
      // on Addenda 1 through 5" in a single clause, and five clauses saying one
      // each is noise on a document somebody reads in two minutes.
      //
      // The ref carries the LIST, so issuing Addendum 6 produces a new fact and
      // the letter gets updated rather than quietly staying wrong.
      ref: `addenda:${input.addenda.references.join(",")}`,
      summary: `This bid is priced on ${listOf(input.addenda.references.map((r) => `Addendum ${r}`))}.`,
      citation: null,
      priced: true,
    });
  }

  if (input.drawingBasis !== null) {
    facts.push({
      kind: "DRAWING_BASIS",
      ref: `drawings:${input.drawingBasis.label}:${input.drawingBasis.issuedOn ?? "undated"}`,
      summary:
        input.drawingBasis.issuedOn === null
          ? `Quantities were measured from ${input.drawingBasis.label}.`
          : `Quantities were measured from ${input.drawingBasis.label}, issued ${input.drawingBasis.issuedOn}.`,
      citation: null,
      priced: true,
    });
  }

  return facts;
}

/**
 * The facts no draft has answered.
 *
 * ANY STATUS COUNTS AS ANSWERED. A dismissed fact stays dismissed — the
 * estimator has read it and decided it does not belong on the letter, and
 * re-proposing it next time would make the panel something people learn to
 * ignore. `bid-responsiveness.ts`'s posture applied to a draft queue.
 */
export function uncoveredFacts(input: ProposalFactsInput): ProposalFact[] {
  const answered = new Set(input.drafts.map((draft) => draft.factRef));
  return proposalFacts(input).filter((fact) => !answered.has(fact.ref));
}

/** The quote and where to find it, as one checkable string. */
function citationOf(finding: FactSpecFinding, section: string | null): string | null {
  const quote = finding.quote.trim();
  if (quote.length === 0) return null;
  const where = [section, finding.sourcePageLabel].filter((part): part is string => part !== null && part !== "");
  return where.length === 0 ? `“${quote}”` : `“${quote}” — ${where.join(", ")}`;
}

/** "A", "A and B", "A, B and C" — the app's own list voice. */
function listOf(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
