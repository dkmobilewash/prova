import type { WipJobResult } from "./wip";
import {
  MIN_ESTIMATE_COVERAGE,
  jobEarnedRevenue,
  jobOverUnderBilling,
  jobPercentComplete,
} from "./company-financials";

/**
 * The WIP schedule — one row per job, in the shape a surety or a CPA asks
 * for. Sheet 15's last Missing row.
 *
 * Every figure here already existed; none of it was ever leaving the
 * building. `lib/wip.ts` has computed the cost-to-cost percentage since the
 * first week, and its own header says it is "the standard approach sureties
 * and CPAs expect on a WIP schedule" — but it was rendered one job at a
 * time on `/jobs/[id]`, and a bonding company asks for the whole book on one
 * page, once a quarter. So this file is assembly and honesty, not new
 * arithmetic: it must not compute a figure that lib/wip.ts already computes.
 *
 * THE DECISION THIS FILE IS REALLY ABOUT, and it is not the columns.
 *
 * This app already refuses to state an earned-revenue or over/under-billing
 * figure for a job whose estimates are mostly missing — `jobEarnedRevenue`
 * and `jobOverUnderBilling` return null below 80% coverage, and the job page
 * renders the dash. The comment on `jobOverUnderBilling` says why in the
 * plainest possible terms: below that line, "Overbilled $80,000" is "an
 * artefact of missing estimates rather than a fact about the job".
 *
 * An export that printed those numbers anyway would be WORSE THAN THE
 * SCREEN. A dash on a page invites a question; a number in a spreadsheet
 * handed to an underwriter does not, and it would carry this app's
 * authority into a document that decides a bond line. So the export goes
 * through the same accessors the screen does, and a silenced figure is an
 * EMPTY CELL — never a zero, which reads as a fact.
 *
 * The dollar sums are never silenced, only the derived positions. That is
 * the rule `calculateCompanyFinancials` already states: "The coverage
 * question is answered by silencing the RATE, never by quietly changing
 * which jobs the sums are over." Cost to date and billed to date are money
 * that moved; they are true regardless of whether anyone estimated the job.
 *
 * And the three coverage ratios ship AS COLUMNS, so a reader can see why a
 * cell is blank rather than wondering whether the export is broken.
 *
 * CONTRACT VALUE IS THE REVISED CONTRACT. Approving a change order writes
 * its proposals onto `JobLineItem` (`approveChangeOrder`, guarded by
 * `appliedAt` so it cannot apply twice), so the sum of quantity x unitPrice
 * already includes every approved change order. It is deliberately NOT split
 * into "original" and "approved change orders" the way a printed schedule
 * often is: that split would have to be reconstructed from history, and a
 * reconstructed number on this document is exactly what the rest of this
 * file exists to avoid.
 */

/** One job, as the schedule needs it: identity plus the WIP result that
 * lib/wip.ts already produced for it. */
export interface WipScheduleJob {
  name: string;
  /** The GC. `Job.contact` is the customer in this ICP. */
  customer: string;
  status: string;
  wip: WipJobResult;
}

export interface WipScheduleRow {
  job: string;
  customer: string;
  status: string;
  contractValue: number;
  costToDate: number;
  estimatedCostAtCompletion: number;
  estimatedGrossProfit: number | null;
  percentComplete: number | null;
  earnedRevenue: number | null;
  grossProfitEarned: number | null;
  billedToDate: number;
  /** Billings in excess of costs and estimated earnings — the liability
   * side. Split from `underbilled` because they are two different lines on
   * a balance sheet, which is the whole reason this format has two columns
   * and `WipJobResult.overUnderBilling` has one signed number. */
  overbilled: number | null;
  /** Costs and estimated earnings in excess of billings — the asset side. */
  underbilled: number | null;
  backlog: number | null;
  /** Nullable because the TOTAL row leaves them blank: a coverage ratio is
   * not a sum, and an averaged one printed on a totals line reads as a fact
   * about the book that nothing computed. */
  costCoverage: number | null;
  earnedCoverage: number | null;
  estimateCoverage: number | null;
}

/** Column order and headers, in the order a WIP schedule is read: identity,
 * then the contract, then what it has cost, then what that means. */
export const WIP_SCHEDULE_COLUMNS: { key: keyof WipScheduleRow; label: string }[] = [
  { key: "job", label: "Job" },
  { key: "customer", label: "Customer (GC)" },
  { key: "status", label: "Status" },
  { key: "contractValue", label: "Contract value (incl. approved change orders)" },
  { key: "costToDate", label: "Cost to date" },
  { key: "estimatedCostAtCompletion", label: "Estimated cost at completion" },
  { key: "estimatedGrossProfit", label: "Estimated gross profit" },
  { key: "percentComplete", label: "Percent complete (%)" },
  { key: "earnedRevenue", label: "Earned revenue to date" },
  { key: "grossProfitEarned", label: "Gross profit earned to date" },
  { key: "billedToDate", label: "Billed to date" },
  { key: "overbilled", label: "Billings in excess of earnings (overbilled)" },
  { key: "underbilled", label: "Earnings in excess of billings (underbilled)" },
  { key: "backlog", label: "Backlog (contract less earned)" },
  { key: "costCoverage", label: "Cost forecast coverage (%)" },
  { key: "earnedCoverage", label: "Earned revenue coverage (%)" },
  { key: "estimateCoverage", label: "Cost estimate coverage (%)" },
];

