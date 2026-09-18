/**
 * The experience modification rate — which one is current, derived, never
 * stored.
 *
 * Pure: no database, no clock. `today` is passed in as a YYYY-MM-DD string
 * by the caller — `viewerToday()`, on the page and in the Ask handler alike,
 * so the two cannot disagree and a test can pin the day.
 *
 * VIEWER'S DAY, NOT `serverToday()`, and this was a review finding rather
 * than a first draft. Which rate is in force is a question "the exact day
 * decides", which is the case `serverToday()`'s own doc comment says it is
 * not good enough for: on 31 December at 17:00 in California the UTC day is
 * already 1 January, and the page would have shown NEXT year's mod to
 * somebody filling in a prequal form that evening.
 *
 * NOTHING HERE COMPUTES AN EMR. The rate is whatever the bureau issued and a
 * person typed in. This file only answers "of the rates on file, which one
 * applies today" — the one question about them that is ours to answer.
 */

/** One rate as the page and the tool read it. Dates are YYYY-MM-DD at UTC
 * midnight, which is why comparing them as strings is a calendar comparison. */
export type EmrRecord = {
  id: string;
  effectiveDate: string;
  /** The rate as an EMR is written — at least two decimal places, three when
   * the bureau issued three ("0.87", "1.00", "0.875"). See `emrRateText`.
   *
   * This comment used to say "as stored", and that was false: Prisma's
   * Decimal.toString() drops trailing zeros, so a bureau-issued 1.000 came
   * back as "1" and 0.900 as "0.9" — the figure the tool tells the model to
   * repeat verbatim onto a GC's form. */
  rate: string;
  source: string;
  sourceUrl: string | null;
  note: string | null;
};

export type EmrStanding<T extends EmrRecord = EmrRecord> = {
  /** The latest rate whose effective date is today or earlier. null when
   * nothing on file has started yet — which includes "nothing on file". */
  current: T | null;
  /** Rates recorded for a policy year that has not started, soonest first.
   * Recorded ahead of time is ordinary — a bureau issues the next year's mod
   * before renewal — and such a rate is NOT the current one until its date. */
  upcoming: T[];
  /** Every rate, newest effective date first. */
  history: T[];
  /** True when the current rate's policy year — twelve months from its
   * effective date — has already ended, so the newest rate on file is last
   * year's. Reported rather than hidden: "our mod is 0.87" said to a GC in
   * 2027 about a 2025 rating is the near-miss this flag exists to stop. */
  currentIsPastItsPolicyYear: boolean;
};

/**
 * The rate as it is written on a mod worksheet: never fewer than two decimal
 * places, three only when the third is not zero.
 *
 * Takes the database value already fixed to three places (Decimal.toFixed(3))
 * so this stays pure. "1.000" -> "1.00", "0.870" -> "0.87", "0.875" -> "0.875".
 * Dropping to "1" is what Decimal.toString() did, and an EMR is never written
 * that way: "1" on a prequal form reads as a typo for 1.00 at best.
 */
export function emrRateText(fixedToThree: string): string {
  return /\.\d\d0$/.test(fixedToThree) ? fixedToThree.slice(0, -1) : fixedToThree;
}

/**
 * The effective date as typed, or the sentence saying why it is not one.
 *
 * Two checks the first version missed, both review findings:
 *   - an IMPOSSIBLE date is not an invalid Date in JavaScript — 2026-02-30
 *     silently becomes 2026-03-02 — so the typed string must survive the
 *     round trip unchanged;
 *   - a year below 100 goes through Date.UTC's 1900 offset, so a typo'd
 *     "0025" was stored and then read back as ending in 1926. A mod rate is
 *     a document from a working bureau; a year outside 1990–2100 is a typo.
 * Returns the Date on success, a string on failure.
 */
export function emrEffectiveDate(raw: string): Date | string {
  const value = raw.trim();
  if (!value) return "The effective date is required";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "The effective date is not a valid date";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return "That date does not exist — check the day and month";
  }
  const year = date.getUTCFullYear();
  if (year < 1990 || year > 2100) return "Check the year on the effective date";
  return date;
}

/** Twelve months on from an effective date, clamped to the month's end —
 * a policy year starting 29 February ends on 28 February. */
export function policyYearEnd(effectiveDate: string): string {
  const start = new Date(`${effectiveDate}T00:00:00.000Z`);
  const year = start.getUTCFullYear() + 1;
  const month = start.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(start.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function emrStanding<T extends EmrRecord>(records: readonly T[], today: string): EmrStanding<T> {
  const history = [...records].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  // A rate dated today IS in force today: the policy year starts that morning.
  const current = history.find((record) => record.effectiveDate <= today) ?? null;
  const upcoming = history.filter((record) => record.effectiveDate > today).reverse();
  return {
    current,
    upcoming,
    history,
    currentIsPastItsPolicyYear: current !== null && policyYearEnd(current.effectiveDate) <= today,
  };
}

/** The bounds a typed rate must sit inside, as a sentence the form can show.
 *
 * Above zero because a mod is a multiplier on premium. Below 10 because no
 * real rating is anywhere near it — and because the one mistake worth
 * catching is a WCIRB-style percentage ("87") typed where a decimal ("0.87")
 * belongs, which would otherwise be stored as a mod a hundred times too high
 * and repeated to a GC. Returns null when the input is acceptable. */
export function emrRateProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "The rate is required";
  if (!/^\d+(\.\d{1,3})?$|^\.\d{1,3}$/.test(value)) {
    return "Enter the rate as a decimal with up to three places, like 0.87";
  }
  const rate = Number(value);
  if (rate <= 0) return "A mod rate is above zero";
  if (rate >= 10) {
    return "Enter the rate as a decimal, like 0.87 — if your bureau shows 87%, that is 0.87";
  }
  return null;
}
