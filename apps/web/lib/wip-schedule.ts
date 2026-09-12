import { toCsv } from "./export";
import { money } from "./money";
import {
  MIN_EARNED_COVERAGE,
  MIN_ESTIMATE_COVERAGE,
  jobCostVariance,
  jobEarnedRevenue,
  jobOverUnderBilling,
} from "./company-financials";
import {
  calculateJobWip,
  formatCoveragePercent,
  formatPercentComplete,
  type WipJobResult,
  type WipLineItemResult,
} from "./wip";

/**
 * The work-in-progress schedule — the one document a surety underwriter and
 * a CPA ask a subcontractor for, and the thing bonding capacity is decided
 * from.
 *
 * WHY THIS FILE COMPOSES RATHER THAN COMPUTES. Every figure below already
 * existed: lib/wip.ts does the cost-to-cost math per line and per job,
 * lib/company-financials.ts owns the refusals (when a figure is too thinly
 * estimated to state), and lib/change-order.ts values an approved change
 * order from its own applied snapshots. Not one number is re-derived here.
 * That is deliberate to the point of being the design: a WIP schedule whose
 * percent complete disagrees with the percent complete on /jobs/[id] is
 * worse than no schedule, because the disagreement is discovered by the
 * underwriter rather than by us.
 *
 * The job page's % complete tile already says, in a comment, that it "is
 * what a surety's WIP schedule gets typed from". This is that schedule, and
 * it is typed from the same functions rather than from the screen.
 *
 * WHAT IS NOT HERE, AND WHY THAT IS THE POINT.
 *
 * A WIP schedule with an invented number in it is worse than one with an
 * honest gap, so every figure that this schema cannot establish is BLANK
 * and carries a sentence in the Notes column saying which and why. Three
 * of them recur:
 *
 *   - Earned revenue and the over/under-billing pair are blank below
 *     MIN_EARNED_COVERAGE, exactly as the job page leaves them blank, and
 *     for the same reason: below it the position is mostly made of lines
 *     assumed to have earned nothing while their billing counts in full.
 *   - The forecast margin is blank below MIN_ESTIMATE_COVERAGE, the same
 *     refusal jobHealthSentence makes.
 *   - The original-contract / approved-change-order split is blank when any
 *     approved change order on the job carries an EDIT or REMOVE proposal
 *     with no applied snapshot. See originalContractValue below.
 *
 * HOW THE ORIGINAL CONTRACT VALUE IS ESTABLISHED, since a surety asks for
 * it as a column of its own. There is no stored "original contract value"
 * and there must not be one — derived state is never stored here. It is
 * arithmetic instead: once a job leaves ESTIMATE, `assertEditableDirectly`
 * refuses every direct edit to a line item's quantity or price, so a change
 * order is the ONLY thing that can move contract value after that point.
 * Original = revised − the approved change orders, exactly.
 *
 * That identity has one hole and it is detectable rather than silent. A
 * change order approved before ChangeOrderProposal gained its
 * previous* snapshot columns has no record of what it replaced, so
 * `changeOrderValueDelta` values its EDIT and REMOVE proposals at zero and
 * the split would silently overstate the original contract. The caller
 * counts those proposals and this file blanks BOTH columns when there are
 * any, rather than printing a number that is wrong by an unknown amount.
 */

/** Cents. Float noise has no business on a document an underwriter reads. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface WipScheduleJobInput {
  jobId: string;
  jobName: string;
  /** The GC. A surety reads the schedule by customer as much as by job. */
  customerName: string;
  status: string;
  /** Per-line results from calculateLineItemWip, deleted lines already out.
   * The job-level figures are computed from these by calculateJobWip — this
   * file never sums a line total itself. */
  lineItems: WipLineItemResult[];
  /** SUM(Invoice.amount) for the job. */
  billedToDate: number;
  /** What the APPROVED change orders on this job moved contract value by,
   * from changeOrderValueDelta — positive for added scope, negative for
   * removed. Zero on a job that has never had one. */
  approvedChangeOrderValue: number;
  /** Approved EDIT/REMOVE proposals with no applied snapshot, i.e. ones
   * whose contract-value delta `changeOrderValueDelta` has to value at zero.
   * Any at all and the original/approved split is refused. */
  unestablishedApprovedProposals: number;
}

