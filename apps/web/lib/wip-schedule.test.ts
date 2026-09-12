import { describe, expect, it } from "vitest";
import { calculateLineItemWip, type WipLineItemInput } from "./wip";
import { MIN_EARNED_COVERAGE, MIN_ESTIMATE_COVERAGE } from "./company-financials";
import {
  WIP_SCHEDULE_COLUMNS,
  buildWipSchedule,
  wipScheduleCsv,
  type WipScheduleJobInput,
} from "./wip-schedule";

/**
 * The WIP schedule is the document bonding capacity is decided from, so the
 * questions this file asks are: does every figure come from the same
 * functions the screen uses, does a figure that cannot be established come
 * out BLANK rather than plausible, and does a total that dropped a job say
 * so.
 *
 * THE VACUITY GUARDS ARE THE FIRST DESCRIBE BLOCK ON PURPOSE. Most of what
 * follows iterates a derived set — the rows of a schedule, the columns of
 * the CSV — and an iteration over an empty set passes every assertion inside
 * it. So each derived set's SIZE is asserted against something that cannot
 * shrink with it: the row count against the input array's length, and the
 * column count against a literal that a person has to change on purpose.
 */

const line = (over: Partial<WipLineItemInput> = {}) =>
  calculateLineItemWip({
    quantity: 1,
    unitPrice: null,
    budgetedUnitCost: null,
    currentEstimatedUnitCost: null,
    estimatedCostToComplete: null,
    actualCostToDate: 0,
    ...over,
  });

const job = (over: Partial<WipScheduleJobInput> = {}): WipScheduleJobInput => ({
  jobId: "job-1",
  jobName: "Baseline",
  customerName: "Turner",
  status: "IN_PROGRESS",
  lineItems: [],
  billedToDate: 0,
  approvedChangeOrderValue: 0,
  unestablishedApprovedProposals: 0,
  ...over,
});

/** A fully estimated, half-spent job — the shape every refusal below is the
 * exception to. Contract $400k, forecast cost $300k, $150k spent, so 50%
 * complete and $200k earned. */
const healthy = (over: Partial<WipScheduleJobInput> = {}) =>
  job({
    jobName: "Mercy Hospital — Level 3",
    lineItems: [
      line({
        quantity: 1,
        unitPrice: 400_000,
        budgetedUnitCost: 290_000,
        currentEstimatedUnitCost: 300_000,
        actualCostToDate: 150_000,
      }),
    ],
    ...over,
  });

/* -------------------------------------------------- vacuity guards ------- */

describe("the derived sets are not empty", () => {
  /**
   * A literal, and it is meant to be edited by hand.
   *
   * Every other assertion in this file walks WIP_SCHEDULE_COLUMNS. If that
   * array were ever emptied — a bad refactor, a filter that matched nothing —
   * every one of those loops would pass while the export produced a file with
   * no columns in it. The literal is the one thing in this file that cannot
   * drift with the array, which is the whole reason it is here rather than
   * `WIP_SCHEDULE_COLUMNS.length`.
   */
  const EXPECTED_COLUMNS = 18;

  it("declares exactly the columns the schedule is supposed to have", () => {
    expect(WIP_SCHEDULE_COLUMNS).toHaveLength(EXPECTED_COLUMNS);
  });

  it("gives the CSV a header for every declared column and no others", () => {
    // Derived from the array, asserted against the literal: a header row that
    // silently lost a column fails here rather than in a underwriter's inbox.
    const header = wipScheduleCsv(buildWipSchedule([healthy()])).split("\n")[0];
    expect(header.split(",")).toHaveLength(EXPECTED_COLUMNS);
    expect(header.startsWith("Job,Customer,Status,")).toBe(true);
  });

  it("builds one row per job and nothing else", () => {
    // The row count against the INPUT length — the source that cannot shrink
    // with the output. Every per-row assertion below is worthless without it.
    const jobs = [healthy({ jobId: "a" }), healthy({ jobId: "b" }), healthy({ jobId: "c" })];
    const schedule = buildWipSchedule(jobs);
    expect(schedule.rows).toHaveLength(jobs.length);
    expect(schedule.totals.jobCount).toBe(jobs.length);
    expect(schedule.rows.map((row) => row.jobId)).toEqual(["a", "b", "c"]);
  });

  it("writes a row per job PLUS the total row, so an empty file is impossible", () => {
    const csv = wipScheduleCsv(buildWipSchedule([healthy({ jobId: "a" }), healthy({ jobId: "b" })]));
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(1 + 2 + 1); // header, two jobs, total
    expect(lines[lines.length - 1].startsWith("TOTAL,")).toBe(true);
  });

  it("still produces the header and a TOTAL row when the company has no active jobs", () => {
    // An empty book is a fact and must look like one. A zero-byte file reads
    // as a broken download; a header plus "TOTAL, 0 jobs" reads as "nothing
    // under contract", which is what it means.
    const schedule = buildWipSchedule([]);
    expect(schedule.rows).toHaveLength(0);
    expect(schedule.totals.jobCount).toBe(0);
    const lines = wipScheduleCsv(schedule).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("TOTAL");
    expect(lines[1]).toContain("0 jobs");
  });
});

