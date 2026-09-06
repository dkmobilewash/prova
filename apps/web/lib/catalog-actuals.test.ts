import { describe, expect, it } from "vitest";
import {
  catalogActuals,
  CATALOG_MIN_SAMPLE,
  CATALOG_VARIANCE_THRESHOLD,
  type JobStatusForActuals,
} from "./catalog-actuals";

/** A costed line on a FINISHED job — the only kind that counts toward an
 * actual unit cost. See the running-job cases below for why. */
const line = (
  quantity: number,
  actualCost: number,
  hasCosts = true,
  jobStatus: JobStatusForActuals = "COMPLETE",
) => ({
  quantity,
  actualCost,
  hasCosts,
  jobStatus,
});

const runningLine = (quantity: number, actualCost: number) =>
  line(quantity, actualCost, true, "IN_PROGRESS");

describe("catalogActuals", () => {
  it("reports nothing when no line has been costed", () => {
    const result = catalogActuals([line(100, 0, false)], 5);
    expect(result.actualUnitCost).toBeNull();
    expect(result.variance).toBeNull();
    expect(result.isFlagged).toBe(false);
  });

  it("weights by quantity rather than averaging per-line rates", () => {
    // 500 SF at $2/SF and 5 SF at $20/SF. Averaging the two rates gives $11;
    // the truthful figure is total cost over total quantity — $1,100 / 505.
    const result = catalogActuals([line(500, 1000), line(5, 100)], 2);
    expect(result.actualUnitCost).toBeCloseTo(1100 / 505, 6);
    expect(result.actualUnitCost).not.toBeCloseTo(11, 1);
  });

  it("computes variance against the default", () => {
    const result = catalogActuals([line(100, 600), line(100, 600)], 5);
    expect(result.actualUnitCost).toBe(6);
    expect(result.variance).toBe(1);
    expect(result.variancePct).toBeCloseTo(0.2, 6);
    expect(result.isFlagged).toBe(true);
  });

  it("flags under-running entries too, not just over-runs", () => {
    // A default priced well above reality loses work by overbidding — just
    // as worth surfacing as one that loses money by underbidding.
    const result = catalogActuals([line(100, 400), line(100, 400)], 5);
    expect(result.variancePct).toBeCloseTo(-0.2, 6);
    expect(result.isFlagged).toBe(true);
  });

  it("does not flag drift inside the threshold", () => {
    const result = catalogActuals([line(100, 510), line(100, 510)], 5);
    expect(Math.abs(result.variancePct!)).toBeLessThan(CATALOG_VARIANCE_THRESHOLD);
    expect(result.isFlagged).toBe(false);
  });

  it("never flags on a single job, however far off it is", () => {
    // One bad job is an anecdote. Re-pricing the catalog from it would
    // propagate that job's problem into every future bid.
    const result = catalogActuals([line(100, 5000)], 5);
    expect(result.linesWithCosts).toBe(1);
    expect(result.linesWithCosts).toBeLessThan(CATALOG_MIN_SAMPLE);
    expect(result.variancePct).toBeCloseTo(9, 6);
    expect(result.isFlagged).toBe(false);
  });

  it("reports actuals but never flags when the entry has no default to compare against", () => {
    const result = catalogActuals([line(100, 600), line(100, 600)], null);
    expect(result.actualUnitCost).toBe(6);
    expect(result.variance).toBeNull();
    expect(result.isFlagged).toBe(false);
  });

  it("does not divide by zero on a free default or zero quantities", () => {
    expect(catalogActuals([line(100, 600), line(100, 600)], 0).variancePct).toBeNull();
    expect(catalogActuals([line(0, 600), line(0, 600)], 5).actualUnitCost).toBeNull();
  });

  it("ignores uncosted lines when sizing the sample", () => {
    // Two lines exist but only one has costs — still an anecdote.
    const result = catalogActuals([line(100, 5000), line(100, 0, false)], 5);
    expect(result.linesWithCosts).toBe(1);
    expect(result.isFlagged).toBe(false);
  });
});

describe("jobs that are still running", () => {
  // The defect this describes was one-directional, which is what made it
  // dangerous. Cost lands on a line over the months the work takes;
  // quantity is the whole scope from day one. Every unfinished job
  // therefore reads LOW, the errors reinforce instead of cancelling, and
  // "update default from actuals" walks the catalog toward zero.

  it("does not price a template off work that is only part built", () => {
    // Hand-worked: 1,000 SF lines truly running at $2.00/SF. Two are
    // finished and cost $2,000 each. Two are 40% built, so $800 of cost
    // has landed on each. Counting all four gives $5,600 / 4,000 SF =
    // $1.40/SF — 30% under, amber, and one click from becoming the
    // default. The finished two alone give the truth: $2.00/SF.
    const result = catalogActuals(
      [line(1000, 2000), line(1000, 2000), runningLine(1000, 800), runningLine(1000, 800)],
      2,
    );

    expect(result.actualUnitCost).toBe(2);
    expect(result.linesWithCosts).toBe(2);
    expect(result.linesExcludedUnfinished).toBe(2);
    expect(result.variance).toBe(0);
    expect(result.isFlagged).toBe(false);

    // What the old arithmetic said, spelled out so the fix cannot be
    // reverted without this failing.
    expect(result.actualUnitCost).not.toBeCloseTo(5600 / 4000, 6);
  });

  it("reports nothing at all when every costed job is still running", () => {
    const result = catalogActuals([runningLine(1000, 800), runningLine(1000, 800)], 2);
    expect(result.actualUnitCost).toBeNull();
    expect(result.linesWithCosts).toBe(0);
    expect(result.linesExcludedUnfinished).toBe(2);
    expect(result.isFlagged).toBe(false);
  });

  it("excludes a contracted job that has not started, and an estimate", () => {
    const result = catalogActuals(
      [line(100, 600, true, "CONTRACTED"), line(100, 600, true, "ESTIMATE")],
      5,
    );
    expect(result.actualUnitCost).toBeNull();
    expect(result.linesExcludedUnfinished).toBe(2);
  });

  it("counts an uncosted running job as neither sample nor exclusion", () => {
    // Nothing has been booked against it, so there is nothing to leave
    // out — saying "1 line excluded" here would be reporting an absence
    // as evidence.
    const result = catalogActuals(
      [line(100, 600), line(100, 600), line(100, 0, false, "IN_PROGRESS")],
      5,
    );
    expect(result.linesWithCosts).toBe(2);
    expect(result.linesExcludedUnfinished).toBe(0);
  });
});
