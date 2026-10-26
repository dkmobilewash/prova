import { lineWrite, type LineUpdate } from "@/lib/estimating/price-refresh";

/**
 * "YOU PRICED A 6" 1-HR WALL ON CIVIC CENTER ANNEX IN SEPTEMBER. USE THAT?" —
 * the pure half. No database, no clock: everything arrives as arguments, so the
 * rules below are tests rather than prose. `./pastPrice.ts` loads the rows;
 * `lib/actions/bidGuidePastPrice.ts` writes.
 *
 * ── WHAT "THE SAME WALL TYPE" MEANS HERE ──
 *
 * `WallType` is a COMPANY-level library row (`@@unique([companyId, code])`), so
 * the wall type's own id is the identity and it is the same row on every job.
 * A wall type is not one line, though: it is an assembly, and the estimate
 * carries one line PER COMPONENT (board, studs, track, hang-and-finish), each
 * linked back by `JobLineItem.wallTypeComponentId`, each with its own unit. So
 * a "wall type" suggestion is a SET of parts, one per unpriced component line,
 * and each part is matched against the same component on the past job.
 *
 * A line that came from the price book and belongs to no wall type is matched
 * by `sourceCatalogEntryId` instead. Two identity kinds, nothing fuzzier: no
 * description matching, no "looks similar" (the rule `lib/estimating` already
 * states for costCategory and craft — declared, never inferred).
 *
 * ── THE RULES ──
 *
 *  1. UNPRICED = carries neither a unit price nor a unit cost. A line with a
 *     cost and no price is a priced line the recap has not marked up.
 *  2. A SOURCE LINE is live (not soft-deleted), on ANOTHER job, and carries a
 *     cost or a price that is more than zero (a 0 is a placeholder, not a bid).
 *  3. THE UNIT MUST AGREE. A source line whose unit differs from the target
 *     line's (case and spaces aside; blank equals blank) is skipped, never
 *     converted — $2.10 per SF is not $2.10 per LF.
 *  4. A JOB QUALIFIES only if it can price EVERY unpriced line of the type.
 *     Half a wall priced from September and half still blocking is not the
 *     one click the guide promised.
 *  5. THE LATEST QUALIFYING JOB WINS, by `updatedAt`. The schema records no
 *     "priced on" date, so `updatedAt` of the line that supplies the figure is
 *     the nearest honest thing: it is when anybody last touched that price. It
 *     also moves when a re-sync rewrites a quantity, so it means "last worked
 *     on", not "last priced" — which is why the label says the month and not a
 *     day. A job's date is the NEWEST of its supplying lines; a tie goes to the
 *     newer job (`createdAt`), then to the lower id, so the answer is stable.
 *  6. THE RECAP RULE, copied from `price-refresh.ts`: once the bid recap has
 *     been applied the unit prices are a spread of the marked-up bid, so only
 *     COST moves. The price is not written, and the token (below) says so.
 *
 * ── THE TOKEN ──
 *
 * What a confirmation vouches for is the exact set of writes, as in
 * `updateToken`: each target line with the cost and price it would take. It
 * travels inside `actionArg`, the server recomputes it, and a mismatch is
 * "stale".
 */

export type PastPriceIdentity = "wallType" | "catalog";

/** A live line on the job being guided that has no price and no cost. */
export type UnpricedTarget = {
  lineId: string;
  description: string;
  unit: string | null;
  /** "wt:<wallTypeId>" or "ce:<catalogEntryId>" — the group it belongs to. */
  groupKey: string;
  /** What a past line must carry to be "the same part": the wall type
   *  component id, or the catalog entry id. */
  partKey: string;
};

/** What the loader knows about a group, for words. */
export type GroupInfo = {
  groupKey: string;
  kind: PastPriceIdentity;
  /** The wall type's code ("W2"), or null for a price-book item. */
  code: string | null;
  /** The wall type's name, or the catalog entry's description. */
  name: string;
};

/** A live line on some OTHER job, with the figures it carries. */
export type PastLine = {
  lineId: string;
  jobId: string;
  jobName: string;
  jobCreatedAt: Date;
  partKey: string;
  groupKey: string;
  unit: string | null;
  unitCost: number | null;
  unitPrice: number | null;
  updatedAt: Date;
  isDeleted: boolean;
};

