/**
 * A company's own pre-bid pipeline — the part with no database in it.
 *
 * "What have we got out chasing that we haven't bid yet?" A pursuit is a
 * project somebody here knows is coming and is working toward before any GC
 * has invited us. See packages/db/prisma/schema/pursuits.prisma for why this
 * is its own model and, above all, why it is NOT SalesLead: that is Prova's
 * own CRM for selling this product, and nothing here reads it.
 *
 * NOTHING HERE IS STORED. "Gone quiet", "bid date coming up" and "bid date
 * passed with no invite" are all derived on every read from `updatedAt`,
 * `expectedBidDate` and today. A stored `stale` flag would be wrong by the
 * next morning, which is the whole reason for the rule.
 *
 * Dates are compared as ISO calendar-day strings (YYYY-MM-DD), the same way
 * lib/bid-pipeline.ts compares them: every date that matters here is stored
 * at UTC midnight and is a plain calendar day, so there is no timezone maths
 * to get wrong.
 */

export const BID_PURSUIT_STAGES = [
  "WATCHING",
  "CONTACTED",
  "EXPECTING_INVITE",
  "INVITED",
  "DROPPED",
] as const;

export type BidPursuitStage = (typeof BID_PURSUIT_STAGES)[number];

export const STAGE_LABELS: Record<BidPursuitStage, string> = {
  WATCHING: "Watching",
  CONTACTED: "Contacted",
  EXPECTING_INVITE: "Expecting invite",
  INVITED: "Invited",
  DROPPED: "Dropped",
};

/** How long an open pursuit can sit untouched before it reads as gone quiet.
 * Thirty days: a pre-bid chase moves on the scale of weeks, and a month with
 * nobody touching it is the point at which somebody should ask whether it
 * is still real. */
export const QUIET_AFTER_DAYS = 30;

/** How far ahead an expected bid date counts as "coming up". */
export const COMING_UP_DAYS = 30;

/** Still being chased: not yet invited, and not given up on. INVITED has
 * left this list for /bids; DROPPED has left it for good. */
export function isOpenPursuit(stage: BidPursuitStage): boolean {
  return stage !== "INVITED" && stage !== "DROPPED";
}

export type PursuitForDerivation = {
  stage: BidPursuitStage;
  /** YYYY-MM-DD, or null when nobody has a date yet. */
  expectedBidDate: string | null;
  /** YYYY-MM-DD — the calendar day of the last edit. */
  lastUpdated: string;
  /** Null when nobody said. NOT zero. */
  estimatedValue: number | null;
};

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative when `to` is
 * earlier. UTC-midnight parse, so a day is exactly 86,400,000 ms. */
