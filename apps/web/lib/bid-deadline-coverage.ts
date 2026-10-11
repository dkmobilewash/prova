import type { LevelledPackage, LevelQuote } from "./bid-levelling";

/**
 * ── WHICH PACKAGES HAVE NO PRICE YET, AGAINST THE DAY THE BID IS DUE ──
 *
 * Step 5 of an estimator's day: *"Quote Tracking: monitor open RFQs to ensure
 * quotes return prior to the bid deadline."*
 *
 * `bid-levelling.ts` already knows a lot about a quote. `requestState` returns
 * `ANSWERED | DECLINED | OVERDUE | AWAITED`, and `levelPackage` keeps
 * outstanding requests out of the comparison rather than letting a null price
 * win it.
 *
 * What none of it knows is **when the bid is due**. `requestState` measures a
 * quote against its own `dueBy` — the date we asked the vendor for — and
 * `bid-levelling.ts` does not mention `BidInvitation.dueDate` anywhere.
 *
 * So a quote can be sitting comfortably inside its own window while the BID is
 * due tomorrow, and nothing says a word. That is the situation this exists for:
 * the vendor is not late, and you are about to be.
 *
 * ── A PACKAGE WITH NO ANSWERED QUOTE IS A HOLE IN THE NUMBER ──
 *
 * Not a late task — a figure that is about to be guessed. Every other state is
 * recoverable: one quote in hand is a number you can bid, a decline tells you
 * to ask somebody else, and a spread you dislike is still a spread. Nothing in
 * hand means the line is coming off somebody's memory of the last job.
 *
 * ── IT COUNTS DAYS, AND SAYS WHEN IT CANNOT ──
 *
 * `null` for the bid's due date means UNKNOWN, never "plenty of time". A bid
 * nobody dated is the one most likely to be close, and a quiet screen over it
 * is the failure this whole file is arranged to avoid.
 */

/** A package as the levelling screen holds it, plus nothing extra. */
export type CoveragePackage = Pick<LevelledPackage<LevelQuote>, "packageLabel" | "quotes" | "outstanding" | "declined">;

export type PackageCoverage = {
  packageLabel: string;
  /** Priced quotes in hand. Zero is the one that matters. */
  priced: number;
  /** Asked, not answered, not declined. */
  outstanding: number;
  declined: number;
};

export type DeadlineCoverage = {
  /** Whole days from today to the bid's due date; negative once it has passed.
   *  Null when nobody has dated the bid. */
  daysToBid: number | null;
  /** Packages with nothing priced — the holes. Ordered as they came in, which
   *  is the order the screen already shows them. */
  unpriced: PackageCoverage[];
  /** Packages where everything asked has been answered or declined, and
   *  nothing is still out. */
  settled: number;
  /** Requests still outstanding across every package. */
  stillOut: number;
};

/** Whole days between two `YYYY-MM-DD` dates, or null if either is unusable. */
export function daysBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Where the bid stands on vendor pricing.
 *
 * `today` is passed in rather than read from a clock, the reason
 * `requestState` gives for the same choice: a figure that changes depending on
 * when the server happens to render it is one a test cannot hold still, and
 * "two days left" is exactly that kind of figure.
 */
export function deadlineCoverage(
  packages: readonly CoveragePackage[],
  bidDueDate: string | null,
  today: string,
): DeadlineCoverage {
  const unpriced: PackageCoverage[] = [];
  let settled = 0;
  let stillOut = 0;

  for (const one of packages) {
    const priced = one.quotes.length;
    const outstanding = one.outstanding.length;
    stillOut += outstanding;
    if (priced === 0) {
      unpriced.push({
        packageLabel: one.packageLabel,
        priced,
        outstanding,
        declined: one.declined.length,
      });
    }
    if (outstanding === 0) settled += 1;
  }

  return { daysToBid: daysBetween(today, bidDueDate), unpriced, settled, stillOut };
}

/** `tomorrow`, `in 3 days`, `today`, `2 days ago` — the way somebody says it. */
function whenDue(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  if (days === -1) return "yesterday";
  return `${Math.abs(days)} days ago`;
}

/**
 * The sentence for the screen, or null when there is nothing to say.
 *
 * Null ONLY when every package has a price. An undated bid with holes in it
 * still gets a sentence — it just cannot say how long is left, and says that
 * instead of going quiet.
 */
export function coverageWarning(coverage: DeadlineCoverage): string | null {
  const { unpriced, daysToBid } = coverage;
  if (unpriced.length === 0) return null;

  const names = unpriced.map((one) => one.packageLabel);
  const list = names.length <= 4 ? names.join(", ") : `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`;
  const holes = `${unpriced.length} package${unpriced.length === 1 ? "" : "s"} ${
    unpriced.length === 1 ? "has" : "have"
  } no price yet: ${list}.`;

  if (daysToBid === null) {
    // NO DATE IS NOT NO HURRY. The bid nobody dated is the one most likely to
    // be close, so this says what is missing rather than nothing at all.
    return `${holes} This bid has no due date set, so nobody can tell you how long is left.`;
  }
  if (daysToBid < 0) {
    return `${holes} The bid was due ${whenDue(daysToBid)}.`;
  }
  // The count of what is still out is the actionable half — it is the number of
  // phone calls between here and a bid with no guesses in it.
  const chasing =
    coverage.stillOut > 0
      ? ` ${coverage.stillOut} request${coverage.stillOut === 1 ? " is" : "s are"} still out.`
      : " Nothing is still out — these packages need somebody asked.";
  return `${holes} The bid is due ${whenDue(daysToBid)}.${chasing}`;
}
