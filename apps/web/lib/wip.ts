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

import { formatHours } from "./render-hours";

/**
 * Burdened labor as job cost, split so a screen can name the parts.
 *
 * Produced by lib/labor-job-cost.ts (which owns the arithmetic and the
 * fringe-schedule lookup); declared HERE so this file stays pure arithmetic
 * with no imports, and so the two cannot drift into two shapes.
 *
 * `wageCost` is base-plus-fringe for the hours a fringe schedule could
 * price. `burdenCost` is the employer's share on top of that -- FICA,
 * FUTA/SUTA, workers' comp -- at the EmployerBurdenRate in force on each
 * entry's own day, and ZERO for a company that has recorded no rate, which
 * is every company until an owner enters one. `allowanceCost` is per diem
 * and travel pay, which are stored dollars and need no schedule. `total` is
 * whichever of those job cost currently counts -- see
 * LABOR_ALLOWANCES_IN_JOB_COST.
 *
 * `wageCost` and `burdenCost` are separate fields rather than one sum
 * because the screen has to be able to say which it is showing: the caption
 * that read "burdened rate" over a wage-and-fringes figure is the defect
 * this field exists to end, and a caption cannot follow a number it cannot
 * see inside.
 *
 * `unpricedHours` is the point of the split. Hours whose craft has no
 * effective fringe schedule get NO wage dollars, by design (labor-cost.ts
 * refuses to guess a rate). Carried up to the job result so the screen can
 * say "these hours are in here at zero" instead of quietly reading as a
 * fully-costed job.
 */
export interface WipLaborCost {
  wageCost: number;
  /** Employer burden on the BASE wages inside `wageCost`, never on the
   * fringes -- see lib/employer-burden.ts, which states why and that it is a
   * modelling choice for a CPA rather than a verified tax rule. 0 when no
   * EmployerBurdenRate is in force. */
  burdenCost: number;
  allowanceCost: number;
  total: number;
  pricedHours: number;
  unpricedHours: number;
}

/** No hours logged. A named constant because "no labor" is a real answer
 * that several call sites need, and five zeroes written out five times is
 * how two of them end up disagreeing. */
export const NO_LABOR_COST: WipLaborCost = {
  wageCost: 0,
  burdenCost: 0,
  allowanceCost: 0,
  total: 0,
  pricedHours: 0,
  unpricedHours: 0,
};

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
  /** Everything spent against this line item: SUM(CostEntry.amount) PLUS the
   * burdened labor on the TimeEntry rows that name it.
   *
   * It was cost entries alone until issue #287, and a CostEntry only ever
   * comes from the manual "log a cost" form -- so on a self-performed job
   * this was the materials and nothing else, and every percentage below was
   * drawn from roughly a third of the money.
   *
   * Composed by `lineItemCostToDate` in lib/labor-job-cost.ts, which is the
   * only thing that should be building this field. */
  actualCostToDate: number;
  /** The labor half of the figure above, kept alongside it rather than
   * folded away: it is what lets the job result report unpriced hours. Omit
   * for a line with no logged hours (or in a test that only cares about
   * cost entries) -- it defaults to NO_LABOR_COST. */
  labor?: WipLaborCost;
}

