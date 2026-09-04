import { describe, expect, it } from "vitest";
import { calculateJobWip, calculateLineItemWip, type WipLineItemInput } from "./wip";

// wip.ts had NO unit test at all until this file. company-financials.test.ts
// hand-builds WipJobResult literals and never calls calculateJobWip, so not
// one line of the percentage-of-completion math was executed by anything.
// That is half of issue #100: the 550% was not caught because nothing looked.

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

describe("job % complete draws both sides of the ratio from the same lines", () => {
  it("keeps cost on unestimated lines out of BOTH sides of percent complete", () => {
    // Issue #100 repro B. A change-order line that ran away is exactly the
    // line nobody re-forecasts, and its cost was landing in the numerator
    // against a denominator it was not part of.
    const framing = line({
      unitPrice: 480_000,
      budgetedUnitCost: 320_000,
      currentEstimatedUnitCost: 320_000,
      actualCostToDate: 96_000,
    });
    const changeOrder = line({ unitPrice: 120_000, actualCostToDate: 210_000 });
    expect(changeOrder.estimatedCostAtCompletion).toBeNull();

    const job = calculateJobWip([framing, changeOrder], 0);

    expect(job.percentComplete).toBeCloseTo(0.3, 10);
    // The displayed spend total must stay the FULL spend. An over-eager fix
    // that filters this too would understate cost on the job page and
    // overstate company gross margin — a worse bug than the one being fixed.
    expect(job.actualCostToDate).toBe(306_000);
    expect(job.estimatedCostAtCompletion).toBe(320_000);
  });

  it("does not report 550% complete when one unbudgeted line carries cost", () => {
    const generalConditions = line({
      budgetedUnitCost: 20_000,
      currentEstimatedUnitCost: 20_000,
      actualCostToDate: 20_000,
    });
    const drywall = line({ quantity: 100_000, unitPrice: 3, actualCostToDate: 90_000 });

    const job = calculateJobWip([generalConditions, drywall], 0);

    expect(job.percentComplete).toBe(1);
    expect(job.actualCostToDate).toBe(110_000);
    expect(job.contractValue).toBe(300_000);
  });

  it("excludes a line forecast to cost zero, the same way the line-level math does", () => {
    // A negative cost-to-complete override reaches the database: the form
    // input at jobs/[id]/page.tsx is plain text and nullableDecimalFromForm
    // only rejects NaN. That drives estimatedCostAtCompletion to exactly 0,
    // which is NOT null — so a `!== null` filter would let the line donate
    // its real cost to the numerator and nothing to the denominator, which
    // is the identical defect one layer down.
    const zeroForecast = line({
      currentEstimatedUnitCost: 50_000,
      estimatedCostToComplete: -40_000,
      actualCostToDate: 40_000,
    });
    expect(zeroForecast.estimatedCostAtCompletion).toBe(0);
    expect(zeroForecast.percentComplete).toBeNull();

    const normal = line({ currentEstimatedUnitCost: 10_000, actualCostToDate: 1_000 });
    const job = calculateJobWip([zeroForecast, normal], 0);

    expect(job.percentComplete).toBeCloseTo(0.1, 10);
    expect(job.actualCostToDate).toBe(41_000);
  });

  it("returns null percent complete when no line has a forecast, even with cost booked", () => {
    const job = calculateJobWip([line({ unitPrice: 50_000, actualCostToDate: 30_000 })], 0);
    expect(job.percentComplete).toBeNull();
    expect(job.actualCostToDate).toBe(30_000);
  });

  it("weights by cost, not by averaging the per-line percentages", () => {
    const a = line({ currentEstimatedUnitCost: 100_000, actualCostToDate: 50_000 }); // 50%
    const b = line({ currentEstimatedUnitCost: 300_000, actualCostToDate: 30_000 }); // 10%
    const job = calculateJobWip([a, b], 0);
    expect(job.percentComplete).toBeCloseTo(0.2, 10); // NOT 0.3, the naive average
  });

  it("excludes a line with a budget but no current forecast — budgetedUnitCost is display-only", () => {
    // The issue text says "budgeted lines". It is not budgetedUnitCost that
    // drives any of this math; wip.ts:57-65 reads estimatedCostToComplete
    // and currentEstimatedUnitCost only.
    const l = line({ unitPrice: 100, budgetedUnitCost: 60, actualCostToDate: 10 });
    expect(l.budgetedCost).toBe(60);
    expect(l.estimatedCostAtCompletion).toBeNull();
    expect(calculateJobWip([l], 0).percentComplete).toBeNull();
  });
});

describe("how much of the job the percentage is actually based on", () => {
  it("says what share of spend the percentage was computed over", () => {
    // Repro B again. Reporting "30.0% complete" over $96,000 of a $306,000
    // spend without saying so is a different wrong number, not a right one.
    const framing = line({
      unitPrice: 480_000,
      currentEstimatedUnitCost: 320_000,
      actualCostToDate: 96_000,
    });
    const changeOrder = line({ unitPrice: 120_000, actualCostToDate: 210_000 });

    const job = calculateJobWip([framing, changeOrder], 0);

    expect(job.costCoverage).toBeCloseTo(96_000 / 306_000, 10);
  });

  it("is full coverage when every line carries a forecast", () => {
    const job = calculateJobWip(
      [line({ currentEstimatedUnitCost: 100_000, actualCostToDate: 40_000 })],
      0,
    );
    expect(job.costCoverage).toBe(1);
  });

  it("treats no spend at all as nothing uncounted, rather than dividing by zero", () => {
    const job = calculateJobWip([line({ unitPrice: 10_000 })], 0);
    expect(job.costCoverage).toBe(1);
    expect(job.percentComplete).toBeNull();
  });
});

describe("line-level WIP semantics the job math stands on", () => {
  it("prefers an explicit cost-to-complete override over the derived value", () => {
    const l = line({
      currentEstimatedUnitCost: 100_000,
      estimatedCostToComplete: 5_000,
      actualCostToDate: 80_000,
    });
    expect(l.estimatedCostAtCompletion).toBe(85_000);
    expect(l.percentComplete).toBeCloseTo(80_000 / 85_000, 10);
  });

  it("floors cost-to-complete at zero on an overrun", () => {
    const l = line({ currentEstimatedUnitCost: 100_000, actualCostToDate: 130_000 });
    expect(l.estimatedCostAtCompletion).toBe(130_000);
    expect(l.percentComplete).toBe(1);
  });

  it("gives a cost-only line no contract value and no earned revenue", () => {
    const l = line({ unitPrice: null, currentEstimatedUnitCost: 10_000, actualCostToDate: 5_000 });
    expect(l.contractValue).toBe(0);
    expect(l.percentComplete).toBe(0.5);
    expect(l.earnedRevenue).toBe(0);
  });

  it("reports overbilling as positive and underbilling as negative", () => {
    const job = calculateJobWip(
      [line({ unitPrice: 100_000, currentEstimatedUnitCost: 60_000, actualCostToDate: 30_000 })],
      70_000,
    );
    expect(job.earnedRevenue).toBe(50_000);
    expect(job.overUnderBilling).toBe(20_000);
  });
});
