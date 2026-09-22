/**
 * The savings calculator's arithmetic (wwccaSavings.ts), held to:
 *
 *   1. THE FORMULA, by hand. now = current + hours × 4.33 × rate;
 *      with = price + (hours × (1 − share)) × 4.33 × rate; saving = now − with.
 *   2. WHEN C STREAM COSTS MORE, THE SAVING IS NEGATIVE AND SAYS SO. No clamp,
 *      anywhere — a calculator that cannot lose is not a calculator.
 *   3. NOTHING TYPED PRODUCES NaN OR Infinity: empty, zero, text, negative,
 *      enormous.
 *   4. NO FLOATING-POINT DUST: every dollar figure is a whole number of cents.
 *   5. THE PRICE IS THE OFFER'S. The calculator reads its $399 out of
 *      FOUNDING_OFFER.price, so the two cannot disagree.
 *   6. EVERY DEFAULT HAS A SOURCE LINE, and the sourced one has a URL.
 */

import { describe, expect, it } from "vitest";
import {
  calculateSavings,
  cStreamMonthlyPrice,
  DEFAULT_INPUTS,
  DEFAULTS,
  INPUT_MAX,
  sanitise,
  WEEKS_PER_MONTH,
  type SavingsInputs,
} from "./wwccaSavings";
import { FOUNDING_OFFER } from "./wwcca";

const inputs = (over: Partial<SavingsInputs>): SavingsInputs => ({ ...DEFAULT_INPUTS, ...over });

/** Money as the formula must produce it: a whole number of cents. */
const isWholeCents = (dollars: number) => Number.isInteger(Math.round(dollars * 100)) && Math.abs(dollars * 100 - Math.round(dollars * 100)) < 1e-6;

