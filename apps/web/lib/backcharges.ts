// Backcharge exposure math — what a GC's deductions are costing us.
//
// Pure arithmetic over rows handed in, no database and no LLM call, same
// reasoning as lib/retainage.ts and lib/wip.ts: these are numbers someone
// will quote in a negotiation, so they have to be reproducible from the
// source rows every time rather than cached anywhere.
//
// The rule this module exists to hold: the amount we actually concede on a
// backcharge is DERIVED from its status, never stored twice. Accepting a
// claim in full concedes exactly `claimedAmount`, which the row already
// carries; a withdrawal concedes nothing. Only a settlement produces a
// figure no other column can give you, and that is the only case with a
// column of its own.

export const BACKCHARGE_STATUSES = [
  "RECEIVED",
  "DISPUTED",
  "ACCEPTED",
  "SETTLED",
  "WITHDRAWN",
] as const;

export type BackchargeStatusValue = (typeof BACKCHARGE_STATUSES)[number];

/** The shape every function here reads. Structurally what the page's query
 * returns, so the sums can be tested without a database. */
export type BackchargeAmounts = {
  status: string;
  claimedAmount: number;
  /** Only meaningful on a SETTLED row. Null everywhere else. */
  resolvedAmount: number | null;
};

/** Unresolved means the money is still in play — we either haven't answered
 * or we have and the GC hasn't. Both are exposure. */
export function isUnresolved(status: string): boolean {
  return status === "RECEIVED" || status === "DISPUTED";
}

/**
 * What this backcharge finally cost us, or null when that isn't known yet.
 *
 * Null has two distinct causes and the caller must not collapse them into
 * zero:
 *
 *   - The backcharge is unresolved. Nothing has been conceded yet, but the
 *     claim is live — `claimedAmount` is the exposure, not $0.
 *   - It is SETTLED and no settled figure was recorded. That is a data gap.
 *     Guessing the claimed amount would overstate what we paid and guessing
 *     zero would understate it, so it reports as uncomputed instead — the
 *     same rule lib/labor-cost.ts follows for an entry with no rate
 *     schedule effective on its date.
 */
export function concededAmount(backcharge: BackchargeAmounts): number | null {
  switch (backcharge.status) {
    case "ACCEPTED":
      return backcharge.claimedAmount;
    case "WITHDRAWN":
      return 0;
    case "SETTLED":
      return backcharge.resolvedAmount;
    default:
      return null;
  }
}

export interface BackchargeSummary {
  /** Claimed on backcharges nobody has resolved. Money still at risk. */
  openClaimed: number;
  /** Claimed on the subset we have formally objected to. */
  disputedClaimed: number;
  /** What resolved backcharges actually cost, settlements included. */
  concededTotal: number;
  /**
   * Claimed minus conceded across resolved backcharges — what arguing them
   * saved. Never negative: a settlement above the claim would be a new
   * backcharge, not this one growing.
   */
  avoidedTotal: number;
  openCount: number;
  resolvedCount: number;
  /**
   * Resolved rows whose conceded amount could not be computed (a SETTLED
   * row with no figure recorded). Counted rather than guessed, so a total
   * built from incomplete data says so instead of quietly reading low.
   */
  unknownConcededCount: number;
}

export function summarizeBackcharges(rows: BackchargeAmounts[]): BackchargeSummary {
  const summary: BackchargeSummary = {
    openClaimed: 0,
    disputedClaimed: 0,
    concededTotal: 0,
    avoidedTotal: 0,
    openCount: 0,
    resolvedCount: 0,
    unknownConcededCount: 0,
  };

  for (const row of rows) {
    if (isUnresolved(row.status)) {
      summary.openCount += 1;
      summary.openClaimed += row.claimedAmount;
      if (row.status === "DISPUTED") {
        summary.disputedClaimed += row.claimedAmount;
      }
      continue;
    }

    summary.resolvedCount += 1;
    const conceded = concededAmount(row);
    if (conceded === null) {
      summary.unknownConcededCount += 1;
      continue;
    }
    summary.concededTotal += conceded;
    summary.avoidedTotal += Math.max(0, row.claimedAmount - conceded);
  }

  return summary;
}

/**
 * Past the contractual deadline to object, and still not having objected.
 *
 * Derived from the dates on every render, never stored — a stored flag is
 * wrong the day after it is written. Only a RECEIVED backcharge can be
 * late: disputing, accepting, settling or seeing it withdrawn are all
 * responses, and a response after the deadline is still a response that
 * happened.
 *
 * `today` is passed in from the server so the server and the browser can't
 * disagree about what day it is — the same reason rfiLabels.isOverdue takes
 * one. A backcharge with no deadline recorded is never late: we do not know
 * of one, which is not the same as there being none.
 */
export function isResponseOverdue(
  backcharge: { status: string; respondByDate: string | null },
  today: string,
): boolean {
  return (
    backcharge.status === "RECEIVED" &&
    !!backcharge.respondByDate &&
    backcharge.respondByDate < today
  );
}

/**
 * Days left to object, negative once the deadline has passed, null when
 * there is no deadline recorded or we have already responded.
 */
export function daysToRespond(
  backcharge: { status: string; respondByDate: string | null },
  today: string,
): number | null {
  if (backcharge.status !== "RECEIVED" || !backcharge.respondByDate) return null;
  const ms =
    Date.parse(`${backcharge.respondByDate}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}
