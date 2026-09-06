/**
 * What our record with each GC actually is, derived from BidInvitation.
 *
 * /bids already lists invitations one per row and filters them. This
 * answers the relationship question instead: who invites us, what do we
 * do with it, and how often does it turn into work. Nothing here is
 * stored -- every number is computed from the rows at read time, so a
 * status corrected on /bids moves these figures with it.
 *
 * BidInvitation belongs to the estimating lane. This module READS it and
 * writes nothing.
 */

export type BidStatus = "INVITED" | "SUBMITTED" | "WON" | "LOST" | "DECLINED";

export interface PipelineBid {
  status: BidStatus;
  /** Null when nobody recorded a number. NOT zero -- see valueWon. */
  bidAmount: number | null;
  /** ISO date at UTC midnight, or null when the GC gave no deadline. */
  dueDate: string | null;
}

export interface GcRecord {
  /** Every invitation on file, whatever became of it. */
  invited: number;
  /** We put a number in front of them: SUBMITTED, WON or LOST. */
  bid: number;
  won: number;
  lost: number;
  /** We chose not to bid. Deliberately NOT counted as a loss. */
  declined: number;
  /** Still live: INVITED or SUBMITTED. */
  outstanding: number;
  /** Outstanding AND past the date the GC asked for. */
  overdue: number;
  /**
   * won / (won + lost), or null when nothing has been decided yet.
   *
   * Null rather than 0 is the whole point: a GC who has invited us three
   * times with every bid still open has NOT got a 0% win rate, and a
   * table that prints one is inviting somebody to drop a good customer.
   */
  winRate: number | null;
  /** Summed bidAmount across WON bids. */
  valueWon: number;
  /**
   * How many WON bids had no amount recorded. When this is above zero,
   * valueWon is a floor and not a total, and whatever renders it must
   * say so -- a partial sum shown as a total is the same defect as
   * printing $0.00 for hours nobody priced.
   */
  valueWonUnpriced: number;
}

const LIVE: BidStatus[] = ["INVITED", "SUBMITTED"];

/** Whether a bid is still waiting on somebody. */
export function isLive(bid: { status: BidStatus }): boolean {
  return LIVE.includes(bid.status);
}

/** Live, and the date the GC asked for has passed. Dates are compared as
 * ISO strings because both are UTC-midnight days -- no timezone maths, and
 * no Date objects whose local rendering could shift the day. */
export function isOverdue(bid: PipelineBid, today: string): boolean {
  return isLive(bid) && bid.dueDate !== null && bid.dueDate < today;
}

export function summariseGc(bids: PipelineBid[], today: string): GcRecord {
  const count = (s: BidStatus) => bids.filter((b) => b.status === s).length;

  const won = count("WON");
  const lost = count("LOST");
  const decided = won + lost;

  const wonBids = bids.filter((b) => b.status === "WON");

  return {
    invited: bids.length,
    bid: count("SUBMITTED") + won + lost,
    won,
    lost,
    declined: count("DECLINED"),
    outstanding: bids.filter(isLive).length,
    overdue: bids.filter((b) => isOverdue(b, today)).length,
    winRate: decided === 0 ? null : won / decided,
    valueWon: wonBids.reduce((sum, b) => sum + (b.bidAmount ?? 0), 0),
    valueWonUnpriced: wonBids.filter((b) => b.bidAmount === null).length,
  };
}

/** True when valueWon is a floor rather than a total. */
export function valueIsPartial(record: GcRecord): boolean {
  return record.valueWonUnpriced > 0;
}

/**
 * Most worth attention first: whoever we owe a response to soonest, then
 * by how much work is genuinely live. A GC with nothing outstanding sorts
 * below one with something open regardless of history, because this list
 * is for deciding what to do today, not for admiring a win rate.
 */
export function rankGcs<T extends { record: GcRecord }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.record.overdue !== b.record.overdue) return b.record.overdue - a.record.overdue;
    if (a.record.outstanding !== b.record.outstanding) {
      return b.record.outstanding - a.record.outstanding;
    }
    return b.record.invited - a.record.invited;
  });
}

/** Reads as a percentage, or says plainly that there is nothing to divide. */
export function winRateLabel(record: GcRecord): string {
  if (record.winRate === null) return "no decided bids yet";
  return `${Math.round(record.winRate * 100)}%`;
}

/**
 * The won-value line, as words: the figure, and what the figure left out.
 *
 * A function rather than markup in a page, because this is the sentence the
 * defect lived in and a sentence assembled inline in JSX has nowhere for a
 * test to reach it. Two separate mistakes are being fixed here and only the
 * first is arithmetic:
 *
 *  - /bids summed only the PRICED won bids and called the result the total.
 *  - and it rendered the line only when at least one won bid had a price on
 *    it. So a company whose won bids are ALL unpriced saw no line at all —
 *    and an absent line reads as "no won bids", which is the opposite of
 *    what is true. Returning null is reserved for genuinely having won
 *    nothing.
 *
 * Split into two strings so a renderer can colour the caveat without
 * rebuilding the wording, which is how the two pages drifted apart in the
 * first place.
 */
export function wonValueSummary(
  record: GcRecord,
  formatMoney: (value: number) => string,
): { headline: string; unpricedNote: string | null } | null {
  if (record.won === 0) return null;

  const headline = `${formatMoney(record.valueWon)} in ${record.won} won ${
    record.won === 1 ? "bid" : "bids"
  }`;

  if (!valueIsPartial(record)) return { headline, unpricedNote: null };

  return {
    headline,
    unpricedNote: `at least — ${record.valueWonUnpriced} won ${
      record.valueWonUnpriced === 1 ? "bid has" : "bids have"
    } no amount recorded`,
  };
}