describe("the savings formula", () => {
  it("uses 4.33 weeks a month and the offer's price", () => {
    expect(WEEKS_PER_MONTH).toBe(4.33);
    expect(cStreamMonthlyPrice()).toBe(399);
    expect(FOUNDING_OFFER.price).toContain("$399");
  });

  it("computes the defaults by hand: 10 h/wk, $38/h, $750/mo now, half removed", () => {
    // now  = 750 + 10 × 4.33 × 38 = 750 + 1,645.40 = 2,395.40
    // with = 399 + 5 × 4.33 × 38  = 399 + 822.70   = 1,221.70
    const r = calculateSavings(DEFAULT_INPUTS);
    expect(r.officeHoursPerMonth).toBe(43.3);
    expect(r.hoursSavedPerMonth).toBe(21.65);
    expect(r.nowMonthly).toBe(2395.4);
    expect(r.withMonthly).toBe(1221.7);
    expect(r.savingMonthly).toBe(1173.7);
    expect(r.nowYearly).toBe(28744.8);
    expect(r.withYearly).toBe(14660.4);
    expect(r.savingYearly).toBe(14084.4);
    expect(r.costsMore).toBe(false);
  });

  it("shows C Stream costing MORE when it does — a negative saving, never clamped", () => {
    // A two-hour-a-week office paying nothing today:
    // now  = 0 + 2 × 4.33 × 38 = 329.08
    // with = 399 + 1 × 4.33 × 38 = 563.54   → saving = −234.46
    const r = calculateSavings(inputs({ officeHoursPerWeek: 2, currentMonthlySpend: 0 }));
    expect(r.nowMonthly).toBe(329.08);
    expect(r.withMonthly).toBe(563.54);
    expect(r.savingMonthly).toBe(-234.46);
    expect(r.savingYearly).toBe(-2813.52);
    expect(r.costsMore).toBe(true);
  });

  it("with everything at zero, C Stream costs exactly its price", () => {
    const r = calculateSavings(inputs({ officeHoursPerWeek: 0, loadedHourlyCost: 0, currentMonthlySpend: 0, shareRemoved: 0 }));
    expect(r.nowMonthly).toBe(0);
    expect(r.withMonthly).toBe(399);
    expect(r.savingMonthly).toBe(-399);
    expect(r.savingYearly).toBe(-4788);
    expect(r.hoursSavedPerMonth).toBe(0);
    expect(r.costsMore).toBe(true);
  });

  it("handles decimals without dust: 7.4 h/wk at $41.25, $600 now, 33% removed", () => {
    // hours/mo = 7.4 × 4.33 = 32.042; saved = 32.042 × 0.33 = 10.57386 → 10.57 shown
    // now  = 600 + 32.042 × 41.25 = 600 + 1,321.7325 → 1,921.73
    // with = 399 + (32.042 − 10.57386) × 41.25 = 399 + 885.560775 → 1,284.56
    const r = calculateSavings(inputs({ officeHoursPerWeek: 7.4, loadedHourlyCost: 41.25, currentMonthlySpend: 600, shareRemoved: 0.33 }));
    expect(r.officeHoursPerMonth).toBe(32.04);
    expect(r.hoursSavedPerMonth).toBe(10.57);
    expect(r.nowMonthly).toBe(1921.73);
    expect(r.withMonthly).toBe(1284.56);
    expect(r.savingMonthly).toBe(637.17);
    expect(r.savingYearly).toBe(7646.04);
    for (const v of [r.nowMonthly, r.withMonthly, r.savingMonthly, r.nowYearly, r.withYearly, r.savingYearly]) {
      expect(isWholeCents(v), `${v} is not a whole number of cents`).toBe(true);
    }
  });

  it("the plain float product would carry dust, which is why cents are rounded first", () => {
    // The control: without rounding, the default case is not 1645.4.
    expect(10 * WEEKS_PER_MONTH * 38).not.toBe(1645.4);
    expect(calculateSavings(DEFAULT_INPUTS).nowMonthly - 750).toBe(1645.4);
  });

  it("produces finite numbers for empty, text, negative and enormous input", () => {
    const cases: unknown[] = ["", "abc", -5, Number.POSITIVE_INFINITY, Number.NaN, "1e309", 1e308, undefined, null];
    for (const bad of cases) {
      const r = calculateSavings({
        crewSize: bad as number,
        officeHoursPerWeek: bad as number,
        loadedHourlyCost: bad as number,
        currentMonthlySpend: bad as number,
        shareRemoved: bad as number,
      });
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === "number") expect(Number.isFinite(v), `${k} for ${String(bad)}`).toBe(true);
      }
    }
    // At the ceiling on every field the result is still finite, and negative
    // is allowed to be as negative as the arithmetic makes it.
    const huge = calculateSavings({ crewSize: INPUT_MAX, officeHoursPerWeek: INPUT_MAX, loadedHourlyCost: INPUT_MAX, currentMonthlySpend: INPUT_MAX, shareRemoved: 1 });
    expect(Number.isFinite(huge.nowYearly)).toBe(true);
    expect(Number.isFinite(huge.savingYearly)).toBe(true);
  });

  it("sanitise: strips $ , % and spaces, floors at 0, ceilings at the max", () => {
    expect(sanitise("$1,250.50")).toBe(1250.5);
    expect(sanitise(" 50 % ")).toBe(50);
    expect(sanitise("")).toBe(0);
    expect(sanitise("-3")).toBe(0);
    expect(sanitise("nope")).toBe(0);
    expect(sanitise(INPUT_MAX + 1)).toBe(INPUT_MAX);
    expect(sanitise(150, 100)).toBe(100);
  });
});

describe("every default carries its source", () => {
  it("has a non-empty source line on each of the five fields, and a URL on the sourced one", () => {
    const keys = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];
    expect(keys).toHaveLength(5);
    for (const key of keys) {
      const def = DEFAULTS[key];
      expect(def.source.trim().length, `${key} has no source line`).toBeGreaterThan(10);
      expect(["sourced", "example", "assumption"]).toContain(def.kind);
      if (def.kind === "sourced") expect(def.href).toMatch(/^https:\/\/www\.bls\.gov\//);
    }
    expect(DEFAULTS.loadedHourlyCost.value).toBe(38);
    expect(DEFAULTS.loadedHourlyCost.source).toContain("$26.29");
    expect(DEFAULTS.officeHoursPerWeek.value).toBe(10);
    expect(DEFAULTS.officeHoursPerWeek.source).toMatch(/use your own/i);
    expect(DEFAULTS.currentMonthlySpend.value).toBe(750);
    expect(DEFAULTS.currentMonthlySpend.source).toContain("$1,000–$5,000");
    expect(DEFAULTS.currentMonthlySpend.source).toContain("$99–$399");
    expect(DEFAULTS.shareRemoved.value).toBe(0.5);
    expect(DEFAULTS.shareRemoved.kind).toBe("assumption");
    expect(DEFAULTS.crewSize.value).toBe(25);
  });

  it("never uses the unsourced 8.3 hours/week figure", () => {
    for (const def of Object.values(DEFAULTS)) {
      expect(def.value).not.toBe(8.3);
      expect(def.source).not.toContain("8.3");
    }
  });
});
