// Percentage-of-completion WIP math — the cost-to-cost method, the
// standard approach sureties and CPAs expect on a WIP schedule. Pure
// arithmetic, deliberately not an LLM call: financial figures on a WIP
// report have to be exactly reproducible, not generated.
//
// Formulas (per job line item, then aggregated to the job):
//   % complete   = actual costs to date ÷ estimated total cost at completion
//   earned rev.  = % complete × contract value (quantity × unitPrice)
//   over/under   = billed to date − earned revenue
//     (positive = overbilled/liability, negative = underbilled/asset)
//
// "Estimated total cost at completion" is actual-to-date + cost-to-
// complete. Cost-to-complete is the PM's explicit estimatedCostToComplete
// override when set; otherwise it's derived mechanically as
// (currentEstimatedUnitCost × quantity) − actual-to-date, floored at 0.

export interface WipLineItemInput {
  quantity: number;
  /** Sale price per unit. Null for a cost-only budget line (general
   * conditions, overhead, contingency) — contributes $0 to contract value. */
  unitPrice: number | null;
  /** Historical baseline, set once at estimate approval. Not used in the
   * live math below (currentEstimatedUnitCost is) — kept on the result for
   * "budget vs. current forecast" comparison in the UI. */
  budgetedUnitCost: number | null;
  /** The PM's current cost forecast per unit. Feeds the mechanical
   * cost-to-complete derivation when estimatedCostToComplete isn't set. */
  currentEstimatedUnitCost: number | null;
  /** PM override for cost-to-complete. When null, derived mechanically. */
  estimatedCostToComplete: number | null;
  /** SUM(CostEntry.amount) for this line item. */
  actualCostToDate: number;
}

export interface WipLineItemResult {
  contractValue: number;
  budgetedCost: number | null;
  currentEstimatedCost: number | null;
  actualCostToDate: number;
  /** Actual-to-date + cost-to-complete, i.e. the current total cost
   * forecast for this line. Null when there's no cost forecast at all —
   * estimatedCostToComplete and currentEstimatedUnitCost both unset.
   * budgetedUnitCost is NOT consulted (see the derivation below): it is the
   * frozen historical baseline, kept for display only. This comment used to
   * name budgetedUnitCost instead of estimatedCostToComplete, which is where
   * issue #100's "budgeted lines" wording came from — anyone writing a fix
   * against budgetedUnitCost is fixing a field this math never reads. */
  estimatedCostAtCompletion: number | null;
  costToComplete: number | null;
  /** Null when estimatedCostAtCompletion is null or zero — there's nothing
   * to divide by, so "% complete" isn't a meaningful number yet. */
  percentComplete: number | null;
  earnedRevenue: number | null;
}

export function calculateLineItemWip(input: WipLineItemInput): WipLineItemResult {
  const contractValue = input.quantity * (input.unitPrice ?? 0);
  const budgetedCost = input.budgetedUnitCost != null ? input.quantity * input.budgetedUnitCost : null;
  const currentEstimatedCost =
    input.currentEstimatedUnitCost != null ? input.quantity * input.currentEstimatedUnitCost : null;

  const costToComplete =
    input.estimatedCostToComplete != null
      ? input.estimatedCostToComplete
      : currentEstimatedCost != null
        ? Math.max(currentEstimatedCost - input.actualCostToDate, 0)
        : null;

  const estimatedCostAtCompletion =
    costToComplete != null ? input.actualCostToDate + costToComplete : currentEstimatedCost;

  const percentComplete =
    estimatedCostAtCompletion != null && estimatedCostAtCompletion > 0
      ? input.actualCostToDate / estimatedCostAtCompletion
      : null;

  const earnedRevenue = percentComplete != null ? percentComplete * contractValue : null;

  return {
    contractValue,
    budgetedCost,
    currentEstimatedCost,
    actualCostToDate: input.actualCostToDate,
    estimatedCostAtCompletion,
    costToComplete,
    percentComplete,
    earnedRevenue,
  };
}

export interface WipJobResult {
  contractValue: number;
  /** Every dollar booked against this job, on forecast lines or not. The
   * job's real spend — deliberately NOT narrowed to the lines that feed
   * percentComplete below, because this is the figure the "Actual cost to
   * date" tile shows and the one calculateCompanyFinancials subtracts from
   * earned revenue. Shrinking it would overstate company gross margin. */
  actualCostToDate: number;
  estimatedCostAtCompletion: number;
  /** Job-level % complete, weighted by cost (not a simple average of the
   * per-line percentages) — SUM(actual) / SUM(estimated cost at completion)
   * across only the lines that carry a usable cost forecast, BOTH SIDES
   * over that same set of lines. A line with no forecast contributes
   * neither its cost nor a denominator; summing its cost against a
   * denominator it is not part of is what reported a job as 550% complete
   * (issue #100). Null when no line carries a usable forecast. */
  percentComplete: number | null;
  /** What share of actualCostToDate the percentage above was computed over,
   * 0..1. The honest companion to percentComplete: a job with $306k of
   * spend whose percentage is drawn from $96k of it is not 30% complete in
   * any sense a surety would recognise, it is 30% complete on the third of
   * the spend anyone has forecast. 1 when there is no spend at all — no
   * spend means no uncounted spend. */
  costCoverage: number;
  earnedRevenue: number;
  billedToDate: number;
  /** billedToDate - earnedRevenue. Positive = overbilled (liability on the
   * WIP schedule), negative = underbilled (asset). */
  overUnderBilling: number;
}

export function calculateJobWip(lineItems: WipLineItemResult[], billedToDate: number): WipJobResult {
  const contractValue = lineItems.reduce((sum, item) => sum + item.contractValue, 0);
  const actualCostToDate = lineItems.reduce((sum, item) => sum + item.actualCostToDate, 0);
  const earnedRevenue = lineItems.reduce((sum, item) => sum + (item.earnedRevenue ?? 0), 0);
  const estimatedCostAtCompletion = lineItems.reduce(
    (sum, item) => sum + (item.estimatedCostAtCompletion ?? 0),
    0,
  );

  // The same predicate calculateLineItemWip already uses to decide whether a
  // LINE has a % complete. `!== null` alone is not enough: a negative
  // cost-to-complete override (the form field is plain text and only NaN is
  // rejected) drives a line's forecast to exactly 0, which passes a null
  // check, donates its real cost to the numerator and nothing to the
  // denominator, and reproduces the identical defect one layer down.
  const forecastLines = lineItems.filter(
    (item): item is WipLineItemResult & { estimatedCostAtCompletion: number } =>
      item.estimatedCostAtCompletion !== null && item.estimatedCostAtCompletion > 0,
  );
  const forecastCost = forecastLines.reduce((sum, item) => sum + item.estimatedCostAtCompletion, 0);
  const costOnForecastLines = forecastLines.reduce((sum, item) => sum + item.actualCostToDate, 0);

  const percentComplete = forecastCost > 0 ? costOnForecastLines / forecastCost : null;

  return {
    contractValue,
    actualCostToDate,
    estimatedCostAtCompletion,
    percentComplete,
    costCoverage: actualCostToDate > 0 ? costOnForecastLines / actualCostToDate : 1,
    earnedRevenue,
    billedToDate,
    overUnderBilling: billedToDate - earnedRevenue,
  };
}
