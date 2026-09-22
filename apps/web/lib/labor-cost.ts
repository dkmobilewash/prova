// Burdened labor cost math -- turning a logged TimeEntry into a wage cost
// using the FringeRateSchedule effective for its craft classification and
// date. Pure arithmetic, deliberately not an LLM call, same reasoning as
// lib/wip.ts.
//
// Per prevailing-wage/Davis-Bacon convention: overtime and double-time
// multiply the BASE wage only -- fringe benefits (pension, vacation,
// health & welfare, training) are paid at their flat per-hour rate
// regardless of pay type.
//
// WHAT IS NOT IN HERE, SAID OUT LOUD BECAUSE A SCREEN ONCE CLAIMED IT WAS.
// No employer FICA, no FUTA/SUTA, no workers' compensation premium. This file
// has always been accurate about that; the job-cost caption was not, and read
// "costed at the craft's burdened rate" while none of those were in the
// figure. The employer's share lives in lib/employer-burden.ts and is added
// by the job-costing path (lib/labor-job-cost.ts) ON TOP of what this returns
// -- never inside it, because the certified payroll (WH-347) and the fringe
// remittance want exactly this figure and an employer tax folded in here
// would put a wrong number on a federal form.

export type TimeEntryPayType = "STRAIGHT" | "OVERTIME" | "DOUBLE_TIME" | "SHIFT_DIFFERENTIAL";