export type PastPricePart = {
  lineId: string;
  description: string;
  unit: string | null;
  /** From the past line. */
  unitCost: number | null;
  /** From the past line, shown even when the recap holds it back. */
  unitPrice: number | null;
  /** The past line the figures came from. */
  fromLineId: string;
};

export type PastPriceSuggestion = {
  /** "W2", or null for a price-book item. */
  wallTypeCode: string | null;
  wallTypeId?: string;
  catalogEntryId?: string;
  /** "W2 — 6\" 1-HR". */
  label: string;
  fromJobId: string;
  fromJobName: string;
  /** "September", or "September 2025" when it is not this year. */
  whenLabel: string;
  /**
   * HEADLINE FIGURES: the first part's. A wall type with one unpriced
   * component (the usual case once the price book is mostly filled in) has
   * exactly one and these ARE the suggestion. With several, `parts` is the
   * truth and these are only the first one — do not sum them across units.
   */
  unitCost: number | null;
  unitPrice: number | null;
  unit: string | null;
  /** Every line that would be written, with its figures. */
  parts: PastPricePart[];
  /** True when the recap has been applied, so unit prices will not be written. */
  priceHeldForRecap: boolean;
  /**
   * The ONE string the guide hands back to `usePastPrice` as `arg`:
   * `<groupKey>:<token>`, e.g. `wt:ckx…:3f9a1c2b`. See `parsePastPriceArg`.
   */
  actionArg: string;
};

const cents = (n: number) => Math.round(n * 100);
export const unitKey = (u: string | null) => (u ?? "").trim().toLowerCase();
const carries = (n: number | null) => n != null && n > 0;

/** What one target line would take from one past line (cents), or null when
 * there is nothing to write — a price-only source under a held recap. */
function writeOf(source: Pick<PastLine, "unitCost" | "unitPrice">, recapApplied: boolean) {
  const cost = carries(source.unitCost) ? cents(source.unitCost as number) : null;
  const price = !recapApplied && carries(source.unitPrice) ? cents(source.unitPrice as number) : null;
  return cost == null && price == null ? null : { cost, price };
}

/** FNV-1a, 32 bits, hex. A fingerprint for staleness, not a security token:
 * the server recomputes it and nothing is trusted from it but equality. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The token over a set of writes. Sorted, so order never matters. */
export function pastPriceToken(
  fromJobId: string,
  writes: readonly { lineId: string; cost: number | null; price: number | null }[],
): string {
  const body = writes
    .map((w) => `${w.lineId}:${w.cost ?? "-"}:${w.price ?? "-"}`)
    .sort()
    .join("|");
  return fingerprint(`${fromJobId}|${body}`);
}

/**
 * THE ARG CONTRACT. `arg` is `<kind>:<id>:<token>`:
 *   kind  "wt" (a WallType id) or "ce" (a LineItemCatalogEntry id)
 *   id    that row's id (cuids contain no colon)
 *   token the figures the person was shown, from `pastPriceToken`
 * Returns null for anything else.
 */