export interface WipLineItemResult {
  contractValue: number;
  budgetedCost: number | null;
  currentEstimatedCost: number | null;
  actualCostToDate: number;
  /** The labor inside actualCostToDate, unchanged from the input. */
  labor: WipLaborCost;
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
    labor: input.labor ?? NO_LABOR_COST,
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
   * earned revenue. Shrinking it would overstate company gross margin.
   *
   * Since issue #287 this includes burdened labor from TimeEntry rows, both
   * the ones that name a line item and the ones that do not. */
  actualCostToDate: number;
  /** The labor actually inside actualCostToDate. Equal to laborWageCost +
   * laborAllowanceCost while LABOR_ALLOWANCES_IN_JOB_COST is on, and to
   * laborWageCost alone when it is off -- which is why it is its own field
   * rather than a sum a reader is expected to do. */
  laborCostToDate: number;
  /** Wages inside actualCostToDate -- base plus fringes, over every hour a
   * fringe schedule could price. NOT the employer's share on top: that is
   * laborBurdenCost below, and conflating the two is what made the job-cost
   * caption wrong. */
  laborWageCost: number;
  /** The employer's share on top of those wages -- FICA, FUTA/SUTA, workers'
   * comp -- at the rate in force on each entry's own day. 0 for a company
   * with no EmployerBurdenRate recorded, which is every company until an
   * owner enters one on /settings, and that zero is what keeps this change
   * from moving anybody's existing figures. */
  laborBurdenCost: number;
  /** Per diem and travel pay inside actualCostToDate. Named apart from wages
   * because whether they belong in job cost at all is a live decision -- see
   * LABOR_ALLOWANCES_IN_JOB_COST in lib/labor-job-cost.ts. With that flip
   * off this is still counted and still reported, it is just not added in. */
  laborAllowanceCost: number;
  /** Burdened labor on time entries that name NO line item, already inside
   * actualCostToDate. It is in no LINE's cost, so it is not in
   * costOnForecastLines either and correctly pulls costCoverage down: the
   * percentage genuinely was not computed over this money. Logging hours
   * against "No specific line" is the form's default, so this is routinely
   * not zero. */
  unassignedLaborCost: number;
  /** Logged hours that carry a burdened cost. */
  pricedLaborHours: number;
  /** Hours with no craft tag, or whose craft has no fringe schedule
   * effective on the day worked. They sit in actualCostToDate at ZERO wage
   * dollars, because lib/labor-cost.ts refuses to guess a rate -- and
   * "refused to guess" reads exactly like "cost nothing" unless a screen
   * says otherwise. This is the field that lets it say so. */
  unpricedLaborHours: number;
  /** Share of logged hours that carry a burdened cost, 0..1 -- the labor
   * companion to costCoverage, and an HOURS ratio rather than a dollar one
   * on purpose: the dollars on the unpriced side are exactly what nobody can
   * compute, so a dollar share would have to invent the figure it is
   * warning about. 1 when no hours are logged: no hours means no uncosted
   * hours, the same convention costCoverage uses for no spend. */
  laborHourCoverage: number;
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
  /** Share of contract value sitting on lines that actually produced an
   * earned-revenue figure, 0..1. earnedRevenue below is summed with `?? 0`
   * while contractValue counts in full, so this is the number that says
   * whether that sum is a fact or an artefact of lines nobody has estimated
   * (issue #99). 0 when there is no contract value, matching the
   * hand-rolled ratios this replaces.
   *
   * It answers "are the estimates there", not "do the figures agree". A
   * cost-only line (unitPrice null — general conditions, overhead) has zero
   * contract value and sits on neither side of this ratio, so a job can
   * read fully covered and still show an earned revenue that does not equal
   * percentComplete × contract value. That is a separate shape of the same
   * family and this guard does not catch it. */
  earnedCoverage: number;
  /** The same question for the cost forecast, and NOT the same predicate:
   * a line estimated at zero cost has a non-null estimatedCostAtCompletion
   * and no earned revenue, so it is covered here and not above. Computed
   * once here because today-dashboard.ts and ask/handlers.ts each carried
   * their own hand-rolled copy and the job page had none. */
  estimatedCoverage: number;
  earnedRevenue: number;
  billedToDate: number;
  /** billedToDate - earnedRevenue. Positive = overbilled (liability on the
   * WIP schedule), negative = underbilled (asset). */
  overUnderBilling: number;
}

/** "42.0%", or null when there's nothing to divide by — the exact format
 * /jobs/[id] renders percentComplete in (one decimal place, a trailing
 * "%"). Shared with the Ask job_margin tool (lib/ask/handlers.ts) so an
 * answer and the screen it cites can never print two different numbers
 * for the same fraction. Before this existed, the tool handed over the
 * raw 0..1 fraction and the model — forbidden from doing arithmetic —
 * either said "0.4% complete" (the fraction, mistaken for the percentage)
 * or multiplied it itself, the one thing it must never do (issue #103,
 * finding 1). */
export function formatPercentComplete(percentComplete: number | null): string | null {
  return percentComplete != null ? `${(percentComplete * 100).toFixed(1)}%` : null;
}

/** "42%" — /jobs/[id]'s own format for a 0..1 coverage ratio (rounded, no
 * decimal): costCoverage, earnedCoverage, estimatedCoverage. Kept separate
 * from formatPercentComplete rather than reusing it because the page
 * itself uses a different rounding rule for coverage than for percent
 * complete — one shared function per on-screen format, not one function
 * pretending both formats are the same. */
