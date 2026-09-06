/**
 * How work priced from a catalog entry actually costed.
 *
 * `LineItemCatalogEntry.defaultBudgetedUnitCost` is set once — typed in, or
 * copied off a JobLineItem via "save as catalog item" — and then never
 * learns anything. Every job that used it produces real CostEntry rows
 * sitting one table away, and nothing ever reads them back. This closes that
 * loop: what the template says a unit costs, against what it has actually
 * cost across every line created from it.
 *
 * Reporting only. Nothing here writes; the catalog default changes only when
 * a human clicks to update it, and even then only the template moves — never
 * a JobLineItem that already exists.
 */

/** A line created from a catalog entry, with the costs logged against it. */
export type CatalogSourcedLine = {
  quantity: number;
  /** SUM of this line's CostEntry amounts. */
  actualCost: number;
  /** Whether any cost has been logged at all. */
  hasCosts: boolean;
  /**
   * Status of the job this line sits on.
   *
   * Load-bearing, not decoration — see FINISHED_JOB_STATUSES. Cost lands
   * on a line over the months the work takes; quantity is the whole scope
   * from day one. Divide one by the other before the work is done and the
   * answer is not a unit cost, it is a fraction of one.
   */
  jobStatus: JobStatusForActuals;
};

export type JobStatusForActuals = "ESTIMATE" | "CONTRACTED" | "IN_PROGRESS" | "COMPLETE";

/**
 * The only status whose costs are finished arriving.
 *
 * This is the whole of the fix for a defect that was quietly one-directional:
 * a line 40% built at a true $2.00/SF booked 40% of its cost against 100% of
 * its quantity and reported $0.80. That is 60% under, it goes amber saying
 * "worth re-pricing", and one click writes it into the template that prices
 * every future bid and grounds the AI drafts. Every unfinished job biases the
 * same way — DOWN — so the errors reinforce rather than cancel, and the
 * catalog walks its own prices toward zero as long as anyone keeps clicking.
 *
 * A partially-costed COMPLETE job is a different thing and stays in: the work
 * is done, so what it cost is what it cost.
 */
export const FINISHED_JOB_STATUSES: readonly JobStatusForActuals[] = ["COMPLETE"];

export function isFinishedForActuals(line: CatalogSourcedLine): boolean {
  return FINISHED_JOB_STATUSES.includes(line.jobStatus);
}

export type CatalogActuals = {
  /** Costed lines on FINISHED jobs — the sample size, and the only lines
   * any figure here is computed from. */
  linesWithCosts: number;
  /**
   * Costed lines left out because their job is still running.
   *
   * Reported rather than dropped in silence: "no costed jobs have used this
   * entry yet" and "three jobs have used it and none has finished" are
   * different sentences, and an estimator who cannot tell them apart will
   * read a missing figure as a missing feature.
   */
  linesExcludedUnfinished: number;
  /** Total cost across those lines, over total quantity. Null when nothing
   * has been costed, or when the quantities sum to zero. */
  actualUnitCost: number | null;
  defaultBudgetedUnitCost: number | null;
  /** actual - default, in dollars per unit. Null unless both exist. */
  variance: number | null;
  /** Variance as a fraction of the default (0.2 = 20% over). Null unless
   * both exist and the default is non-zero. */
  variancePct: number | null;
  /** True when the entry is priced far enough off actuals to be worth a
   * look. Never true on a single line — one job is an anecdote. */
  isFlagged: boolean;
};

/**
 * How far off a default has to be before it's worth flagging.
 *
 * Estimating is not supposed to be exact, and a catalog default that is
 * within a few percent of actuals is doing its job. Flagging those would
 * train people to ignore the flag, which costs more than the drift does.
 */
export const CATALOG_VARIANCE_THRESHOLD = 0.15;

/**
 * At least this many costed lines before flagging. One job that went badly
 * is not evidence the template is wrong, and re-pricing the catalog off a
 * single bad job propagates that job's problem into every future bid.
 */
export const CATALOG_MIN_SAMPLE = 2;

export function catalogActuals(
  lines: CatalogSourcedLine[],
  defaultBudgetedUnitCost: number | null,
): CatalogActuals {
  const costedAnywhere = lines.filter((line) => line.hasCosts);
  const costed = costedAnywhere.filter(isFinishedForActuals);
  const totalQuantity = costed.reduce((sum, line) => sum + line.quantity, 0);
  const totalCost = costed.reduce((sum, line) => sum + line.actualCost, 0);

  // Weighted by quantity rather than averaging each line's own unit cost: a
  // 500 SF line and a 5 SF line are not equal evidence of what a square foot
  // costs, and averaging the per-line rates would treat them as if they were.
  const actualUnitCost = costed.length > 0 && totalQuantity > 0 ? totalCost / totalQuantity : null;

  const bothKnown = actualUnitCost !== null && defaultBudgetedUnitCost !== null;
  const variance = bothKnown ? actualUnitCost - defaultBudgetedUnitCost : null;
  const variancePct =
    bothKnown && defaultBudgetedUnitCost !== 0 ? variance! / defaultBudgetedUnitCost : null;

  return {
    linesWithCosts: costed.length,
    linesExcludedUnfinished: costedAnywhere.length - costed.length,
    actualUnitCost,
    defaultBudgetedUnitCost,
    variance,
    variancePct,
    isFlagged:
      variancePct !== null &&
      costed.length >= CATALOG_MIN_SAMPLE &&
      Math.abs(variancePct) >= CATALOG_VARIANCE_THRESHOLD,
  };
}
