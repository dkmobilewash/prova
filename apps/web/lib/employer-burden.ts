/**
 * The employer burden percentage — which one applies to a given day, and what
 * it adds to the base wages on that day's hours.
 *
 * Pure: no database, no clock. Dates and percentages come in as values the
 * caller already has, so a test can pin any day and no two callers can
 * disagree about "today".
 *
 * WHAT THIS FIXES. `lib/labor-cost.ts` prices a logged hour as base wage ×
 * pay-type multiplier + the four CBA fringes and stops. That file's own header
 * says exactly that and is accurate; `lib/wip.ts` calls it "base plus
 * fringes", also accurate. What was NOT accurate was the screen: the job-cost
 * caption said "costed at the craft's burdened rate", and to a contractor
 * "burdened" means fully loaded — employer FICA, FUTA/SUTA and workers' comp
 * included. None of those were in the figure. So `actualCostToDate` was
 * understated, and because percent complete is cost-to-cost it was
 * OVERSTATED, which is the direction that hurts: a job reads further along
 * than it is, earned revenue reads high, and the WIP schedule a surety sees
 * inherits both.
 *
 * WHAT IT IS MULTIPLIED BY, AND THAT THIS IS A MODELLING CHOICE.
 *
 *   THE PERCENTAGE IS APPLIED TO THE BASE WAGE ONLY, NOT TO THE FRINGES.
 *
 * The reasoning: bona fide employer contributions to a benefit plan —
 * pension, vacation, health & welfare, training, which is what the four
 * fringe columns are — are generally outside the wage base that employer
 * payroll taxes are computed on, so burdening them again would count the same
 * dollars twice. THAT IS A MODELLING CHOICE A CPA SHOULD CONFIRM. It is not a
 * tax rule anybody on this branch verified, and it is not advice. It is
 * written here, in the schema, and on the screen where the rate is entered,
 * so that the owner whose number this is can see what it is being multiplied
 * by and tell their accountant.
 *
 * Overtime and double-time follow automatically and that is deliberate: the
 * burden is taken on the MULTIPLIED base wage, because an overtime hour costs
 * the employer FICA on the overtime dollars too.
 *
 * THE DEFAULT CHANGES NOTHING. With no rate recorded — which is every company
 * the day this ships — `employerBurdenPercentOn` returns null, no burden is
 * added anywhere, and every job-cost figure is byte-identical to what it was.
 * That is pinned by a test (`employer-burden.test.ts`, "with no rate
 * recorded"), not left to inspection.
 */

// The same validated effective-date reader the mod rate uses, deliberately
// NOT a second copy: it rejects an impossible date (2026-02-30 silently
// becomes 2026-03-02 in JavaScript) and a year outside 1990–2100 (a typo'd
// "0025" goes through Date.UTC's 1900 offset), and its messages are already
// written generically about "the effective date". A second implementation of
// those two checks is how one of them ends up missing.
export { emrEffectiveDate as employerBurdenEffectiveDate } from "./emr";

/** One recorded rate as the page, the actions and the costing path all read
 * it. `effectiveDate` is YYYY-MM-DD at UTC midnight, which is why comparing
 * them as strings is a calendar comparison. `percent` is the stored decimal
 * fixed to three places ("15.000", "28.375") — as a STRING for the same
 * reason emr.ts keeps its rate as one: Prisma's Decimal.toString() drops
 * trailing zeros, and a figure a person typed should render back the way
 * they typed it. */
export type EmployerBurdenRateRecord = {
  id: string;
  effectiveDate: string;
  percent: string;
  note: string | null;
};

export type EmployerBurdenStanding<T extends EmployerBurdenRateRecord = EmployerBurdenRateRecord> = {
  /** The latest rate whose effective date is today or earlier. null when
   * nothing on file has started yet — which includes "nothing on file", the
   * state every existing company is in. */
  current: T | null;
  /** Rates recorded for a date that has not arrived, soonest first. Recording
   * next year's burden as soon as the accountant works it out is ordinary,
   * and such a rate is NOT in force until its date. */
  upcoming: T[];
  /** Every rate, newest effective date first. */
  history: T[];
};

/** The percentage as it should read on screen: never fewer than two decimal
 * places, three only when the third is not zero. "15.000" -> "15.00",
 * "28.375" -> "28.375". Same rule and same reason as `emrRateText`. */
export function employerBurdenPercentText(fixedToThree: string): string {
  return /\.\d\d0$/.test(fixedToThree) ? fixedToThree.slice(0, -1) : fixedToThree;
}

export function employerBurdenStanding<T extends EmployerBurdenRateRecord>(
  records: readonly T[],
  today: string,
): EmployerBurdenStanding<T> {
  const history = [...records].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  // A rate dated today IS in force today: it starts that morning.
  const current = history.find((record) => record.effectiveDate <= today) ?? null;
  const upcoming = history.filter((record) => record.effectiveDate > today).reverse();
  return { current, upcoming, history };
}