export interface WipScheduleRow {
  jobId: string;
  jobName: string;
  customerName: string;
  status: string;
  /** Revised minus approved change orders. Null when the split cannot be
   * established — see the header. */
  originalContractValue: number | null;
  /** Null alongside originalContractValue, for the same reason: half a
   * split is not a fact, it is an invitation to subtract. */
  approvedChangeOrders: number | null;
  /** SUM(quantity × unitPrice) over the live lines — the contract value the
   * job page, the metric bar and every invoice already agree on. */
  revisedContractValue: number;
  /** The frozen estimate-approval baseline, summed over the lines that carry
   * one. Null when no line does. */
  budgetedCost: number | null;
  costToDate: number;
  /** SUM of the per-line cost-to-complete. Deliberately NOT
   * (cost at completion − cost to date): on a job with spend on lines nobody
   * has forecast, those two differ, and the subtraction would report a
   * negative cost-to-complete. */
  estimatedCostToComplete: number;
  /** calculateJobWip's figure, which is the one the job page's forecast and
   * jobCostVariance already use. Equals costToDate + estimatedCostToComplete
   * only when every dollar of cost sits on a forecast line; the Notes column
   * says so, with the amount, when it does not. */
  estimatedCostAtCompletion: number;
  /** Cost-to-cost, 0..1. Null when no line carries a usable forecast. */
  percentComplete: number | null;
  /** Null below MIN_EARNED_COVERAGE, exactly as the job page leaves it. */
  earnedRevenue: number | null;
  billedToDate: number;
  /** The underbilled side — an asset. Zero rather than null when the
   * position is established and the job is overbilled. */
  costsInExcessOfBillings: number | null;
  /** The overbilled side — a liability. */
  billingsInExcessOfCosts: number | null;
  /** Revised contract − estimated cost at completion. Null below
   * MIN_ESTIMATE_COVERAGE. */
  forecastGrossProfit: number | null;
  /** The same figure over revised contract value, 0..1. */
  forecastGrossMarginRate: number | null;
  /** Every refusal and every discrepancy on this row, in words. Empty when
   * the row is complete, which is the common case on a fully estimated job. */
  notes: string[];
}

export interface WipScheduleTotals {
  /** How many job rows this schedule covers. */
  jobCount: number;
  originalContractValue: number | null;
  approvedChangeOrders: number | null;
  revisedContractValue: number;
  budgetedCost: number | null;
  costToDate: number;
  estimatedCostToComplete: number;
  estimatedCostAtCompletion: number;
  earnedRevenue: number | null;
  billedToDate: number;
  costsInExcessOfBillings: number | null;
  billingsInExcessOfCosts: number | null;
  forecastGrossProfit: number | null;
  forecastGrossMarginRate: number | null;
  /** Which totals dropped rows, and how many. A total that silently omits a
   * job is a floor presented as a total — the same rule countUnbookable
   * follows in lib/change-order.ts. */
  notes: string[];
}

export interface WipSchedule {
  rows: WipScheduleRow[];
  totals: WipScheduleTotals;
}