/** Money to the cent. The WIP math is floating point, and 12345.678999999
 * in a cell a CPA is about to sum is noise that looks like precision. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A 0..1 ratio as percentage points with one decimal — a NUMBER, not a
 * formatted string, so the column can be summed, sorted and charted in the
 * spreadsheet this is opened in. */
function percent(ratio: number | null): number | null {
  return ratio === null ? null : Math.round(ratio * 1000) / 10;
}

export function wipScheduleRow(job: WipScheduleJob): WipScheduleRow {
  const wip = job.wip;

  // Through the guarded accessors, exactly as /jobs/[id] and the Ask tool
  // do. Three surfaces, one rule about when a figure is sayable.
  const earnedRevenue = jobEarnedRevenue(wip);
  const overUnder = jobOverUnderBilling(wip);
  const percentComplete = jobPercentComplete(wip);

  // Contract value LESS the cost forecast -- and therefore a figure that
  // mixes a full contract against a partial cost the moment the estimates
  // are thin. Caught by reading a sample file rather than by a test: a job
  // with $840k of contract and $96k of forecast covering 22% of it read
  // "Estimated gross profit 744,000", which is not a forecast, it is the
  // unestimated part of the job wearing one.
  //
  // So it is silenced on estimatedCoverage -- the ratio MIN_ESTIMATE_COVERAGE
  // exists for, and the one lib/today-dashboard.ts already guards the cost
  // variance with. Note it is NOT earnedCoverage: a line estimated at zero
  // cost is covered on the cost side and not the revenue side, which is why
  // this codebase keeps the two ratios apart.
  const estimatedGrossProfit =
    wip.estimatedCostAtCompletion > 0 && wip.estimatedCoverage >= MIN_ESTIMATE_COVERAGE
      ? money(wip.contractValue - wip.estimatedCostAtCompletion)
      : null;

  return {
    job: job.name,
    customer: job.customer,
    status: job.status,
    contractValue: money(wip.contractValue),
    costToDate: money(wip.actualCostToDate),
    estimatedCostAtCompletion: money(wip.estimatedCostAtCompletion),
    estimatedGrossProfit,
    percentComplete: percent(percentComplete),
    earnedRevenue: earnedRevenue === null ? null : money(earnedRevenue),
    // Inherits earned revenue's silence on purpose. Gross profit earned is
    // earned revenue minus cost to date, so if the first term is not
    // sayable the difference is not either -- and this is the subtraction
    // where an unsayable term does the most damage, because cost to date is
    // always real and would make the job look like a loss.
    grossProfitEarned: earnedRevenue === null ? null : money(earnedRevenue - wip.actualCostToDate),
    billedToDate: money(wip.billedToDate),
    overbilled: overUnder === null ? null : money(Math.max(overUnder, 0)),
    underbilled: overUnder === null ? null : money(Math.max(-overUnder, 0)),
    backlog: earnedRevenue === null ? null : money(wip.contractValue - earnedRevenue),
    costCoverage: percent(wip.costCoverage),
    earnedCoverage: percent(wip.earnedCoverage),
    estimateCoverage: percent(wip.estimatedCoverage),
  };
}

/**
 * The totals line.
 *
 * Only the columns that are meaningful to add. A total percent complete or
 * a total coverage ratio is not a sum of the rows above it, and a schedule
 * that prints one in the totals line is inviting somebody to read an
 * average of percentages as a fact about the book — the exact error
 * `calculateCompanyFinancials` avoids by summing both sides before
 * dividing. Those cells are blank instead.
 *
 * A silenced cell contributes NOTHING rather than zero, so a total is the
 * sum of the figures this schedule was willing to state. That makes the
 * totals row internally consistent with the rows above it, and it is why
 * the coverage columns matter: a reader comparing a billed total against an
 * earned total needs to know some jobs are missing from one side.
 */
export function wipScheduleTotals(rows: WipScheduleRow[]): WipScheduleRow {
  const sum = (pick: (row: WipScheduleRow) => number | null): number =>
    money(rows.reduce((total, row) => total + (pick(row) ?? 0), 0));

  return {
    job: "TOTAL",
    customer: "",
    status: "",
    contractValue: sum((r) => r.contractValue),
    costToDate: sum((r) => r.costToDate),
    estimatedCostAtCompletion: sum((r) => r.estimatedCostAtCompletion),
    estimatedGrossProfit: sum((r) => r.estimatedGrossProfit),
    percentComplete: null,
    earnedRevenue: sum((r) => r.earnedRevenue),
    grossProfitEarned: sum((r) => r.grossProfitEarned),
    billedToDate: sum((r) => r.billedToDate),
    overbilled: sum((r) => r.overbilled),
    underbilled: sum((r) => r.underbilled),
    backlog: sum((r) => r.backlog),
    costCoverage: null,
    earnedCoverage: null,
    estimateCoverage: null,
  };
}

/** Rows plus the totals line, ready for `toCsv`. */
export function wipScheduleTable(jobs: WipScheduleJob[]): WipScheduleRow[] {
  const rows = jobs.map(wipScheduleRow);
  return [...rows, wipScheduleTotals(rows)];
}
