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
};

export type CatalogActuals = {
  /** Lines that have real costs behind them — the sample size. */
  linesWithCosts: number;
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
  const costed = lines.filter((line) => line.hasCosts);
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
