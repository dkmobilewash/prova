import { describe, expect, it } from "vitest";
import { catalogActuals, CATALOG_MIN_SAMPLE, CATALOG_VARIANCE_THRESHOLD } from "./catalog-actuals";

const line = (quantity: number, actualCost: number, hasCosts = true) => ({
  quantity,
  actualCost,
  hasCosts,
});

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