/* -------------------------------------------------- the ordinary row ----- */

describe("a fully estimated job", () => {
  const row = buildWipSchedule([healthy()]).rows[0];

  it("states percent complete from cost-to-cost, not from a guess", () => {
    expect(row.percentComplete).toBeCloseTo(0.5, 10);
  });

  it("earns revenue in proportion", () => {
    expect(row.earnedRevenue).toBe(200_000);
  });

  it("carries the contract, cost and forecast figures", () => {
    expect(row.revisedContractValue).toBe(400_000);
    expect(row.costToDate).toBe(150_000);
    expect(row.estimatedCostToComplete).toBe(150_000);
    expect(row.estimatedCostAtCompletion).toBe(300_000);
    expect(row.budgetedCost).toBe(290_000);
  });

  it("adds up: cost to date + cost to complete = cost at completion", () => {
    // True only when every dollar of cost sits on a line with a forecast,
    // which is this job. The row that breaks it is tested below, and says so
    // in its own note rather than quietly failing to reconcile.
    expect(row.costToDate + row.estimatedCostToComplete).toBe(row.estimatedCostAtCompletion);
  });

  it("forecasts the margin as contract less cost at completion", () => {
    expect(row.forecastGrossProfit).toBe(100_000);
    expect(row.forecastGrossMarginRate).toBeCloseTo(0.25, 10);
  });

  it("says nothing, because there is nothing to warn about", () => {
    // The notes column is the honesty channel. A row with no refusals in it
    // must be silent, or the warnings on the rows that need them stop being
    // read.
    expect(row.notes).toEqual([]);
  });
});

/* -------------------------------------------------- edge shape 1 --------- */

describe("a job with nothing spent on it yet", () => {
  // Contracted, estimated, and not a single cost entry. The row a surety sees
  // for work that is sold and not started.
  const row = buildWipSchedule([
    job({
      jobName: "Northgate Phase 2",
      status: "CONTRACTED",
      lineItems: [
        line({ quantity: 1, unitPrice: 250_000, budgetedUnitCost: 180_000, currentEstimatedUnitCost: 180_000 }),
      ],
    }),
  ]).rows[0];

  it("is 0% complete rather than blank — nothing spent is a fact, not a gap", () => {
    expect(row.percentComplete).toBe(0);
    expect(row.costToDate).toBe(0);
  });

  it("has earned nothing and therefore is not underbilled either", () => {
    expect(row.earnedRevenue).toBe(0);
    expect(row.costsInExcessOfBillings).toBe(0);
    expect(row.billingsInExcessOfCosts).toBe(0);
  });

  it("still forecasts the whole job's cost to complete", () => {
    expect(row.estimatedCostToComplete).toBe(180_000);
    expect(row.estimatedCostAtCompletion).toBe(180_000);
    expect(row.forecastGrossProfit).toBe(70_000);
  });

  it("does not warn about cost coverage when there is no cost to cover", () => {
    expect(row.notes).toEqual([]);
  });
});

/* -------------------------------------------------- edge shape 2 --------- */

