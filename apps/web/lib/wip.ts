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
   * forecast for this line. Null when there's no cost estimate at all
   * (budgetedUnitCost and currentEstimatedUnitCost both unset). */
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
  actualCostToDate: number;
  estimatedCostAtCompletion: number;
  /** Job-level % complete, weighted by cost (not a simple average of the
   * per-line percentages) — SUM(actual) / SUM(estimated cost at
   * completion) across only the lines that have a cost estimate. */
  percentComplete: number | null;
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

  const percentComplete = estimatedCostAtCompletion > 0 ? actualCostToDate / estimatedCostAtCompletion : null;

  return {
    contractValue,
    actualCostToDate,
    estimatedCostAtCompletion,
    percentComplete,
    earnedRevenue,
    billedToDate,
    overUnderBilling: billedToDate - earnedRevenue,
  };
}
