import { describe, expect, it } from "vitest";
import type { WipJobResult } from "@/lib/wip";
import { calculateJobWip, calculateLineItemWip } from "@/lib/wip";
import { MIN_COST_COVERAGE, MIN_EARNED_COVERAGE } from "@/lib/company-financials";
import {
  WIP_SCHEDULE_COLUMNS,
  wipScheduleRow,
  wipScheduleTable,
  wipScheduleTotals,
} from "@/lib/wip-schedule";
import { toCsv } from "@/lib/export";

/** A WIP result with everything covered, overridable per test. Written as a
 * literal rather than derived so a test about coverage can set coverage
 * directly instead of reverse-engineering line items that produce it. */
function wip(overrides: Partial<WipJobResult> = {}): WipJobResult {
  return {
    contractValue: 100_000,
    actualCostToDate: 30_000,
    estimatedCostAtCompletion: 60_000,
    percentComplete: 0.5,
    costCoverage: 1,
    earnedCoverage: 1,
    estimatedCoverage: 1,
    earnedRevenue: 50_000,
    billedToDate: 55_000,
    overUnderBilling: 5_000,
    ...overrides,
  };
}

const job = (w: WipJobResult) => wipScheduleRow({ name: "Tower B", customer: "Baird GC", status: "IN_PROGRESS", wip: w });

describe("a job whose estimates are there", () => {
  it("states every figure", () => {
    const row = job(wip());
    expect(row.contractValue).toBe(100_000);
    expect(row.costToDate).toBe(30_000);
    expect(row.estimatedGrossProfit).toBe(40_000);
    expect(row.percentComplete).toBe(50);
    expect(row.earnedRevenue).toBe(50_000);
    expect(row.grossProfitEarned).toBe(20_000);
    expect(row.billedToDate).toBe(55_000);
    expect(row.backlog).toBe(50_000);
  });

  it("splits the billing position into the two balance-sheet columns", () => {
    // Overbilled is a liability, underbilled an asset. They are two lines on
    // a balance sheet, which is why this format has two columns where
    // WipJobResult has one signed number.
    const over = job(wip({ billedToDate: 55_000, overUnderBilling: 5_000 }));
    expect(over.overbilled).toBe(5_000);
    expect(over.underbilled).toBe(0);

    const under = job(wip({ billedToDate: 42_000, overUnderBilling: -8_000 }));
    expect(under.overbilled).toBe(0);
    expect(under.underbilled).toBe(8_000);
  });
});

describe("a job whose estimates are mostly missing", () => {
  // THE POINT OF THIS FILE. The app already refuses to state these figures
  // on screen below 80% coverage -- jobOverUnderBilling's own comment calls
  // "Overbilled $80,000" an artefact of missing estimates rather than a fact
  // about the job. An export that printed them anyway would be worse than
  // the screen: a dash invites a question, a number in a spreadsheet handed
  // to an underwriter does not.
  const thin = wip({ earnedCoverage: MIN_EARNED_COVERAGE - 0.01 });

  it("leaves the derived positions blank", () => {
    const row = job(thin);
    expect(row.earnedRevenue).toBeNull();
    expect(row.grossProfitEarned).toBeNull();
    expect(row.overbilled).toBeNull();
    expect(row.underbilled).toBeNull();
    expect(row.backlog).toBeNull();
  });

  it("blank is not zero", () => {
    // The failure this guards is a reader summing a column of zeros and
    // concluding the book is balanced. Zero is a claim; blank is not.
    const row = job(thin);
    for (const value of [row.earnedRevenue, row.overbilled, row.underbilled, row.backlog]) {
      expect(value).not.toBe(0);
      expect(value).toBeNull();
    }
  });

  it("still states the money that actually moved", () => {
    // calculateCompanyFinancials' rule, applied here: "The coverage question
    // is answered by silencing the RATE, never by quietly changing which
    // jobs the sums are over." Cost and billings are facts either way.
    const row = job(thin);
    expect(row.costToDate).toBe(30_000);
    expect(row.billedToDate).toBe(55_000);
    expect(row.contractValue).toBe(100_000);
  });

  it("silences percent complete on COST coverage, not the other two", () => {
    // costCoverage is the only one of the three weighted by actual spend, so
    // it is the only one that answers "was this percentage drawn from most
    // of the money".
    expect(job(wip({ costCoverage: MIN_COST_COVERAGE - 0.01 })).percentComplete).toBeNull();
    expect(job(wip({ costCoverage: MIN_COST_COVERAGE })).percentComplete).toBe(50);
    // A thin EARNED coverage must not blank the percentage -- different
    // predicate, different question.
    expect(job(wip({ earnedCoverage: 0 })).percentComplete).toBe(50);
  });

  it("pins the threshold to a literal, not to itself", () => {
    // MUTATION M6 SURVIVED THE FIRST VERSION OF THIS FILE. Every coverage
    // test above builds its fixture from MIN_COST_COVERAGE, so the fixtures
    // move with the constant: setting it to 0 left all of them green while
    // the export happily stated a percentage drawn from none of the spend.
    //
    // Same family as the size cross-check in dateRenderCensus.test.ts and
    // the 180-of-181 in scratch-cleanup-order.test.ts -- a check that
    // derives its own input cannot see its input change. So the threshold
    // is pinned to a literal, and the behaviour is asserted at concrete
    // coverages with no constant in sight.
    expect(MIN_COST_COVERAGE).toBe(0.8);
    expect(MIN_COST_COVERAGE).toBe(MIN_EARNED_COVERAGE);

    expect(job(wip({ costCoverage: 0.5 })).percentComplete).toBeNull();
    expect(job(wip({ costCoverage: 0.79 })).percentComplete).toBeNull();
    expect(job(wip({ costCoverage: 0.95 })).percentComplete).toBe(50);

    expect(job(wip({ earnedCoverage: 0.5 })).earnedRevenue).toBeNull();
    expect(job(wip({ earnedCoverage: 0.95 })).earnedRevenue).toBe(50_000);
  });

  it("silences estimated gross profit when the cost estimate is thin", () => {
    // Found by reading a sample file, not by a test. Contract less forecast
    // mixes a full contract value against a partial cost, so an 840k job
    // with 96k of forecast covering 22% read "estimated gross profit
    // 744,000" -- the unestimated part of the job wearing a forecast.
    expect(job(wip({ estimatedCoverage: 0.22 })).estimatedGrossProfit).toBeNull();
    expect(job(wip({ estimatedCoverage: 0.5 })).estimatedGrossProfit).toBeNull();
    expect(job(wip({ estimatedCoverage: 0.95 })).estimatedGrossProfit).toBe(40_000);
    // Guarded on the ESTIMATE ratio, not the earned one -- different
    // predicates, which is why this codebase keeps three constants.
    expect(job(wip({ earnedCoverage: 0 })).estimatedGrossProfit).toBe(40_000);
  });

  it("reports the coverage that caused the blank", () => {
    const row = job(thin);
    expect(row.earnedCoverage).toBe(79);
    expect(row.costCoverage).toBe(100);
  });
});