export function parsePastPriceArg(arg: unknown): { groupKey: string; token: string } | null {
  if (typeof arg !== "string") return null;
  const m = /^(wt|ce):([A-Za-z0-9_-]{1,64}):([0-9a-f]{8})$/.exec(arg.trim());
  return m ? { groupKey: `${m[1]}:${m[2]}`, token: m[3] } : null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "September", or "September 2025" when the year is not `now`'s. UTC, like every date here. */
export function whenLabelOf(when: Date, now: Date): string {
  const month = MONTHS[when.getUTCMonth()];
  return when.getUTCFullYear() === now.getUTCFullYear() ? month : `${month} ${when.getUTCFullYear()}`;
}

/**
 * The exact writes for one suggestion, ready for `tx.jobLineItem.update`.
 * Reuses `lineWrite` from price-refresh so the forecast column follows the
 * cost by the same rule.
 */
export function writesFor(suggestion: PastPriceSuggestion) {
  return suggestion.parts.map((part) => {
    const cost = carries(part.unitCost) ? (part.unitCost as number) : null;
    const price = !suggestion.priceHeldForRecap && carries(part.unitPrice) ? (part.unitPrice as number) : null;
    const update: LineUpdate = {
      lineId: part.lineId,
      description: part.description,
      quantity: 0,
      unit: part.unit,
      cost: cost == null ? null : { old: null, next: cost },
      price: price == null ? null : { old: null, next: price },
      costEffect: 0,
      priceEffect: 0,
    };
    // The target is unpriced by definition, so there is no forecast to protect:
    // `currentEstimatedUnitCost` null follows the cost.
    return { lineId: part.lineId, data: lineWrite(update, { budgetedUnitCost: null, currentEstimatedUnitCost: null }) };
  });
}

export function suggestPastPrices(input: {
  /** The job being guided. Its own lines are never a source. */
  jobId: string;
  targets: readonly UnpricedTarget[];
  groups: readonly GroupInfo[];
  history: readonly PastLine[];
  recapApplied: boolean;
  now: Date;
}): PastPriceSuggestion[] {
  const { jobId, targets, groups, history, recapApplied, now } = input;
  const groupInfo = new Map(groups.map((g) => [g.groupKey, g]));
  const targetsByGroup = new Map<string, UnpricedTarget[]>();
  for (const target of targets) {
    const list = targetsByGroup.get(target.groupKey) ?? [];
    list.push(target);
    targetsByGroup.set(target.groupKey, list);
  }

  const usable = history.filter(
    (line) => !line.isDeleted && line.jobId !== jobId && (carries(line.unitCost) || carries(line.unitPrice)),
  );

  const out: PastPriceSuggestion[] = [];
  for (const [groupKey, groupTargets] of targetsByGroup) {
    const info = groupInfo.get(groupKey);
    if (!info) continue;

    const sources = usable.filter((line) => line.groupKey === groupKey);
    const jobIds = [...new Set(sources.map((line) => line.jobId))];

    type Candidate = {
      jobId: string;
      jobName: string;
      jobCreatedAt: Date;
      pricedAt: Date;
      parts: (PastPricePart & { cost: number | null; price: number | null })[];
    };
    const candidates: Candidate[] = [];

    for (const candidateJobId of jobIds) {
      const mine = sources.filter((line) => line.jobId === candidateJobId);
      const parts: Candidate["parts"] = [];
      let pricedAt = 0;
      let covered = true;
      for (const target of groupTargets) {
        // Same part, same unit, something to write; the newest such line.
        const match = mine
          .filter(
            (line) =>
              line.partKey === target.partKey &&
              unitKey(line.unit) === unitKey(target.unit) &&
              writeOf(line, recapApplied) != null,
          )
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.lineId < b.lineId ? -1 : 1))[0];
        if (!match) {
          covered = false;
          break;
        }
        const w = writeOf(match, recapApplied)!;
        pricedAt = Math.max(pricedAt, match.updatedAt.getTime());
        parts.push({
          lineId: target.lineId,
          description: target.description,
          unit: target.unit,
          unitCost: match.unitCost,
          unitPrice: match.unitPrice,
          fromLineId: match.lineId,
          cost: w.cost,
          price: w.price,
        });
      }
      if (!covered) continue;
      candidates.push({
        jobId: candidateJobId,
        jobName: mine[0].jobName,
        jobCreatedAt: mine[0].jobCreatedAt,
        pricedAt: new Date(pricedAt),
        parts,
      });
    }

    candidates.sort(
      (a, b) =>
        b.pricedAt.getTime() - a.pricedAt.getTime() ||
        b.jobCreatedAt.getTime() - a.jobCreatedAt.getTime() ||
        (a.jobId < b.jobId ? -1 : 1),
    );
    const best = candidates[0];
    if (!best) continue;

    const token = pastPriceToken(
      best.jobId,
      best.parts.map((p) => ({ lineId: p.lineId, cost: p.cost, price: p.price })),
    );
    const first = best.parts[0];
    const id = groupKey.slice(3);
    out.push({
      wallTypeCode: info.code,
      ...(info.kind === "wallType" ? { wallTypeId: id } : { catalogEntryId: id }),
      label: info.code ? `${info.code} — ${info.name}` : info.name,
      fromJobId: best.jobId,
      fromJobName: best.jobName,
      whenLabel: whenLabelOf(best.pricedAt, now),
      unitCost: first.unitCost,
      unitPrice: first.unitPrice,
      unit: first.unit,
      parts: best.parts.map((p) => ({
        lineId: p.lineId,
        description: p.description,
        unit: p.unit,
        unitCost: p.unitCost,
        unitPrice: p.unitPrice,
        fromLineId: p.fromLineId,
      })),
      priceHeldForRecap: recapApplied,
      actionArg: `${groupKey}:${token}`,
    });
  }

  // Stable order for the guide: by label.
  return out.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}