export function daysFromTo(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Open, and nobody has touched it in QUIET_AFTER_DAYS or more. A pursuit
 * already invited or dropped cannot go quiet — there is nothing left to
 * chase. */
export function isGoneQuiet(pursuit: PursuitForDerivation, today: string, afterDays = QUIET_AFTER_DAYS): boolean {
  return isOpenPursuit(pursuit.stage) && daysFromTo(pursuit.lastUpdated, today) >= afterDays;
}

/** Open, with an expected bid date from today through the next
 * COMING_UP_DAYS days inclusive. */
export function isBidDateComingUp(pursuit: PursuitForDerivation, today: string, withinDays = COMING_UP_DAYS): boolean {
  if (!isOpenPursuit(pursuit.stage) || pursuit.expectedBidDate === null) return false;
  const days = daysFromTo(today, pursuit.expectedBidDate);
  return days >= 0 && days <= withinDays;
}

/**
 * Open, and the date we expected the bid to be due has already gone by with
 * no invitation. The most useful signal on the page: either the invite went
 * to somebody else, or the date moved and nobody updated it. Both are worth
 * a phone call, and neither is knowable from the data — so this says only
 * that the date passed, never why.
 */
export function isBidDatePassed(pursuit: PursuitForDerivation, today: string): boolean {
  return isOpenPursuit(pursuit.stage) && pursuit.expectedBidDate !== null && pursuit.expectedBidDate < today;
}

export type PursuitSummary = {
  total: number;
  open: number;
  byStage: Record<BidPursuitStage, number>;
  bidDatesComingUp: number;
  bidDatesPassed: number;
  goneQuiet: number;
  /** Summed estimatedValue across OPEN pursuits that have one, in dollars,
   * summed in whole cents so it never carries float noise. */
  openEstimatedValue: number;
  /** Open pursuits with no value recorded. When above zero,
   * openEstimatedValue is a floor, and whatever renders it must say so. */
  openUnpriced: number;
};

export function summarisePursuits(pursuits: PursuitForDerivation[], today: string): PursuitSummary {
  const byStage = Object.fromEntries(BID_PURSUIT_STAGES.map((s) => [s, 0])) as Record<BidPursuitStage, number>;
  for (const p of pursuits) byStage[p.stage] += 1;

  const open = pursuits.filter((p) => isOpenPursuit(p.stage));
  const priced = open.filter((p) => p.estimatedValue !== null);

  return {
    total: pursuits.length,
    open: open.length,
    byStage,
    bidDatesComingUp: pursuits.filter((p) => isBidDateComingUp(p, today)).length,
    bidDatesPassed: pursuits.filter((p) => isBidDatePassed(p, today)).length,
    goneQuiet: pursuits.filter((p) => isGoneQuiet(p, today)).length,
    // In whole CENTS, then back to dollars once. Summing the dollar floats
    // directly gave $100.10 + $200.20 = 300.29999999999995, which the Ask
    // tool handed the model raw. Every stored value is DECIMAL(12,2), so a
    // round to the cent loses nothing.
    openEstimatedValue: priced.reduce((cents, p) => cents + Math.round((p.estimatedValue ?? 0) * 100), 0) / 100,
    openUnpriced: open.length - priced.length,
  };
}

/**
 * The order a person wants to work the list in: open before closed; among
 * open, the ones with a bid date soonest first (a passed date sorts ahead
 * of a future one, since it is the more urgent call), undated after dated;
 * closed ones last, most recently touched first.
 */
export function comparePursuits(a: PursuitForDerivation, b: PursuitForDerivation): number {
  const openRank = (p: PursuitForDerivation) => (isOpenPursuit(p.stage) ? 0 : 1);
  const byOpen = openRank(a) - openRank(b);
  if (byOpen !== 0) return byOpen;
  if (openRank(a) === 0) {
    if (a.expectedBidDate !== b.expectedBidDate) {
      if (a.expectedBidDate === null) return 1;
      if (b.expectedBidDate === null) return -1;
      return a.expectedBidDate < b.expectedBidDate ? -1 : 1;
    }
    return 0;
  }
  return a.lastUpdated < b.lastUpdated ? 1 : a.lastUpdated > b.lastUpdated ? -1 : 0;
}

export class BidPursuitInputError extends Error {}

/** An optional YYYY-MM-DD into UTC midnight, or null when blank. */
export function optionalDateFromString(raw: unknown): Date | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BidPursuitInputError("That bid date is not valid");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new BidPursuitInputError("That bid date is not valid");
  return date;
}

/** An optional money amount as a string Prisma's Decimal accepts, or null
 * when blank. A leading $ (with or without a space after it) and thousands
 * commas are forgiven because that is how a person types a number like
 * this. Commas anywhere else are REFUSED rather than stripped: "1,2,3" is
 * not a number anybody meant, and storing it as 123 is worse than asking.
 * Negative is refused: a pursuit is not worth less than nothing. Zero is
 * refused too, because blank — not zero — is what "nobody said" is stored
 * as, and a 0 would read as a priced pursuit worth nothing. */
export function optionalValueFromString(raw: unknown): string | null {
  // Trim, drop the $, trim again: "$ 250,000" is how some people type it.
  const typed = typeof raw === "string" ? raw.trim().replace(/^\$/, "").trim() : "";
  if (!typed) return null;
  const bad = () => new BidPursuitInputError("Estimated value must be a number, like 250000 or 250,000.00");
  // Either no commas at all, or commas exactly where thousands go.
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(typed)) throw bad();
  const value = typed.replace(/,/g, "");
  // Ten digits before the point is what DECIMAL(12,2) holds; more would be
  // a database error the person could not read.
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) throw bad();
  if (Number(value) === 0) {
    throw new BidPursuitInputError(
      "Estimated value can't be zero. If nobody knows what it is worth yet, leave it blank.",
    );
  }
  return value;
}

export function stageFromString(raw: unknown): BidPursuitStage {
  const value = typeof raw === "string" ? raw.trim() : "";
  if ((BID_PURSUIT_STAGES as readonly string[]).includes(value)) return value as BidPursuitStage;
  throw new BidPursuitInputError("Pick a stage");
}
