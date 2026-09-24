import { describe, expect, it } from "vitest";
import {
  actualProductionRate,
  estimatedHours,
  hoursFromRate,
  productionBackCheck,
  productionRateVariance,
  MIN_ACTUAL_HOURS,
} from "./labor-productivity";

describe("hoursFromRate", () => {
  it("divides quantity by the rate, in units per hour", () => {
    // 4000 SF at 62.5 SF/hr = 64 hrs.
    expect(hoursFromRate(4000, 62.5)).toBe(64);
  });

  it("returns null when there is nothing to divide", () => {
    expect(hoursFromRate(0, 62.5)).toBeNull();
    expect(hoursFromRate(4000, null)).toBeNull();
    expect(hoursFromRate(4000, 0)).toBeNull();
  });
});

describe("estimatedHours", () => {
  it("derives hours from the rate when no manual hours are given", () => {
    expect(estimatedHours({ quantity: 4000, laborHours: null, productionRate: 62.5 })).toBe(64);
  });

  it("lets a manually-typed laborHours override the rate", () => {
    expect(estimatedHours({ quantity: 4000, laborHours: 70, productionRate: 62.5 })).toBe(70);
  });

  it("returns null when neither is given", () => {
    expect(estimatedHours({ quantity: 4000, laborHours: null, productionRate: null })).toBeNull();
  });
});

describe("actualProductionRate", () => {
  it("turns logged hours back into units per hour", () => {
    // 4000 SF took 80 hrs = 50 SF/hr.
    expect(actualProductionRate(4000, 80)).toBe(50);
  });

  it("returns null when nothing was measured or produced", () => {
    expect(actualProductionRate(0, 80)).toBeNull();
    expect(actualProductionRate(4000, 0)).toBeNull();
  });
});

describe("productionRateVariance", () => {
  it("is negative when slower than estimated", () => {
    expect(productionRateVariance(50, 62.5)).toBeCloseTo(-0.2);
  });

  it("is positive when faster than estimated", () => {
    expect(productionRateVariance(62.5, 50)).toBeCloseTo(0.25);
  });

  it("returns null when there is no estimate to compare against", () => {
    expect(productionRateVariance(50, 0)).toBeNull();
  });
});

describe("productionBackCheck", () => {
  it("compares the achieved rate to the estimate and flags a big miss", () => {
    // Estimated 64 hrs, took 80: 50 SF/hr vs 62.5 = 20% slower.
    const check = productionBackCheck({ quantity: 4000, estimatedHours: 64, actualHours: 80 });
    expect(check).not.toBeNull();
    expect(check!.estimatedRate).toBeCloseTo(62.5);
    expect(check!.actualRate).toBeCloseTo(50);
    expect(check!.variance).toBeCloseTo(-0.2);
    expect(check!.isFlagged).toBe(true);
  });

  it("does not flag a miss inside the threshold", () => {
    // 70 hrs vs 64 estimated = ~8.6% slower, inside 15%.
    const check = productionBackCheck({ quantity: 4000, estimatedHours: 64, actualHours: 70 });
    expect(check!.isFlagged).toBe(false);
  });

  it("returns null with no estimate to compare against", () => {
    expect(productionBackCheck({ quantity: 4000, estimatedHours: null, actualHours: 80 })).toBeNull();
  });

  it("returns null below the minimum actual-hours sample", () => {
    expect(
      productionBackCheck({ quantity: 4000, estimatedHours: 64, actualHours: MIN_ACTUAL_HOURS - 1 }),
    ).toBeNull();
  });
});