/**
 * The UTC calendar day of a Date, as the YYYY-MM-DD string the records carry.
 *
 * UTC on purpose, and it matches `calendarDay()` in lib/labor-cost.ts: a
 * TimeEntry's `date` is stored at UTC midnight (CLAUDE.md's Dates
 * convention), so this is the day the hours were worked and not the day
 * anybody's browser thinks it is. Reading the local day here would price an
 * evening entry against the previous day's rate for readers west of UTC.
 */
function utcCalendarDay(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
}

/**
 * The burden percentage in force on a given day, or null when none is.
 *
 * PER TIME ENTRY, NOT PER PAGE. Hours worked in March are costed at March's
 * rate even after April's has been recorded — same rule
 * `findEffectiveFringeRateSchedule` follows for a wage, and for the same
 * reason: paying the wrong era's rate is a silent restatement of a number
 * somebody has already quoted.
 *
 * null and 0 are different answers and both are returned honestly: null is
 * "nothing recorded, add nothing", 0 is "somebody worked it out and it came
 * to nothing". The arithmetic is the same; the sentence on screen is not.
 */
export function employerBurdenPercentOn(
  records: readonly EmployerBurdenRateRecord[],
  date: Date,
): number | null {
  return employerBurdenPercentOnDay(records, utcCalendarDay(date));
}

/** The same answer for a day already in YYYY-MM-DD form — what a screen has
 * when it wants to SAY which basis a figure is on, rather than compute one.
 *
 * Order-independent, deliberately: it scans for the latest effective date at
 * or before the day rather than trusting the caller's `orderBy`, on the same
 * rule `findEffectiveFringeRateSchedule` settled at #104 finding 3. A loader
 * that changes its sort must not be able to change a dollar figure. */
export function employerBurdenPercentOnDay(
  records: readonly EmployerBurdenRateRecord[],
  day: string,
): number | null {
  let best: EmployerBurdenRateRecord | null = null;
  for (const record of records) {
    if (record.effectiveDate > day) continue;
    if (best === null || record.effectiveDate > best.effectiveDate) best = record;
  }
  return best === null ? null : Number(best.percent);
}

/**
 * The burden on a run of base wages, in whole CENTS, rounded exactly ONCE.
 *
 * `baseWageDollars` is dollars and `percent` is a percentage, so their
 * product is already cents — $48,000 of base wages at 15 is 720,000 cents,
 * $7,200. That identity is why this can be one multiply and one `Math.round`
 * rather than a divide, a multiply and two roundings that disagree at the
 * half cent.
 *
 * Callers accumulate the base wages FIRST and round here once at the end,
 * rather than rounding each time entry: a hundred entries rounded
 * individually is a hundred roundings, and the sum drifts from the figure an
 * accountant gets by multiplying the payroll total.
 */
export function employerBurdenCents(baseWageDollars: number, percent: number): number {
  return Math.round(baseWageDollars * percent);
}

/**
 * What a job-cost figure is made of, in the app's own words — and THE LABEL
 * FOLLOWS THE DATA, which is the whole point of it being a function.
 *
 * With no rate in force it says "wage and fringes", which is what the
 * arithmetic has always done and what the screen should have said all along.
 * Once a rate is in force it may say "burdened", because by then it is true.
 */
export function laborCostBasisLabel(percent: number | null): string {
  if (percent === null) return "wage and fringes";
  return `wage, fringes and ${employerBurdenPercentText(percent.toFixed(3))}% employer burden`;
}

/** The bounds a typed percentage must sit inside, as a sentence the form can
 * show. Returns null when the input is acceptable.
 *
 * Zero is ALLOWED — see the schema's CHECK comment: a recorded 0 is a
 * statement, not a blank. Negatives are not: a burden is a cost added to
 * wages, and a negative one would quietly REDUCE cost to date.
 *
 * The ceiling at 100 is the one mistake worth catching. A burden above the
 * whole base wage is almost certainly a fraction typed where a percentage
 * belongs, or a wage figure typed into a percent box — and unlike a mod rate
 * this number multiplies money on a GC-facing WIP schedule, so a decimal
 * point in the wrong place is a restatement. */
export function employerBurdenPercentProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "The burden percentage is required";
  if (!/^\d+(\.\d{1,3})?$|^\.\d{1,3}$/.test(value)) {
    return "Enter the burden as a percentage with up to three places, like 18.5";
  }
  const percent = Number(value);
  if (!Number.isFinite(percent)) return "Enter the burden as a percentage, like 18.5";
  if (percent > 100) {
    return "That is more than the wages it is added to — enter 18.5 for 18.5%, not 0.185 or a dollar amount";
  }
  return null;
}