export function formatCoveragePercent(coverage: number): string {
  return `${Math.round(coverage * 100)}%`;
}

/** Logged hours for display: "7.5", "16", never "7.500000000000001".
 *
 * KEPT AS A NAME, NOT AS AN IMPLEMENTATION. This was the original fix for
 * issue #287 and its body was correct; it was also one of THREE copies of
 * the same arithmetic in this app, and the other two sat on the two
 * certified-payroll pages while a fourth screen printed
 * "35.300000000000004" between them. The one implementation now lives in
 * `lib/render-hours.ts` and the reasoning is there; this alias stays so
 * the WIP call sites and `wip.test.ts`'s #287 cases keep reading in this
 * file's own vocabulary. `hoursRenderCensus.test.ts` fails the build if a
 * second implementation reappears. */
export const formatLoggedHours = formatHours;

/**
 * @param unassignedLabor Burdened labor on the job's TimeEntry rows that name
 * no line item. A third parameter rather than a fourth pseudo-line-item: a
 * synthetic line would land in `contractValue`, in `estimatedCostAtCompletion`
 * and in the forecast-line filter below, and inventing a $0-value line to
 * carry real cost is exactly the shape that reported a job as 550% complete
 * (issue #100). It defaults to NO_LABOR_COST so a caller that has not fetched
 * time entries gets the old behaviour rather than a silently wrong one.
 */
export function calculateJobWip(
  lineItems: WipLineItemResult[],
  billedToDate: number,
  unassignedLabor: WipLaborCost = NO_LABOR_COST,
): WipJobResult {
  const contractValue = lineItems.reduce((sum, item) => sum + item.contractValue, 0);
  const actualCostToDate =
    lineItems.reduce((sum, item) => sum + item.actualCostToDate, 0) + unassignedLabor.total;
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

  const earnedValue = lineItems
    .filter((item) => item.earnedRevenue !== null)
    .reduce((sum, item) => sum + item.contractValue, 0);
  const estimatedValue = lineItems
    .filter((item) => item.estimatedCostAtCompletion !== null)
    .reduce((sum, item) => sum + item.contractValue, 0);

  // Labor rolled up over the LINES plus the unattached entries, i.e. over
  // exactly the same population actualCostToDate is summed from — if these
  // two ever disagree about which entries they saw, the caveat on screen
  // would be describing a different job from the figure beside it.
  const laborCostToDate =
    lineItems.reduce((sum, item) => sum + item.labor.total, 0) + unassignedLabor.total;
  const laborWageCost =
    lineItems.reduce((sum, item) => sum + item.labor.wageCost, 0) + unassignedLabor.wageCost;
  const laborBurdenCost =
    lineItems.reduce((sum, item) => sum + item.labor.burdenCost, 0) + unassignedLabor.burdenCost;
  const laborAllowanceCost =
    lineItems.reduce((sum, item) => sum + item.labor.allowanceCost, 0) +
    unassignedLabor.allowanceCost;
  const pricedLaborHours =
    lineItems.reduce((sum, item) => sum + item.labor.pricedHours, 0) + unassignedLabor.pricedHours;
  const unpricedLaborHours =
    lineItems.reduce((sum, item) => sum + item.labor.unpricedHours, 0) +
    unassignedLabor.unpricedHours;
  const loggedHours = pricedLaborHours + unpricedLaborHours;

  return {
    contractValue,
    actualCostToDate,
    laborCostToDate,
    laborWageCost,
    laborBurdenCost,
    laborAllowanceCost,
    unassignedLaborCost: unassignedLabor.total,
    pricedLaborHours,
    unpricedLaborHours,
    laborHourCoverage: loggedHours > 0 ? pricedLaborHours / loggedHours : 1,
    estimatedCostAtCompletion,
    percentComplete,
    costCoverage: actualCostToDate > 0 ? costOnForecastLines / actualCostToDate : 1,
    earnedCoverage: contractValue > 0 ? earnedValue / contractValue : 0,
    estimatedCoverage: contractValue > 0 ? estimatedValue / contractValue : 0,
    earnedRevenue,
    billedToDate,
    overUnderBilling: billedToDate - earnedRevenue,
  };
}