export interface FringeRateScheduleInput {
  baseWage: number;
  pensionRate: number | null;
  vacationRate: number | null;
  healthWelfareRate: number | null;
  trainingRate: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface TimeEntryLaborCostInput {
  hours: number;
  payType: TimeEntryPayType;
  date: Date;
}

const PAY_TYPE_BASE_MULTIPLIER: Record<TimeEntryPayType, number> = {
  STRAIGHT: 1,
  OVERTIME: 1.5,
  DOUBLE_TIME: 2,
  // Shift differentials vary by agreement and aren't modeled as a fixed
  // amount anywhere yet -- treated as straight-time base pay until that's
  // captured. See ARCHITECTURE.md.
  SHIFT_DIFFERENTIAL: 1,
};

/** A date's own calendar day, as a comparable integer -- UTC year/month/day
 * only, with the time-of-day dropped.
 *
 * `effectiveFrom`/`effectiveTo` are always stored at UTC midnight (see
 * CLAUDE.md's Dates convention), but the date this is compared AGAINST is
 * not always: `laborRateDateFor`'s fallback is a bare `new Date()`, carrying
 * whatever hour the request happened to land on. Comparing full timestamps
 * meant a schedule stopped pricing at midnight UTC on its own LAST calendar
 * day -- any call after 00:00 that day already read as past `effectiveTo`,
 * while the setup screen's badge (comparing "YYYY-MM-DD" strings) still
 * called the same schedule "in force" for the whole day. Truncating both
 * sides to a calendar day before comparing is what makes the two agree.
 */
function calendarDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Finds the FringeRateSchedule effective on a given date, or null if none
 * applies. Never picks the "closest" one -- paying the wrong era's rate is
 * worse than surfacing nothing.
 *
 * `effectiveTo` is treated as an INCLUSIVE last day -- "in force until
 * 6/30" prices 6/30 itself, matching the setup screen's own badge
 * (FringeScheduleList) and every schedule in this codebase's tests, which
 * record a schedule's last day and start its replacement the FOLLOWING
 * day. That is deliberate, not an oversight of the database's exclusion
 * constraint: `FringeRateSchedule_no_overlapping_rates` uses tsrange's
 * default `[effectiveFrom, effectiveTo)`, which exists to let a company
 * end a rate and start its replacement on the SAME calendar day (ending
 * one at 00:00 and starting the next at that same 00:00 is not an overlap
 * to Postgres) -- it does not mandate that the ended schedule's own
 * labelled day become unpriced, and verified empirically against a real
 * exclusion constraint that Postgres accepts BOTH the same-day and the
 * next-day convention equally. Switching this lookup to exclude
 * `effectiveTo`'s day outright would silently turn every schedule using
 * the next-day convention -- which is every fixture in this repo -- into
 * one unpriced day at each changeover, trading a rare ambiguity for a
 * routine gap. See CHANGELOG / PR #104 for the full reasoning; flagged
 * there as a judgment call rather than assumed silently.
 *
 * What the inclusive-both-ends comparison genuinely cannot resolve on its
 * own is the SAME-DAY changeover the database explicitly permits: an old
 * schedule ended today and a new one starting today both match today's
 * date. That is real nondeterminism (issue #104 finding 3) and is resolved
 * below by preferring the schedule with the LATEST `effectiveFrom` among
 * those that match, deterministically, regardless of the order the caller
 * happened to fetch them in -- the same "most recently effective wins"
 * convention `lib/prevailing-wage.ts`'s `findEffectiveRuleSet` documents,
 * and independent of any `orderBy` a caller does or doesn't add.
 */
export function findEffectiveFringeRateSchedule(
  schedules: FringeRateScheduleInput[],
  date: Date,
): FringeRateScheduleInput | null {
  const target = calendarDay(date);
  const matches = schedules.filter((s) => {
    const from = calendarDay(s.effectiveFrom);
    const to = s.effectiveTo == null ? null : calendarDay(s.effectiveTo);
    return from <= target && (to === null || target <= to);
  });

  if (matches.length === 0) return null;
  return matches.reduce((latest, candidate) =>
    calendarDay(candidate.effectiveFrom) > calendarDay(latest.effectiveFrom) ? candidate : latest,
  );
}

/** The BASE-WAGE half of one entry's cost -- hours x base wage x the
 * pay-type multiplier, with no fringes in it -- or null when no schedule is
 * effective, on the same refuse-to-guess rule as below.
 *
 * It exists for ONE caller: lib/employer-burden.ts, whose percentage is
 * applied to the base wage and NOT to the fringes (bona fide plan
 * contributions are generally outside the wage base employer payroll taxes
 * are computed on -- a modelling choice for a CPA to confirm, stated at
 * length in that file's header). Exported rather than recomputed there so
 * that the pay-type multiplier table has exactly one home: an overtime hour's
 * burden has to follow the same 1.5x this file already applies, and a second
 * copy of that table is how the two drift.
 *
 * NOT a public costing figure on its own. Nothing should render this: base
 * wage without fringes is not a number anybody on a job is asking for. */
export function calculateTimeEntryBaseWage(
  entry: TimeEntryLaborCostInput,
  schedule: FringeRateScheduleInput | null,
): number | null {
  if (!schedule) return null;
  return entry.hours * schedule.baseWage * PAY_TYPE_BASE_MULTIPLIER[entry.payType];
}

/** Computes the wage cost for one TimeEntry -- base wage at its pay-type
 * multiplier plus the four CBA fringes -- or null if no schedule is
 * effective for its craft/date; never guesses a rate.
 *
 * "Burdened" in this function's NAME means base-plus-fringes and has meant
 * that since it was written, which the file header states and lib/wip.ts
 * repeats. It does NOT include employer FICA, FUTA/SUTA or workers' comp:
 * those are lib/employer-burden.ts, added on top by the job-costing path
 * only, and deliberately NOT here -- a certified payroll (WH-347) and a
 * fringe remittance both want exactly this figure and would be wrong with an
 * employer tax inside it. */
export function calculateTimeEntryLaborCost(
  entry: TimeEntryLaborCostInput,
  schedule: FringeRateScheduleInput | null,
): number | null {
  if (!schedule) return null;
  const fringePerHour =
    (schedule.pensionRate ?? 0) +
    (schedule.vacationRate ?? 0) +
    (schedule.healthWelfareRate ?? 0) +
    (schedule.trainingRate ?? 0);
  const baseRate = schedule.baseWage * PAY_TYPE_BASE_MULTIPLIER[entry.payType];
  return entry.hours * (baseRate + fringePerHour);
}
