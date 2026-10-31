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
  /**
   * The project this invitation is on was awarded (the PRIME contract) to a
   * DIFFERENT GC. Derived by the caller with `primeWentElsewhere`
   * (lib/bid-projects.ts), never stored. Absent means "no project / no award
   * recorded", which is NOT the same as true.
   *
   * Such a bid is neither a win nor a GC turning our price down, so it is out
   * of the win-rate denominator and out of "outstanding" / "overdue": nobody
   * owes us an answer on a job that went to someone else.
   */
  primeWentElsewhere?: boolean;
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
  /**
   * Bids on a project whose prime contract went to a different GC. Counted so
   * the number is visible, and deliberately NOT in `lost` or `winRate`.
   */
  primeElsewhere: number;
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
export function isLive(bid: { status: BidStatus; primeWentElsewhere?: boolean }): boolean {
  return LIVE.includes(bid.status) && bid.primeWentElsewhere !== true;
}

/** Live, and the date the GC asked for has passed. Dates are compared as
 * ISO strings because both are UTC-midnight days -- no timezone maths, and
 * no Date objects whose local rendering could shift the day. */
export function isOverdue(bid: PipelineBid, today: string): boolean {
  return isLive(bid) && bid.dueDate !== null && bid.dueDate < today;
}

export interface WonValueSummary {
  /** Summed bidAmount across WON bids. */
  valueWon: number;
  /** How many WON bids had no amount recorded -- see GcRecord.valueWonUnpriced
   * for what that implies about valueWon. */
  valueWonUnpriced: number;
}

/**
 * The money half of summariseGc, split out so a caller with no notion of
 * "today" -- no overdue or winRate to compute -- can get the same floor
 * arithmetic without fabricating one. /bids (issue #79) is exactly that
 * caller: it renders one page-wide total, not a per-GC record, and has no
 * due-date comparison to make.
 *
 * Deliberately takes a bare status+bidAmount shape rather than the full
 * PipelineBid, so a caller with no dueDate field (a plain BidInvitation row)
 * can pass its rows straight through.
 */
export function summariseWonValue(bids: { status: BidStatus; bidAmount: number | null }[]): WonValueSummary {
  const wonBids = bids.filter((b) => b.status === "WON");
  return {
    valueWon: wonBids.reduce((sum, b) => sum + (b.bidAmount ?? 0), 0),
    valueWonUnpriced: wonBids.filter((b) => b.bidAmount === null).length,
  };
}

export function summariseGc(bids: PipelineBid[], today: string): GcRecord {
  const count = (s: BidStatus) => bids.filter((b) => b.status === s).length;

  const won = count("WON");
  // A LOST bid on a project the prime went elsewhere on is not this GC saying
  // no to our price — it is a job neither of us got.
  const lost = bids.filter((b) => b.status === "LOST" && b.primeWentElsewhere !== true).length;
  const lostElsewhere = bids.filter((b) => b.status === "LOST").length - lost;
  const decided = won + lost;

  return {
    invited: bids.length,
    bid: count("SUBMITTED") + won + lost + lostElsewhere,
    won,
    lost,
    declined: count("DECLINED"),
    primeElsewhere: bids.filter((b) => b.primeWentElsewhere === true && b.status !== "DECLINED" && b.status !== "WON").length,
    outstanding: bids.filter(isLive).length,
    overdue: bids.filter((b) => isOverdue(b, today)).length,
    winRate: decided === 0 ? null : won / decided,
    ...summariseWonValue(bids),
  };
}

/** True when valueWon is a floor rather than a total -- works on a full
 * GcRecord or on summariseWonValue's own narrower result. */