describe("an OVER-BILLED job, where the sign convention has to be visible", () => {
  // $400k contract, 50% complete, so $200k earned — and $260k already
  // invoiced. Billings exceed earned revenue by $60k: a liability, and the
  // line a surety looks at first.
  const row = buildWipSchedule([healthy({ billedToDate: 260_000 })]).rows[0];

  it("puts the $60,000 in BILLINGS in excess of costs", () => {
    expect(row.billingsInExcessOfCosts).toBe(60_000);
  });

  it("puts ZERO — not the same number, and not a negative — in the other column", () => {
    // The pair is two never-negative columns rather than one signed one.
    // A signed column would also collide with the CSV's formula
    // neutralisation, which turns a leading "-" into text.
    expect(row.costsInExcessOfBillings).toBe(0);
  });

  it("writes neither column as a negative number in the file", () => {
    const cells = wipScheduleCsv(buildWipSchedule([healthy({ billedToDate: 260_000 })]))
      .split("\n")[1]
      .split(",");
    const underbilledAt = WIP_SCHEDULE_COLUMNS.findIndex((c) => c.key === "underbilled");
    const overbilledAt = WIP_SCHEDULE_COLUMNS.findIndex((c) => c.key === "overbilled");
    expect(cells[underbilledAt]).toBe("0");
    expect(cells[overbilledAt]).toBe("60000");
  });

  it("mirrors exactly when the job is UNDER-billed instead", () => {
    // Same job, $140k invoiced against $200k earned: $60k the other way, and
    // an asset rather than a liability.
    const under = buildWipSchedule([healthy({ billedToDate: 140_000 })]).rows[0];
    expect(under.costsInExcessOfBillings).toBe(60_000);
    expect(under.billingsInExcessOfCosts).toBe(0);
  });

  it("is even when billing has exactly caught up", () => {
    const even = buildWipSchedule([healthy({ billedToDate: 200_000 })]).rows[0];
    expect(even.costsInExcessOfBillings).toBe(0);
    expect(even.billingsInExcessOfCosts).toBe(0);
  });
});

/* -------------------------------------------------- the refusals --------- */

describe("a figure that cannot be established comes out BLANK", () => {
  it("refuses earned revenue and the billing pair below the earned-coverage threshold", () => {
    // $400k estimated, $600k not — 40% coverage, under MIN_EARNED_COVERAGE.
    // The unestimated line has earned nothing as far as the math can tell,
    // while its billing counts in full, so a position here is an artefact.
    const row = buildWipSchedule([
      healthy({
        billedToDate: 500_000,
        lineItems: [
          line({
            quantity: 1,
            unitPrice: 400_000,
            currentEstimatedUnitCost: 300_000,
            actualCostToDate: 150_000,
          }),
          line({ quantity: 1, unitPrice: 600_000 }),
        ],
      }),
    ]).rows[0];

    expect(row.earnedRevenue).toBeNull();
    expect(row.costsInExcessOfBillings).toBeNull();
    expect(row.billingsInExcessOfCosts).toBeNull();
    expect(row.billedToDate).toBe(500_000); // the fact is still stated
    expect(row.notes.join(" ")).toContain("earned-revenue figure");
  });

  it("refuses the forecast margin below the estimate-coverage threshold", () => {
    const row = buildWipSchedule([
      healthy({
        lineItems: [
          line({ quantity: 1, unitPrice: 400_000, currentEstimatedUnitCost: 300_000, actualCostToDate: 150_000 }),
          line({ quantity: 1, unitPrice: 600_000 }),
        ],
      }),
    ]).rows[0];

    expect(row.forecastGrossProfit).toBeNull();
    expect(row.forecastGrossMarginRate).toBeNull();
    expect(row.notes.join(" ")).toContain("cost forecast");
  });

  it("refuses the original/approved split when a change order left no snapshot", () => {
    // A change order approved before ChangeOrderProposal carried its
    // previous* columns: changeOrderValueDelta has to value its EDIT at zero,
    // so the subtraction would overstate the original contract by an unknown
    // amount. Both halves go blank; the revised contract does not.
    const row = buildWipSchedule([
      healthy({ approvedChangeOrderValue: 40_000, unestablishedApprovedProposals: 1 }),
    ]).rows[0];

    expect(row.originalContractValue).toBeNull();
    expect(row.approvedChangeOrders).toBeNull();
    expect(row.revisedContractValue).toBe(400_000);
    expect(row.notes.join(" ")).toContain("cannot be established");
  });

  it("states the split when every approved change order has its snapshot", () => {
    const row = buildWipSchedule([healthy({ approvedChangeOrderValue: 40_000 })]).rows[0];
    expect(row.originalContractValue).toBe(360_000);
    expect(row.approvedChangeOrders).toBe(40_000);
    expect(row.originalContractValue! + row.approvedChangeOrders!).toBe(row.revisedContractValue);
  });

  it("handles a change order that REMOVED scope, which is a negative delta", () => {
    const row = buildWipSchedule([healthy({ approvedChangeOrderValue: -25_000 })]).rows[0];
    expect(row.approvedChangeOrders).toBe(-25_000);
    expect(row.originalContractValue).toBe(425_000);
  });

  it("leaves budgeted cost blank when no line carries a baseline, rather than $0", () => {
    const row = buildWipSchedule([
      healthy({
        lineItems: [
          line({ quantity: 1, unitPrice: 400_000, currentEstimatedUnitCost: 300_000, actualCostToDate: 150_000 }),
        ],
      }),
    ]).rows[0];
    expect(row.budgetedCost).toBeNull();
  });
});