describe("totals", () => {
  it("sums only what the rows were willing to state", () => {
    const rows = [job(wip()), job(wip({ earnedCoverage: 0 }))];
    const total = wipScheduleTotals(rows);
    expect(total.costToDate).toBe(60_000);
    expect(total.billedToDate).toBe(110_000);
    // Only the first job produced an earned figure.
    expect(total.earnedRevenue).toBe(50_000);
  });

  it("leaves rates and coverage blank", () => {
    // An average of percentages is not a fact about the book. Summing both
    // sides before dividing is what calculateCompanyFinancials does, and a
    // totals line cannot do it, so it says nothing.
    const total = wipScheduleTotals([job(wip()), job(wip())]);
    expect(total.percentComplete).toBeNull();
    expect(total.costCoverage).toBeNull();
    expect(total.earnedCoverage).toBeNull();
    expect(total.estimateCoverage).toBeNull();
  });

  it("is the last row of the table", () => {
    const table = wipScheduleTable([
      { name: "A", customer: "GC", status: "IN_PROGRESS", wip: wip() },
      { name: "B", customer: "GC", status: "CONTRACTED", wip: wip() },
    ]);
    expect(table).toHaveLength(3);
    expect(table[2].job).toBe("TOTAL");
  });
});

describe("the column list and the row shape agree", () => {
  it("names every field exactly once, and no field it does not have", () => {
    // The structural guard. A field added to WipScheduleRow but not to
    // WIP_SCHEDULE_COLUMNS is a column that silently never reaches the file
    // -- the export would look complete and be missing a number. Types
    // vanish at runtime, so this compares against the keys of a real row.
    const rowKeys = Object.keys(job(wip())).sort();
    const columnKeys = WIP_SCHEDULE_COLUMNS.map((c) => String(c.key)).sort();
    expect(columnKeys).toEqual(rowKeys);
    expect(new Set(columnKeys).size).toBe(columnKeys.length);
  });

  it("labels the over/under columns as a reader of a WIP schedule names them", () => {
    const labels = WIP_SCHEDULE_COLUMNS.map((c) => c.label);
    expect(labels).toContain("Billings in excess of earnings (overbilled)");
    expect(labels).toContain("Earnings in excess of billings (underbilled)");
  });
});

describe("the CSV itself", () => {
  it("neutralises a job name that a spreadsheet would run as a formula", () => {
    // A job name is user-entered and can also arrive from an import. csvCell
    // handles this; this asserts the export actually goes through it.
    const row = wipScheduleRow({
      name: '=HYPERLINK("http://x","click")',
      customer: "Baird GC",
      status: "IN_PROGRESS",
      wip: wip(),
    });
    const csv = toCsv(
      WIP_SCHEDULE_COLUMNS.map((c) => c.label),
      [Object.fromEntries(WIP_SCHEDULE_COLUMNS.map((c) => [c.label, row[c.key]]))],
    );
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it("writes a silenced figure as an empty cell", () => {
    const row = wipScheduleRow({
      name: "Tower B",
      customer: "Baird GC",
      status: "IN_PROGRESS",
      wip: wip({ earnedCoverage: 0 }),
    });
    const csv = toCsv(["Earned revenue to date"], [{ "Earned revenue to date": row.earnedRevenue }]);
    // Header line, then a line that is empty -- not "0".
    expect(csv.split("\n")[1]).toBe("");
  });
});

describe("against the real WIP math", () => {
  it("carries through a job built from line items rather than a literal", () => {
    // One end-to-end case so the literals above cannot drift from what
    // calculateJobWip actually produces.
    const lines = [
      calculateLineItemWip({
        quantity: 100,
        unitPrice: 1_000,
        budgetedUnitCost: 600,
        currentEstimatedUnitCost: 600,
        estimatedCostToComplete: null,
        actualCostToDate: 30_000,
      }),
    ];
    const result = calculateJobWip(lines, 55_000);
    const row = job(result);
    expect(row.contractValue).toBe(100_000);
    expect(row.estimatedCostAtCompletion).toBe(60_000);
    expect(row.percentComplete).toBe(50);
    expect(row.earnedRevenue).toBe(50_000);
    expect(row.overbilled).toBe(5_000);
    expect(row.underbilled).toBe(0);
  });
});
