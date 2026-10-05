import {
  calculateTimeEntryBaseWage,
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
 *
 * ── THE EMPLOYER BURDEN IS IN HERE AS OF 2026-10-04, AND IT HAD TO BE ──
 *
 * The paragraph above says this reuses the actuals functions so that a variance
 * is never "partly an artefact of the arithmetic". For a year it then did the
 * one thing that sentence forbids: `calculateTimeEntryLaborCost` is base wage
 * plus the four CBA fringes and stops, while the job costing this estimate is
 * later compared against adds employer FICA, FUTA/SUTA and workers' comp on top
 * (`lib/labor-job-cost.ts`). Same hours, two bases — so every job showed a labor
 * overrun of roughly the burden percentage, systematically, and because percent
 * complete is cost-to-cost the completion figure drifted with it.
 *
 * Nothing in the code ever argued for that asymmetry; the burden simply lived
 * one layer above, in a path the estimate does not go through. Diego's call,
 * 2026-10-04: the estimate prices labor the way the job costs it.
 *
 * **THE PERCENTAGE MULTIPLIES THE BASE WAGE ONLY, NEVER THE FRINGES.**
 * `lib/employer-burden.ts` states that as a modelling choice for a CPA to
 * confirm — bona fide benefit-plan contributions sit outside the wage base
 * employer payroll taxes are computed on. The estimate must not invent a second
 * rule, so it asks the same question of the same base-wage function the actuals
 * use (`calculateTimeEntryBaseWage`, exported for exactly this kind of caller).
 *
 * **WITH NO RATE RECORDED, NOTHING MOVES.** `employerBurdenPercentOn` returns
 * null for a company that has never recorded one, every figure here is then
 * byte-identical to what it was, and that is also the opt-out for a shop that
 * carries burden inside its overhead percentage instead: don't record a rate and
 * nothing is counted twice.
 *
 * **AND IT DOES NOT ROUND, WHERE THE ACTUALS PATH DOES.** That is deliberate and
 * is not a second rule. `labor-job-cost.ts` accumulates base wages across many
 * `TimeEntry` rows and rounds once at the end because it posts a ledger figure.
 * This is ONE line, the cost is linear in hours, and `calculateTimeEntryLaborCost`
 * above is itself unrounded for the same reason — rounding happens exactly once,
 * when a figure is written to a `Decimal(12,2)` money column. Rounding here would
 * also break the property `burdenedHourlyRate` depends on, that rate × hours is
 * the line's own figure to nine decimal places; a preview that quotes a different
 * number from the row it creates is worse than no preview.
 *
 * `employerBurdenPercent` is REQUIRED rather than defaulted, so a new caller has
 * to decide rather than silently inherit "no burden" — the compiler asking the
 * question is the only thing that stops this drifting apart again.
 */
export function estimateBurdenedLaborCost(
  laborHours: number | null,
  schedules: FringeRateScheduleInput[],
  asOf: Date,
  employerBurdenPercent: number | null,
): number | null {
  if (laborHours === null || laborHours <= 0) return null;

  // Never guesses a rate: no schedule effective for this craft on this date
  // means no number, not the closest one. Showing a wrong burden is worse
  // than showing none, because a wrong one gets bid.
  const schedule = findEffectiveFringeRateSchedule(schedules, asOf);
  if (!schedule) return null;

  const entry = { hours: laborHours, payType: "STRAIGHT" as const, date: asOf };
  const wageCost = calculateTimeEntryLaborCost(entry, schedule);
  if (wageCost === null || employerBurdenPercent === null) return wageCost;

  const baseWage = calculateTimeEntryBaseWage(entry, schedule);
  if (baseWage === null) return wageCost;

  // A percentage, so `/ 100`. Unrounded — see the header.
  return wageCost + (baseWage * employerBurdenPercent) / 100;
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
  employerBurdenPercent: number | null,
): number | null {
  return estimateBurdenedLaborCost(1, schedules, asOf, employerBurdenPercent);
}