describe("cost on lines nobody has forecast", () => {
  // The one case where cost to date + cost to complete does NOT equal cost at
  // completion. calculateJobWip deliberately keeps that spend out of both
  // sides of the ratio (issue #100); the schedule therefore has to say why
  // its own arithmetic does not close.
  const row = buildWipSchedule([
    healthy({
      lineItems: [
        line({
          quantity: 1,
          unitPrice: 400_000,
          currentEstimatedUnitCost: 300_000,
          actualCostToDate: 150_000,
        }),
        // A change-order line that ran away and nobody re-forecast.
        line({ quantity: 1, unitPrice: 0, actualCostToDate: 50_000 }),
      ],
    }),
  ]).rows[0];

  it("counts every dollar spent in cost to date", () => {
    expect(row.costToDate).toBe(200_000);
  });

  it("does NOT invent a cost to complete for the unforecast line", () => {
    expect(row.estimatedCostToComplete).toBe(150_000);
    expect(row.estimatedCostAtCompletion).toBe(300_000);
  });

  it("says so, with the amount, instead of leaving the row not adding up", () => {
    expect(row.costToDate + row.estimatedCostToComplete).not.toBe(row.estimatedCostAtCompletion);
    const note = row.notes.find((n) => n.includes("no cost forecast"));
    expect(note).toBeDefined();
    expect(note).toContain("$50,000.00");
  });
});

/* -------------------------------------------------- the total row -------- */

describe("the total row", () => {
  const schedule = buildWipSchedule([
    healthy({ jobId: "a", jobName: "A", billedToDate: 260_000 }),
    healthy({ jobId: "b", jobName: "B", billedToDate: 140_000 }),
  ]);

  it("totals the dollar columns", () => {
    expect(schedule.totals.revisedContractValue).toBe(800_000);
    expect(schedule.totals.costToDate).toBe(300_000);
    expect(schedule.totals.billedToDate).toBe(400_000);
    expect(schedule.totals.earnedRevenue).toBe(400_000);
    expect(schedule.totals.billingsInExcessOfCosts).toBe(60_000);
    expect(schedule.totals.costsInExcessOfBillings).toBe(60_000);
  });

  it("totals every dollar column as the sum of the rows above it", () => {
    // The check a reader performs by hand, made mechanical. Iterating the
    // numeric columns is only safe because the column count is pinned above.
    const sums = {
      revisedContractValue: schedule.rows.reduce((s, r) => s + r.revisedContractValue, 0),
      costToDate: schedule.rows.reduce((s, r) => s + r.costToDate, 0),
      estimatedCostToComplete: schedule.rows.reduce((s, r) => s + r.estimatedCostToComplete, 0),
      estimatedCostAtCompletion: schedule.rows.reduce((s, r) => s + r.estimatedCostAtCompletion, 0),
      billedToDate: schedule.rows.reduce((s, r) => s + r.billedToDate, 0),
    };
    for (const [key, expected] of Object.entries(sums)) {
      expect(schedule.totals[key as keyof typeof sums], key).toBe(expected);
    }
  });

  it("does NOT total percent complete, and says why", () => {
    // Cost-to-cost across jobs would put every job's cost over a denominator
    // drawn from the forecast lines of only some of them — issue #100 one
    // level up. The cell is blank in the file.
    const lines = wipScheduleCsv(schedule).trimEnd().split("\n");
    const at = WIP_SCHEDULE_COLUMNS.findIndex((c) => c.key === "percentComplete");
    expect(lines[lines.length - 1].split(",")[at]).toBe("");
    expect(schedule.totals.notes.join(" ")).toContain("not totalled");
  });

  it("SAYS how many jobs a total dropped rather than presenting a floor as a total", () => {
    const withGap = buildWipSchedule([
      healthy({ jobId: "a" }),
      healthy({
        jobId: "b",
        lineItems: [
          line({ quantity: 1, unitPrice: 400_000, currentEstimatedUnitCost: 300_000, actualCostToDate: 150_000 }),
          line({ quantity: 1, unitPrice: 600_000 }),
        ],
      }),
    ]);
    expect(withGap.totals.earnedRevenue).toBe(200_000); // job A only
    expect(withGap.totals.notes.join(" ")).toContain("1 of 2 jobs are not in this total");
  });

  it("blends the forecast margin over the jobs IN the profit total, not the whole book", () => {
    // Job A: $400k contract, $100k forecast profit. Job B: unestimated, out of
    // the total. 100k/400k = 25%, never 100k/1,400k.
    const blended = buildWipSchedule([
      healthy({ jobId: "a" }),
      healthy({
        jobId: "b",
        lineItems: [
          line({ quantity: 1, unitPrice: 400_000, currentEstimatedUnitCost: 300_000, actualCostToDate: 150_000 }),
          line({ quantity: 1, unitPrice: 600_000 }),
        ],
      }),
    ]);
    expect(blended.totals.forecastGrossProfit).toBe(100_000);
    expect(blended.totals.forecastGrossMarginRate).toBeCloseTo(0.25, 10);
  });
});

