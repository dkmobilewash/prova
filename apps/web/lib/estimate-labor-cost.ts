import {
  calculateTimeEntryLaborCost,
  findEffectiveFringeRateSchedule,
  type FringeRateScheduleInput,
} from "./labor-cost";

/**
 * Burdened labor cost for a line item at bid time.
 *
 * `JobLineItem.laborHours` and `.craftClassificationId` have been captured
 * since the estimate was built, and the burden math has existed all along in
 * lib/labor-cost.ts — but only ever ran against logged TimeEntry rows. So a
 * PM could say "eighty hours of Local 300 journeyman" and the app knew what
 * that costs, and never said. Quantity takeoff in this market is already
 * ~97-98% accurate while projects still overrun ~28%, because the risk lives
 * in crew hours, not square feet. This is the number that makes that risk
 * visible while the bid can still change.
 *
 * Deliberately the same functions, not a parallel copy: an estimate that
 * computed burden differently from the actuals it will later be compared
 * against would make every variance partly an artefact of the arithmetic.
 *
 * Estimate hours are treated as STRAIGHT time. No overtime or double-time
 * concept exists at bid time — nobody plans a bid in OT hours — and
 * inventing a premium here would inflate every estimate.
 */
export function estimateBurdenedLaborCost(
  laborHours: number | null,
  schedules: FringeRateScheduleInput[],
  asOf: Date,
): number | null {
  if (laborHours === null || laborHours <= 0) return null;

  // Never guesses a rate: no schedule effective for this craft on this date
  // means no number, not the closest one. Showing a wrong burden is worse
  // than showing none, because a wrong one gets bid.
  const schedule = findEffectiveFringeRateSchedule(schedules, asOf);
  if (!schedule) return null;

  return calculateTimeEntryLaborCost({ hours: laborHours, payType: "STRAIGHT", date: asOf }, schedule);
}

/**
 * The date a bid's labor should be priced at: when the work is planned to
 * start, falling back to today.
 *
 * Union rates step on scheduled dates, so a job starting after an increase
 * should be bid at the rate that will actually be paid — not the rate in
 * force on the day someone happened to open the estimate.
 */
export function laborRateDateFor(job: { startDate: Date | null }, today: Date): Date {
  return job.startDate ?? today;
}

/**
 * The burdened cost of one hour for a craft, or null when no schedule is
 * effective on that date.
 *
 * Exists so a live hint can price hours as they're typed without a round
 * trip: the burden is linear in hours, so the server can send one rate per
 * craft and the client can multiply. Derived from estimateBurdenedLaborCost
 * rather than recomputing base + fringes, so the typed-in preview and the
 * figure shown on the saved line can't drift apart — a preview that quotes a
 * different number from the row it creates is worse than no preview.
 */
export function burdenedHourlyRate(
  schedules: FringeRateScheduleInput[],
  asOf: Date,
): number | null {
  return estimateBurdenedLaborCost(1, schedules, asOf);
}
