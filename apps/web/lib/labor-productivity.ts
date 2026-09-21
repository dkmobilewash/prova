/**
 * Labor productivity — the forward half (rate → hours) and the back-check
 * (actual hours → achieved rate, against the estimate).
 *
 * The competitive-audit finding #1, in one file. A takeoff tool measures
 * quantities; an estimating tool says how FAST a crew does the work. That is a
 * production rate, units per hour, and it is what lets a sub back-check a bid
 * against what the crew actually produced once the job runs.
 *
 * Both halves are pure. The forward half turns a rate into estimated hours
 * (quantity / rate), with `laborHours` as a manual override. The back-check
 * turns actual hours — summed from TimeEntry rows by lib/labor-job-cost.ts —
 * back into the achieved rate and compares it to the estimate. Nothing here
 * writes; derived state is never stored (CLAUDE.md). The rate is an input, the
 * hours and the variance are computed at read time, every time.
 */

/** How far an actual rate can miss the estimate before it is worth flagging.
 * The same 15% as CATALOG_VARIANCE_THRESHOLD: estimating is not meant to be
 * exact, and flagging a few percent of drift trains people to ignore the flag. */
export const PRODUCTION_VARIANCE_THRESHOLD = 0.15;

/** Minimum actual hours before an achieved rate means anything. A crew-day of
 * hours; below that, one lost afternoon reads as a 200% miss. */
export const MIN_ACTUAL_HOURS = 8;

/** Derived estimated hours from a production rate: quantity / rate. Null when
 * there is nothing to divide. */
export function hoursFromRate(quantity: number, productionRate: number | null): number | null {
  if (productionRate == null || productionRate <= 0 || quantity <= 0) return null;
  return quantity / productionRate;
}

/** The line's estimated hours. A manually-typed `laborHours` is the override; a
 * production rate derives the rest. Null when neither is given. */
export function estimatedHours(input: {
  quantity: number;
  laborHours: number | null;
  productionRate: number | null;
}): number | null {
  if (input.laborHours != null && input.laborHours > 0) return input.laborHours;
  return hoursFromRate(input.quantity, input.productionRate);
}

/** The achieved rate, units per hour, from what was actually logged. Null when
 * nothing was measured or produced. */
export function actualProductionRate(quantity: number, actualHours: number): number | null {
  if (quantity <= 0 || actualHours <= 0) return null;
  return quantity / actualHours;
}

/** (actual - estimated) / estimated. Negative means slower than estimated. */
export function productionRateVariance(actualRate: number, estimatedRate: number): number | null {
  if (estimatedRate <= 0) return null;
  return (actualRate - estimatedRate) / estimatedRate;
}

export type ProductionBackCheck = {
  /** Estimated units/hr — what the bid assumed. */
  estimatedRate: number;
  /** Achieved units/hr — what the crew actually did. */
  actualRate: number;
  /** (actual - estimated) / estimated; negative = slower than estimated. */
  variance: number;
  /** The actual hours this is derived from, so the UI can show the sample size. */
  actualHours: number;
  /** Variance past the threshold — worth a look, not necessarily wrong. */
  isFlagged: boolean;
};

/** The whole back-check, or null when there is nothing to compare: no estimate,
 * or fewer than MIN_ACTUAL_HOURS of actuals logged. */
export function productionBackCheck(input: {
  quantity: number;
  estimatedHours: number | null;
  actualHours: number;
}): ProductionBackCheck | null {
  const { quantity, actualHours } = input;
  if (quantity <= 0 || input.estimatedHours == null || input.estimatedHours <= 0) return null;
  if (actualHours < MIN_ACTUAL_HOURS) return null;

  const estimatedRate = quantity / input.estimatedHours;
  const achieved = actualProductionRate(quantity, actualHours);
  if (achieved == null) return null;
  const variance = productionRateVariance(achieved, estimatedRate);
  if (variance == null) return null;

  return {
    estimatedRate,
    actualRate: achieved,
    variance,
    actualHours,
    isFlagged: Math.abs(variance) >= PRODUCTION_VARIANCE_THRESHOLD,
  };
}