/* -------------------------------------------------- the file itself ------ */

describe("the CSV", () => {
  it("renders a blank cell, never the word null, for a refused figure", () => {
    // "null" in a cell reads as a value somebody typed. Same rule as
    // lib/export.ts's own test.
    const csv = wipScheduleCsv(
      buildWipSchedule([healthy({ unestablishedApprovedProposals: 1 })]),
    );
    const at = WIP_SCHEDULE_COLUMNS.findIndex((c) => c.key === "originalContract");
    expect(csv.split("\n")[1].split(",")[at]).toBe("");
    expect(csv).not.toContain("null");
  });

  it("escapes a job name containing a comma rather than shifting every column", () => {
    const csv = wipScheduleCsv(buildWipSchedule([healthy({ jobName: "Fremont, Building C" })]));
    expect(csv.split("\n")[1].startsWith('"Fremont, Building C",')).toBe(true);
  });

  it("neutralises a job name a spreadsheet would execute", () => {
    const csv = wipScheduleCsv(buildWipSchedule([healthy({ jobName: "=HYPERLINK(1)" })]));
    expect(csv.split("\n")[1]).toContain("'=HYPERLINK(1)");
  });

  it("writes percentages in the same format the job page prints", () => {
    const at = WIP_SCHEDULE_COLUMNS.findIndex((c) => c.key === "percentComplete");
    const csv = wipScheduleCsv(buildWipSchedule([healthy()]));
    expect(csv.split("\n")[1].split(",")[at]).toBe("50.0%");
  });

  it("gives every column a label, since a header is the only documentation a CSV has", () => {
    for (const column of WIP_SCHEDULE_COLUMNS) {
      expect(column.label.length, column.key).toBeGreaterThan(0);
      expect(column.key.length).toBeGreaterThan(0);
    }
    const keys = WIP_SCHEDULE_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    const labels = WIP_SCHEDULE_COLUMNS.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

/* -------------------------------------------------- the shared thresholds */

describe("the refusals are the SAME thresholds the screen uses", () => {
  it("reads them from lib/company-financials rather than restating them", () => {
    // If somebody moves MIN_EARNED_COVERAGE, the schedule has to move with
    // it — a WIP export that refuses at a different threshold from the job
    // page is two answers to one question.
    expect(MIN_EARNED_COVERAGE).toBe(0.8);
    expect(MIN_ESTIMATE_COVERAGE).toBe(0.8);

    // Just under each threshold: 79% of contract value estimated.
    const justUnder = buildWipSchedule([
      healthy({
        lineItems: [
          line({ quantity: 79, unitPrice: 1_000, currentEstimatedUnitCost: 600, actualCostToDate: 20_000 }),
          line({ quantity: 21, unitPrice: 1_000 }),
        ],
      }),
    ]).rows[0];
    expect(justUnder.earnedRevenue).toBeNull();
    expect(justUnder.forecastGrossProfit).toBeNull();

    // And at the threshold, both are stated.
    const atThreshold = buildWipSchedule([
      healthy({
        lineItems: [
          line({ quantity: 80, unitPrice: 1_000, currentEstimatedUnitCost: 600, actualCostToDate: 20_000 }),
          line({ quantity: 20, unitPrice: 1_000 }),
        ],
      }),
    ]).rows[0];
    expect(atThreshold.earnedRevenue).not.toBeNull();
    expect(atThreshold.forecastGrossProfit).not.toBeNull();
  });
});