function buildRow(input: WipScheduleJobInput): WipScheduleRow {
  const wip: WipJobResult = calculateJobWip(input.lineItems, input.billedToDate);

  const notes: string[] = [];

  // ---- the original / approved-change-order split -------------------------
  const splitEstablished = input.unestablishedApprovedProposals === 0;
  if (!splitEstablished) {
    const n = input.unestablishedApprovedProposals;
    notes.push(
      `${n} approved change-order ${n === 1 ? "proposal has" : "proposals have"} no record of the value ${n === 1 ? "it" : "they"} replaced, so the original contract value and the approved change-order total cannot be established. Revised contract value is unaffected.`,
    );
  }

  // ---- budget -------------------------------------------------------------
  const budgetedLines = input.lineItems.filter((line) => line.budgetedCost !== null);
  const budgetedCost =
    budgetedLines.length === 0
      ? null
      : round2(budgetedLines.reduce((sum, line) => sum + (line.budgetedCost ?? 0), 0));
  const budgetedValue = budgetedLines.reduce((sum, line) => sum + line.contractValue, 0);
  const budgetCoverage = wip.contractValue > 0 ? budgetedValue / wip.contractValue : 0;
  // Only worth saying on a job that HAS contract value to cover. A job made
  // entirely of cost-only lines (general conditions, overhead) has none, and
  // "budget covers 0% of contract value" there describes the denominator
  // rather than the budget.
  if (budgetedCost !== null && wip.contractValue > 0 && budgetCoverage < 1) {
    notes.push(
      `Budgeted cost covers ${formatCoveragePercent(budgetCoverage)} of contract value — the rest of the job carries no approved-estimate baseline.`,
    );
  }

  // ---- cost to complete ---------------------------------------------------
  // Summed from the lines rather than subtracted from the cost at
  // completion. See the field comment: the subtraction goes negative on a
  // job with spend on unforecast lines.
  const estimatedCostToComplete = round2(
    input.lineItems.reduce((sum, line) => sum + (line.costToComplete ?? 0), 0),
  );

  const uncoveredCost = round2(wip.actualCostToDate * (1 - wip.costCoverage));
  if (uncoveredCost > 0) {
    notes.push(
      `${formatCoveragePercent(1 - wip.costCoverage)} of cost to date (${money(uncoveredCost)}) sits on lines with no cost forecast. It is inside cost to date and inside neither estimated cost to complete nor estimated cost at completion, so those three do not add up on this row.`,
    );
  }

  // ---- earned revenue and the billing position ----------------------------
  const earnedRevenue = jobEarnedRevenue(wip);
  const position = jobOverUnderBilling(wip);
  if (earnedRevenue === null || position === null) {
    notes.push(
      `Only ${formatCoveragePercent(wip.earnedCoverage)} of contract value carries an earned-revenue figure (${formatCoveragePercent(MIN_EARNED_COVERAGE)} is the threshold), so earned revenue and the over/under-billing position are left blank rather than guessed.`,
    );
  }

  // ---- forecast margin ----------------------------------------------------
  // Derived from jobCostVariance rather than recomputed, so the schedule's
  // margin and the job-health sentence on the dashboard can never disagree:
  // margin rate is exactly the negative of the cost variance.
  const variance = jobCostVariance(wip);
  const marginEstablished = variance !== null && wip.estimatedCoverage >= MIN_ESTIMATE_COVERAGE;
  const forecastGrossMarginRate = marginEstablished ? -variance : null;
  const forecastGrossProfit = marginEstablished
    ? round2(wip.contractValue - wip.estimatedCostAtCompletion)
    : null;
  if (!marginEstablished) {
    notes.push(
      variance === null
        ? "No cost forecast on this job, so there is no forecast margin to state."
        : `Only ${formatCoveragePercent(wip.estimatedCoverage)} of contract value carries a cost forecast (${formatCoveragePercent(MIN_ESTIMATE_COVERAGE)} is the threshold), so the forecast margin is left blank rather than flattered by the lines nobody has estimated.`,
    );
  }

  return {
    jobId: input.jobId,
    jobName: input.jobName,
    customerName: input.customerName,
    status: input.status,
    originalContractValue: splitEstablished
      ? round2(wip.contractValue - input.approvedChangeOrderValue)
      : null,
    approvedChangeOrders: splitEstablished ? round2(input.approvedChangeOrderValue) : null,
    revisedContractValue: round2(wip.contractValue),
    budgetedCost,
    costToDate: round2(wip.actualCostToDate),
    estimatedCostToComplete,
    estimatedCostAtCompletion: round2(wip.estimatedCostAtCompletion),
    percentComplete: wip.percentComplete,
    earnedRevenue: earnedRevenue === null ? null : round2(earnedRevenue),
    billedToDate: round2(wip.billedToDate),
    costsInExcessOfBillings: position === null ? null : round2(Math.max(-position, 0)),
    billingsInExcessOfCosts: position === null ? null : round2(Math.max(position, 0)),
    forecastGrossProfit,
    forecastGrossMarginRate,
    notes,
  };
}

/** Sum of a nullable column, plus how many rows had nothing to contribute. */
function sumEstablished(
  rows: WipScheduleRow[],
  pick: (row: WipScheduleRow) => number | null,
): { total: number | null; dropped: number; coveredValue: number } {
  const established = rows.filter((row) => pick(row) !== null);
  return {
    total: established.length === 0 ? null : round2(established.reduce((sum, row) => sum + (pick(row) ?? 0), 0)),
    dropped: rows.length - established.length,
    coveredValue: established.reduce((sum, row) => sum + row.revisedContractValue, 0),
  };
}

