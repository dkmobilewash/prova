// Burdened labor cost math -- turning a logged TimeEntry into a wage cost
// using the FringeRateSchedule effective for its craft classification and
// date. Pure arithmetic, deliberately not an LLM call, same reasoning as
// lib/wip.ts.
//
// Per prevailing-wage/Davis-Bacon convention: overtime and double-time
// multiply the BASE wage only -- fringe benefits (pension, vacation,
// health & welfare, training) are paid at their flat per-hour rate
// regardless of pay type.

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

/** The UTC calendar day an instant falls on, as milliseconds at UTC midnight.
 *
 * Every effective date in this app is stored at UTC midnight, and so is
 * every `TimeEntry.date` -- but not every caller asking "what rate applied?"
 * hands in a midnight date. `laborRateDateFor` in lib/estimate-labor-cost.ts
 * falls back to `new Date()`, which carries a time of day. Comparing that
 * raw against a midnight `effectiveTo` answers NO for every instant after
 * 00:00:00.000 on the schedule's own FINAL day, so a rate the setup screen
 * badges "in force" silently stops pricing a whole day early.
 *
 * That is one clock (an instant) being measured against another (a calendar
 * date) -- the shape of issue #155. Both sides are reduced to a UTC calendar
 * day here so there is only one clock left. For a date already at UTC
 * midnight this is the identity, so nothing about logged time changes.
 */
function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Whether two effective-dated ranges cover a day in common, with
 * `effectiveTo` INCLUSIVE.
 *
 * Inclusive is what the whole application means by it: the setup screen
 * badges a schedule "in force" through its `effectiveTo`, and
 * `findEffectiveFringeRateSchedule` prices that day. The database's
 * exclusion constraint does NOT agree -- it is built on
 * `tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'))`, which is
 * half-open and so treats a schedule ending 06-30 and one starting 06-30 as
 * non-overlapping. Postgres accepts that pair; the app then finds both of
 * them in force on 06-30. Eight straight hours cost one figure or another
 * depending on nothing but which row came back first.
 *
 * So this is the check that has to run in the action, on top of the
 * constraint rather than instead of it -- the constraint still catches
 * everything a concurrent write could slip past this.
 */
export function effectiveRangesOverlap(
  a: { effectiveFrom: Date; effectiveTo: Date | null },
  b: { effectiveFrom: Date; effectiveTo: Date | null },
): boolean {
  const aFrom = utcDay(a.effectiveFrom);
  const aTo = a.effectiveTo === null ? Number.POSITIVE_INFINITY : utcDay(a.effectiveTo);
  const bFrom = utcDay(b.effectiveFrom);
  const bTo = b.effectiveTo === null ? Number.POSITIVE_INFINITY : utcDay(b.effectiveTo);
  return aFrom <= bTo && bFrom <= aTo;
}

/** Finds the FringeRateSchedule effective on a given date, or null if none
 * applies. Never picks the "closest" one -- paying the wrong era's rate is
 * worse than surfacing nothing.
 *
 * Deliberately NOT `.find()`. `.find()` returns whichever matching row the
 * caller's query happened to put first, and two of the three call sites
 * (`jobs/[id]/page.tsx`, `certified-payroll/page.tsx`) do not order their
 * `fringeRateSchedules` include at all -- so on a changeover day, where the
 * old schedule's inclusive `effectiveTo` and the new one's `effectiveFrom`
 * are the same date, the wage printed on a signed sheet could differ
 * between two loads of the same page. Selecting the LATEST-STARTING
 * schedule in force makes the answer a property of the data instead of a
 * property of the query: a rate that steps on a date steps ON that date.
 */
export function findEffectiveFringeRateSchedule(
  schedules: FringeRateScheduleInput[],
  date: Date,
): FringeRateScheduleInput | null {
  const day = utcDay(date);
  let best: FringeRateScheduleInput | null = null;
  for (const schedule of schedules) {
    const from = utcDay(schedule.effectiveFrom);
    if (from > day) continue;
    if (schedule.effectiveTo !== null && utcDay(schedule.effectiveTo) < day) continue;
    if (best === null || from > utcDay(best.effectiveFrom)) best = schedule;
  }
  return best;
}

/** Computes the burdened wage cost for one TimeEntry, or null if no
 * schedule is effective for its craft/date -- never guesses a rate. */
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
