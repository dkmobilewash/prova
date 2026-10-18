/**
 * ── HOW MANY BIDS LAND IN THE SAME FEW DAYS ──
 *
 * Step 1 of an estimator's day is Go / No-Go, and one of the things it weighs
 * is *"bid deadline vs internal capacity"*.
 *
 * The app already knows what to do once that has gone wrong: `CAPACITY` is a
 * decline reason, and a regret letter can go out naming it. **Nothing has ever
 * said capacity was ABOUT to be a problem**, so the way it gets discovered is
 * by missing a deadline — and a bid nobody answers is worse for a GC
 * relationship than one declined three weeks out, because the GC held a slot
 * open for a number that never came.
 *
 * ── IT REPORTS CROWDING, IT DOES NOT JUDGE CAPACITY ──
 *
 * How many bids a desk can produce in a week depends on the size of them, who
 * is in, and how much of each is already done. This file knows none of that
 * and does not pretend to: *"three bids due between the 12th and the 14th"* is
 * a fact, and whether that is too many is the estimator's call.
 *
 * Every threshold that WOULD be a judgement about somebody else's capacity is
 * absent on purpose. The only two numbers here are the width of the window and
 * the count that makes a window worth mentioning at all.
 *
 * ── ONLY BIDS THAT CAN STILL BE ACTED ON ──
 *
 * Future, and not sent yet. A bid already submitted takes no more of this
 * week, and one whose deadline has passed is `bid-standing.ts`'s business
 * rather than this file's — telling somebody that four bids were crowded last
 * Tuesday is a fact about a week they cannot change.
 */

/** A live bid, the same shape `/pipeline` already holds. */
export type CrowdingBid = {
  id: string;
  projectName: string;
  contactName: string;
  status: "INVITED" | "SUBMITTED";
  dueDate: string | null;
};

/**
 * The window a crowd is measured in.
 *
 * Seven days, because an estimator's week is the unit they actually plan in —
 * and a shorter window would split a Monday and a Friday deadline that are
 * plainly competing for the same week.
 */
export const WINDOW_DAYS = 7;

/**
 * How many deadlines in that window are worth mentioning.
 *
 * Three. Two bids in a week is an ordinary week; mentioning it would be the
 * warning nobody reads, which `/pipeline`'s overdue badge has just finished
 * being for exactly that reason.
 */
export const CROWD = 3;

export type Crowd = {
  /** Earliest and latest deadline in the crowd, `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** Sorted by deadline. All still unsent, all still ahead. */
  bids: CrowdingBid[];
};

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);

/**
 * Stretches of `WINDOW_DAYS` holding `CROWD` or more unsent deadlines.
 *
 * Maximal runs rather than fixed weeks: five bids spread over Thursday to the
 * following Wednesday are one crowd, and a calendar week would cut them into
 * two unremarkable halves. The same bid never appears in two crowds.
 */
export function bidCrowds(bids: readonly CrowdingBid[], today: string): Crowd[] {
  const upcoming = bids
    .filter((bid) => bid.status === "INVITED" && bid.dueDate !== null)
    .map((bid) => ({ ...bid, dueDate: bid.dueDate!.slice(0, 10) }))
    // AN UNPARSEABLE DATE FALLS OUT HERE, with no separate guard. There was
    // one — `Number.isFinite(Date.parse(…))` — and mutation showed removing it
    // changed nothing: `daysBetween` returns NaN, and `NaN >= 0` is false, so
    // the line below already drops it. A guard that cannot change an answer is
    // a line read and understood forever for nothing (the same shape deleted
    // from `sheetLevel.ts` in #705).
    .filter((bid) => daysBetween(today, bid.dueDate) >= 0)
    // LOAD-BEARING, not tidiness: the run detection below walks forward and
    // assumes ascending. Mutation found this — every fixture happened to be
    // written in date order, so removing the sort changed nothing until a
    // shuffled case was added.
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const crowds: Crowd[] = [];
  let run: typeof upcoming = [];

  const flush = () => {
    if (run.length >= CROWD) {
      crowds.push({ from: run[0].dueDate, to: run[run.length - 1].dueDate, bids: [...run] });
    }
    run = [];
  };

  for (const bid of upcoming) {
    if (run.length === 0) {
      run = [bid];
      continue;
    }
    // AGAINST THE START OF THE RUN, not against the previous bid. Chaining off
    // the neighbour would let a bid every six days join one unbroken "crowd"
    // stretching over months, which is a calendar rather than a warning.
    if (daysBetween(run[0].dueDate, bid.dueDate) <= WINDOW_DAYS - 1) {
      run.push(bid);
    } else {
      flush();
      run = [bid];
    }
  }
  flush();

  return crowds;
}

const sameDay = (crowd: Crowd): boolean => crowd.from === crowd.to;

/**
 * One line per crowd, or an empty list.
 *
 * It names the window and the projects and stops there. No advice about which
 * to drop: that depends on the GC, the fee, the backlog and who is free, none
 * of which is in this file.
 */
export function crowdingLines(crowds: readonly Crowd[]): string[] {
  return crowds.map((crowd) => {
    const names = crowd.bids.slice(0, 4).map((bid) => `${bid.projectName} (${bid.contactName})`);
    const rest = crowd.bids.length - names.length;
    const list = rest > 0 ? `${names.join(", ")} and ${rest} more` : names.join(", ");
    const when = sameDay(crowd) ? `all due ${crowd.from}` : `due between ${crowd.from} and ${crowd.to}`;
    // THE ACTION IS NAMED, because it is the one that is cheap now and
    // expensive later: a GC told three weeks out can invite somebody else, and
    // a bid nobody answers costs the relationship that a decline does not.
    return `${crowd.bids.length} bids ${when}, none sent yet: ${list}. If one is going to be declined, the GC would rather hear it now.`;
  });
}
