import { describe, expect, it } from "vitest";
import { bidRecap, ownMarkupSet, unitPriceFromCost, type RecapRates } from "./bid-recap";

const RATES: RecapRates = { materialMarkupPercent: 10, laborMarkupPercent: 10, overheadPercent: 8, profitPercent: 10 };

describe("a line priced from its cost", () => {
  it("runs the category markup, then overhead, then profit", () => {
    // 100 sq ft of material at $2: 200 → 220 → 237.60 → 261.36, so $2.61 a foot.
    expect(unitPriceFromCost({ quantity: 100, unitCost: 2, costCategory: "MATERIAL" }, RATES)).toBe("2.61");
    // 10 hours of labor at $30: 300 → 330 → 356.40 → 392.04.
    expect(unitPriceFromCost({ quantity: 10, unitCost: 30, costCategory: "LABOR" }, RATES)).toBe("39.20");
  });

  it("sums to the job's recap, line by line, to the cent per unit", () => {
    const lines = [
      { id: "a", quantity: 50, unitCost: 4, unitPrice: null, costCategory: "MATERIAL" as const },
      { id: "b", quantity: 20, unitCost: 45, unitPrice: null, costCategory: "LABOR" as const },
    ];
    const recap = bidRecap(lines, RATES);
    const summed = lines.reduce((sum, line) => sum + line.quantity * Number(unitPriceFromCost(line, RATES)), 0);
    expect(Math.abs(summed - recap.bidTotal)).toBeLessThanOrEqual(lines.reduce((sum, line) => sum + line.quantity * 0.005, 0));
  });

  it("takes no category markup on a line with no category, as the recap does", () => {
    // 200 → (no markup) → 216 → 237.60.
    expect(unitPriceFromCost({ quantity: 100, unitCost: 2, costCategory: null }, RATES)).toBe("2.38");
  });

  it("has nothing to divide on a zero quantity", () => {
    expect(unitPriceFromCost({ quantity: 0, unitCost: 2, costCategory: "MATERIAL" }, RATES)).toBeNull();
  });

  it("needs all four of the company's own rates before it is the way a line is priced", () => {
    expect(ownMarkupSet(RATES)).toBe(true);
    expect(ownMarkupSet({ ...RATES, profitPercent: null })).toBe(false);
    expect(ownMarkupSet({ ...RATES, overheadPercent: 0 })).toBe(true);
  });
});
