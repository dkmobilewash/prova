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
 *   7. THE PER-WORKER FIGURE IS saving ÷ crew, whole cents, the saving's
 *      sign — and NULL below one person, never Infinity or NaN. The crew
 *      size divides; it multiplies nothing.
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
    // per worker = 1,173.70 ÷ 25 = 46.948 → 46.95
    expect(r.savingPerWorkerMonthly).toBe(46.95);
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
    // per worker = −234.46 ÷ 25 = −9.3784 → −9.38: the extra cost per
    // worker, negative, never clamped.
    expect(r.savingPerWorkerMonthly).toBe(-9.38);
  });

  describe("the per-worker figure", () => {
    it("divides the monthly saving by the crew size and rounds once to the cent", () => {
      // 117,370 cents ÷ 7 = 16,767.14… → 16,767 cents
      expect(calculateSavings(inputs({ crewSize: 7 })).savingPerWorkerMonthly).toBe(167.67);
      // A crew of one gets the whole office saving.
      expect(calculateSavings(inputs({ crewSize: 1 })).savingPerWorkerMonthly).toBe(1173.7);
      // A crew of 25 exactly as the page shows it.
      expect(calculateSavings(inputs({ crewSize: 25 })).savingPerWorkerMonthly).toBe(46.95);
    });

    it("is null — not Infinity, not NaN, not 0 — for a crew size of 0, empty, text, negative or a fraction below 1", () => {
      for (const crew of [0, "", "abc", -3, 0.5, "0", "-1", 0.999]) {
        const r = calculateSavings(inputs({ crewSize: crew as number }));
        expect(r.savingPerWorkerMonthly, `crew ${JSON.stringify(crew)}`).toBeNull();
        // And the office figures are untouched by an unusable crew size.
        expect(r.savingMonthly).toBe(1173.7);
      }
    });

    it("is negative and exact when C Stream costs more", () => {
      // now = 0 + 2 × 4.33 × 38 = 329.08; with = 399 + 329.08 ÷ 2 = 563.54
      // saving = −234.46; ÷ 10 people = −23.446 → −23.45
      const r = calculateSavings(inputs({ crewSize: 10, officeHoursPerWeek: 2, currentMonthlySpend: 0 }));
      expect(r.costsMore).toBe(true);
      expect(r.savingPerWorkerMonthly).toBe(-23.45);
      // With everything at zero, the price itself is spread across the crew:
      // −399 ÷ 4 = −99.75, exactly.
      const zero = calculateSavings(inputs({ crewSize: 4, officeHoursPerWeek: 0, loadedHourlyCost: 0, currentMonthlySpend: 0, shareRemoved: 0 }));
      expect(zero.savingPerWorkerMonthly).toBe(-99.75);
    });

    it("carries no floating-point dust on a large crew", () => {
      // 117,370 cents ÷ 1,000 = 117.37 cents → 117 cents; a plain float
      // division would print 1.1737.
      const thousand = calculateSavings(inputs({ crewSize: 1000 }));
      expect(thousand.savingPerWorkerMonthly).toBe(1.17);
      expect(isWholeCents(thousand.savingPerWorkerMonthly!)).toBe(true);
      // And the decimal case, ÷ 3: 63,717 cents ÷ 3 = 21,239 exactly.
      const three = calculateSavings(inputs({ crewSize: 3, officeHoursPerWeek: 7.4, loadedHourlyCost: 41.25, currentMonthlySpend: 600, shareRemoved: 0.33 }));
      expect(three.savingPerWorkerMonthly).toBe(212.39);
      for (const crew of [3, 7, 13, 999, 12345, INPUT_MAX]) {
        const v = calculateSavings(inputs({ crewSize: crew })).savingPerWorkerMonthly;
        expect(v, `crew ${crew}`).not.toBeNull();
        expect(isWholeCents(v!), `${v} for crew ${crew} is not a whole number of cents`).toBe(true);
      }
    });

    it("never multiplies by the crew: the office figures are the same at any crew size", () => {
      const a = calculateSavings(inputs({ crewSize: 1 }));
      const b = calculateSavings(inputs({ crewSize: 500 }));
      expect(a.savingPerWorkerMonthly).not.toBe(b.savingPerWorkerMonthly);
      expect({ ...a, savingPerWorkerMonthly: null }).toEqual({ ...b, savingPerWorkerMonthly: null });
    });
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
      // The per-worker figure is the one field allowed to be null, and for
      // junk crew it must be null — never NaN, never Infinity, and never a
      // number smuggled past the loop above by not being typeof "number".
      const perWorker = r.savingPerWorkerMonthly;
      expect(perWorker === null || Number.isFinite(perWorker), `savingPerWorkerMonthly for ${String(bad)} is ${String(perWorker)}`).toBe(true);
      expect(Number.isNaN(perWorker as number)).toBe(false);
    }
    // At the ceiling on every field the result is still finite, and negative
    // is allowed to be as negative as the arithmetic makes it.
    const huge = calculateSavings({ crewSize: INPUT_MAX, officeHoursPerWeek: INPUT_MAX, loadedHourlyCost: INPUT_MAX, currentMonthlySpend: INPUT_MAX, shareRemoved: 1 });
    expect(Number.isFinite(huge.nowYearly)).toBe(true);
    expect(Number.isFinite(huge.savingYearly)).toBe(true);
    expect(Number.isFinite(huge.savingPerWorkerMonthly!)).toBe(true);
    // A junk crew size on an otherwise sane office yields null: NaN and
    // Infinity are both junk to sanitise() (it makes them 0), so neither is
    // ever a divisor. A crew AT the ceiling still divides, to a finite figure.
    expect(calculateSavings(inputs({ crewSize: Number.NaN })).savingPerWorkerMonthly).toBeNull();
    expect(calculateSavings(inputs({ crewSize: Number.POSITIVE_INFINITY })).savingPerWorkerMonthly).toBeNull();
    expect(calculateSavings(inputs({ crewSize: INPUT_MAX })).savingPerWorkerMonthly).toBe(0);
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
    expect(DEFAULTS.currentMonthlySpend.source).toContain("$49–$249");
    expect(DEFAULTS.currentMonthlySpend.source).toContain("$99–$329");
    expect(DEFAULTS.shareRemoved.value).toBe(0.5);
    expect(DEFAULTS.shareRemoved.kind).toBe("assumption");
    expect(DEFAULTS.crewSize.value).toBe(25);
    // The crew size's source line must say what the field now DOES — it
    // divides — and must not carry the old "the result is per office, not
    // per worker" claim, which became false when the per-worker line landed.
    expect(DEFAULTS.crewSize.kind).toBe("example");
    expect(DEFAULTS.crewSize.source).toMatch(/divides/);
    expect(DEFAULTS.crewSize.source).toMatch(/per-worker/);
    expect(DEFAULTS.crewSize.source).not.toMatch(/the result is per office/);
    expect(DEFAULTS.crewSize.source).not.toMatch(/shown for scale/i);
  });

  it("never uses the unsourced 8.3 hours/week figure", () => {
    for (const def of Object.values(DEFAULTS)) {
      expect(def.value).not.toBe(8.3);
      expect(def.source).not.toContain("8.3");
    }
  });
});
