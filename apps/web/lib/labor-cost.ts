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

/** Finds the FringeRateSchedule effective on a given date, or null if none
 * applies. Never picks the "closest" one -- paying the wrong era's rate is
 * worse than surfacing nothing. */
export function findEffectiveFringeRateSchedule(
  schedules: FringeRateScheduleInput[],
  date: Date,
): FringeRateScheduleInput | null {
  return (
    schedules.find((s) => s.effectiveFrom <= date && (s.effectiveTo == null || date <= s.effectiveTo)) ?? null
  );
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