export function buildWipSchedule(jobs: WipScheduleJobInput[]): WipSchedule {
  const rows = jobs.map(buildRow);

  const sum = (pick: (row: WipScheduleRow) => number) =>
    round2(rows.reduce((total, row) => total + pick(row), 0));

  const original = sumEstablished(rows, (row) => row.originalContractValue);
  const approved = sumEstablished(rows, (row) => row.approvedChangeOrders);
  const budget = sumEstablished(rows, (row) => row.budgetedCost);
  const earned = sumEstablished(rows, (row) => row.earnedRevenue);
  const under = sumEstablished(rows, (row) => row.costsInExcessOfBillings);
  const over = sumEstablished(rows, (row) => row.billingsInExcessOfCosts);
  const profit = sumEstablished(rows, (row) => row.forecastGrossProfit);

  const notes: string[] = [];
  const dropped = (label: string, result: { dropped: number }) => {
    if (result.dropped > 0) {
      notes.push(
        `${label}: ${result.dropped} of ${rows.length} ${rows.length === 1 ? "job is" : "jobs are"} not in this total — see that job's own note.`,
      );
    }
  };
  dropped("Original contract value and approved change orders", original);
  dropped("Budgeted cost", budget);
  dropped("Earned revenue and the over/under-billing pair", earned);
  dropped("Forecast gross profit", profit);
  // Percent complete is deliberately absent from this row. Cost-to-cost
  // across jobs would put cost from every job over a denominator drawn only
  // from the forecast lines of some of them — the shape of issue #100, one
  // level up. A WIP schedule totals dollars; it does not total a ratio.
  notes.push(
    "Percent complete is a per-job ratio and is not totalled: summing cost from every job over a denominator drawn from the forecast lines of some of them would state a completion percentage nothing supports.",
  );

  return {
    rows,
    totals: {
      jobCount: rows.length,
      originalContractValue: original.total,
      approvedChangeOrders: approved.total,
      revisedContractValue: sum((row) => row.revisedContractValue),
      budgetedCost: budget.total,
      costToDate: sum((row) => row.costToDate),
      estimatedCostToComplete: sum((row) => row.estimatedCostToComplete),
      estimatedCostAtCompletion: sum((row) => row.estimatedCostAtCompletion),
      earnedRevenue: earned.total,
      billedToDate: sum((row) => row.billedToDate),
      costsInExcessOfBillings: under.total,
      billingsInExcessOfCosts: over.total,
      forecastGrossProfit: profit.total,
      // Over the contract value of the jobs that ARE in the profit total,
      // never over the whole book: dividing a partial profit by a complete
      // contract value is how a blended margin gets quietly halved.
      forecastGrossMarginRate:
        profit.total !== null && profit.coveredValue > 0 ? profit.total / profit.coveredValue : null,
      notes,
    },
  };
}

/* ------------------------------------------------------------- the file --- */

/**
 * One column of the schedule, in the order an underwriter reads them.
 *
 * `label` is the CSV header AND the on-screen header, from one list, so the
 * page and the file cannot drift into describing different columns. `value`
 * returns what goes in the cell: a number for money (raw, so a spreadsheet
 * can sum it), a formatted percentage for the ratios, and text for the rest.
 */
export type WipScheduleColumn = {
  key: string;
  label: string;
  /** What the cell holds, so one list drives both the CSV and the on-screen
   * table: "money" is a raw number (a spreadsheet has to be able to sum it),
   * "percent" is an already-formatted string in the exact format the job page
   * prints, "text" is everything else. */
  kind: "text" | "money" | "percent";
  value: (row: WipScheduleRow) => unknown;
  /** The same cell for the TOTAL row, or null where a total is refused. */
  total: (totals: WipScheduleTotals) => unknown;
};

/**
 * The forecast margin's own formatter, deliberately NOT formatPercentComplete
 * even though the two currently produce the same string.
 *
 * lib/wip.ts keeps formatPercentComplete and formatCoveragePercent apart on
 * the stated rule that there is one shared function per on-screen format
 * rather than one function pretending two formats are the same. A margin is
 * a third statement — it can be negative, and nothing forces it to keep
 * percent complete's rounding — so it gets its own name here rather than
 * borrowing one and quietly coupling the two.
 */