export function valueIsPartial(record: { valueWonUnpriced: number }): boolean {
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

// ─────────────────────────────────────────────────────────────────────────
// THE BID LOG — the numbers a sub keeps by hand, worked out from the rows.
//
// A thirty-year sub who logs every bid tracks five figures: bids per month,
// average bid, contracts won, average contract, and win rate. All five are
// already in `BidInvitation` once you say what each one MEANS, and the
// meanings are the whole of this section. Nothing is stored; correcting a bid
// on /bids moves every figure here with it.
//
//   - A BID is an invitation we put a number in front of: SUBMITTED, WON or
//     LOST — `GcRecord.bid`'s definition, not a second one. INVITED is not a
//     bid yet and DECLINED never will be.
//   - A bid's MONTH is its DUE DATE's month: the day the price went in, as
//     entered. There is no stored "sent on" date (an in-app send is logged, an
//     emailed or hand-delivered one is not), and `createdAt` is when somebody
//     typed the row, which is a different question. A bid with no due date is
//     counted in the all-time figures only, and the count says how many.
//   - AVERAGE BID is the mean `bidAmount` over bids with one. Unpriced bids are
//     counted beside it, never averaged in as zero.
//   - WIN RATE is `summariseGc`'s: won / (won + lost), null when nothing is
//     decided. SUBMITTED bids are waiting, not lost.
//   - A CONTRACT is a WON bid, and its VALUE is the contract value of the job
//     the bid is linked to — quantity × unit price per line, the figure the
//     WIP schedule uses (`calculateLineItemWip`, applied in the query). A won
//     bid with no linked job, or whose job has no priced lines, has no
//     contract value on file: it is counted, and left out of the average
//     rather than averaged in as $0.
//
// WHAT IS NOT HERE: "lands at N% of average contract". Two definitions fit it
// — average contract ÷ average bid, or each won job's contract ÷ its own bid,
// averaged — and they give different numbers on the same rows. Which one the
// customer means is a question for him, not something to guess in code.
// ─────────────────────────────────────────────────────────────────────────

export interface BidLogBid {
  status: BidStatus;
  bidAmount: number | null;
  /** ISO day at UTC midnight, or null. */
  dueDate: string | null;
  /** The linked job's contract value, or null when there is no linked job.
   *  Read only for WON bids. */
  contractValue: number | null;
}

export interface BidLogRecord {
  /** SUBMITTED + WON + LOST. */
  bids: number;
  won: number;
  lost: number;
  /** won / (won + lost), or null when nothing is decided. */
  winRate: number | null;
  /** Mean bid amount over priced bids, or null when none is priced. */
  averageBid: number | null;
  /** Bids with no amount, left out of `averageBid`. */
  unpricedBids: number;
  /** Mean contract value over won bids that have one, or null. */
  averageContract: number | null;
  /** Won bids with no contract value on file, left out of `averageContract`. */
  wonWithoutContract: number;
}

export interface BidLogMonth {
  /** `YYYY-MM`. */
  month: string;
  record: BidLogRecord;
}

export interface BidLog {
  allTime: BidLogRecord;
  /** The calendar year `today` is in, by due date. */
  thisYear: BidLogRecord;
  /** The twelve calendar months ending with `today`'s month, by due date. */
  last12Months: BidLogRecord;
  /** `last12Months.bids / 12`. */
  bidsPerMonth: number;
  /** Those twelve months, newest first, every month present even when empty. */
  byMonth: BidLogMonth[];
  /** Bids with no due date: counted in `allTime` only. */
  noDueDate: number;
}

const isBid = (bid: { status: BidStatus }) =>
  bid.status === "SUBMITTED" || bid.status === "WON" || bid.status === "LOST";

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

/** One period's figures. The counts and the win rate are `summariseGc`'s own. */
export function summariseBidLogPeriod(bids: BidLogBid[], today: string): BidLogRecord {
  const counted = bids.filter(isBid);
  const record = summariseGc(counted, today);
  const priced = counted.flatMap((bid) => (bid.bidAmount === null ? [] : [bid.bidAmount]));
  const won = counted.filter((bid) => bid.status === "WON");
  const contracts = won.flatMap((bid) => (bid.contractValue !== null && bid.contractValue > 0 ? [bid.contractValue] : []));
  return {
    bids: record.bid,
    won: record.won,
    lost: record.lost,
    winRate: record.winRate,
    averageBid: mean(priced),
    unpricedBids: counted.length - priced.length,
    averageContract: mean(contracts),
    wonWithoutContract: won.length - contracts.length,
  };
}

/** `YYYY-MM` of the month `offset` months before `today`'s. */
function monthBefore(today: string, offset: number): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1 - offset;
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

export function summariseBidLog(bids: BidLogBid[], today: string): BidLog {
  const counted = bids.filter(isBid);
  const months = Array.from({ length: 12 }, (_, offset) => monthBefore(today, offset));
  const newest = months[0];
  const oldest = months[months.length - 1];
  const monthOf = (bid: BidLogBid) => (bid.dueDate === null ? null : bid.dueDate.slice(0, 7));
  const last12 = counted.filter((bid) => {
    const month = monthOf(bid);
    return month !== null && month >= oldest && month <= newest;
  });
  const last12Months = summariseBidLogPeriod(last12, today);
  return {
    allTime: summariseBidLogPeriod(counted, today),
    thisYear: summariseBidLogPeriod(
      counted.filter((bid) => bid.dueDate !== null && bid.dueDate.slice(0, 4) === today.slice(0, 4)),
      today,
    ),
    last12Months,
    bidsPerMonth: last12Months.bids / 12,
    byMonth: months.map((month) => ({
      month,
      record: summariseBidLogPeriod(
        counted.filter((bid) => monthOf(bid) === month),
        today,
      ),
    })),
    noDueDate: counted.filter((bid) => bid.dueDate === null).length,
  };
}

/** "44%", or "—" when nothing is decided. A percentage of nothing is not 0%. */
export function percentLabel(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}
