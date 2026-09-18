/**
 * The experience modification rate — which one is current, derived, never
 * stored.
 *
 * Pure: no database, no clock. `today` is passed in as a YYYY-MM-DD string
 * by the caller (`serverToday()` on the page and in the Ask handler), so the
 * page and the assistant cannot disagree about which rate is current, and a
 * test can pin the day.
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
  /** As stored — a decimal string such as "0.87". Never re-derived. */
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