function formatMarginRate(rate: number | null): string | null {
  return rate != null ? `${(rate * 100).toFixed(1)}%` : null;
}

export const WIP_SCHEDULE_COLUMNS: WipScheduleColumn[] = [
  { key: "job", label: "Job", kind: "text", value: (r) => r.jobName, total: () => "TOTAL" },
  { key: "customer", label: "Customer", kind: "text", value: (r) => r.customerName, total: () => "" },
  { key: "status", label: "Status", kind: "text", value: (r) => r.status, total: (t) => `${t.jobCount} ${t.jobCount === 1 ? "job" : "jobs"}` },
  { key: "originalContract", label: "Original contract value", kind: "money", value: (r) => r.originalContractValue, total: (t) => t.originalContractValue },
  { key: "approvedChangeOrders", label: "Approved change orders", kind: "money", value: (r) => r.approvedChangeOrders, total: (t) => t.approvedChangeOrders },
  { key: "revisedContract", label: "Revised contract value", kind: "money", value: (r) => r.revisedContractValue, total: (t) => t.revisedContractValue },
  { key: "budgetedCost", label: "Budgeted cost", kind: "money", value: (r) => r.budgetedCost, total: (t) => t.budgetedCost },
  { key: "costToDate", label: "Cost to date", kind: "money", value: (r) => r.costToDate, total: (t) => t.costToDate },
  { key: "costToComplete", label: "Estimated cost to complete", kind: "money", value: (r) => r.estimatedCostToComplete, total: (t) => t.estimatedCostToComplete },
  { key: "costAtCompletion", label: "Estimated cost at completion", kind: "money", value: (r) => r.estimatedCostAtCompletion, total: (t) => t.estimatedCostAtCompletion },
  { key: "percentComplete", label: "Percent complete", kind: "percent", value: (r) => formatPercentComplete(r.percentComplete), total: () => null },
  { key: "earnedRevenue", label: "Earned revenue to date", kind: "money", value: (r) => r.earnedRevenue, total: (t) => t.earnedRevenue },
  { key: "billedToDate", label: "Billed to date", kind: "money", value: (r) => r.billedToDate, total: (t) => t.billedToDate },
  { key: "underbilled", label: "Costs in excess of billings", kind: "money", value: (r) => r.costsInExcessOfBillings, total: (t) => t.costsInExcessOfBillings },
  { key: "overbilled", label: "Billings in excess of costs", kind: "money", value: (r) => r.billingsInExcessOfCosts, total: (t) => t.billingsInExcessOfCosts },
  { key: "forecastGrossProfit", label: "Forecast gross profit", kind: "money", value: (r) => r.forecastGrossProfit, total: (t) => t.forecastGrossProfit },
  { key: "forecastGrossMargin", label: "Forecast gross margin", kind: "percent", value: (r) => formatMarginRate(r.forecastGrossMarginRate), total: (t) => formatMarginRate(t.forecastGrossMarginRate) },
  { key: "notes", label: "Notes", kind: "text", value: (r) => r.notes.join(" "), total: (t) => t.notes.join(" ") },
];

/**
 * The schedule as CSV, using the same writer and the same escaping as every
 * other export in this app — including the formula neutralisation, which
 * means a NEGATIVE number arrives in the file as `'-4200` and a spreadsheet
 * shows it as text. That is lib/export.ts's documented, deliberate cost, not
 * a defect here, and it is why the over/under-billing pair is two
 * never-negative columns rather than one signed one. A forecast gross profit
 * CAN still be negative, on a job forecast to lose money, and that cell will
 * carry the apostrophe.
 */
export function wipScheduleCsv(schedule: WipSchedule): string {
  const rows = schedule.rows.map((row) =>
    Object.fromEntries(WIP_SCHEDULE_COLUMNS.map((column) => [column.label, column.value(row)])),
  );
  rows.push(
    Object.fromEntries(
      WIP_SCHEDULE_COLUMNS.map((column) => [column.label, column.total(schedule.totals)]),
    ),
  );
  return toCsv(
    WIP_SCHEDULE_COLUMNS.map((column) => column.label),
    rows,
  );
}
