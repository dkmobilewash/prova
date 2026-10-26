import { describe, expect, it } from "vitest";
import {
  adjustmentLabel,
  gcPrice,
  parseGcAdjustment,
  percentOfCents,
  projectGcPrices,
  toCents,
  toThousandths,
} from "./gc-price";

/**
 * What one GC is quoted: the estimate total plus that GC's own adjustment.
 * The arithmetic is whole cents in integers, and a price of nothing is refused.
 */

const money = (n: number) => `$${n.toFixed(2)}`;

describe("gcPrice", () => {
  it("with no adjustment the price IS the estimate total", () => {
    const priced = gcPrice(100000, null);
    expect(priced).toEqual({ ok: true, kind: "none", estimateCents: 10_000_000, adjustmentCents: 0, priceCents: 10_000_000 });
    expect(gcPrice(100000, { amount: null, percent: null })).toEqual(priced);
  });

  it("a dollar amount is added, and a negative one is a discount", () => {
    expect(gcPrice(100000, { amount: 1250.5 })).toMatchObject({ ok: true, adjustmentCents: 125050, priceCents: 10_125_050 });
    expect(gcPrice(100000, { amount: -2500 })).toMatchObject({ ok: true, adjustmentCents: -250000, priceCents: 9_750_000 });
  });

  it("a percent is of the ESTIMATE total, in whole cents, halves away from zero", () => {
    expect(gcPrice(100000, { percent: 4.5 })).toMatchObject({ adjustmentCents: 450000, priceCents: 10_450_000 });
    expect(gcPrice(100000, { percent: -3 })).toMatchObject({ adjustmentCents: -300000, priceCents: 9_700_000 });
    // 0.5 cent either side rounds AWAY from zero, so a +x% and a -x% are the same size.
    // $0.50 estimate, 1% = 0.5 cents.
    expect(gcPrice(0.5, { percent: 1 })).toMatchObject({ adjustmentCents: 1, priceCents: 51 });
    expect(gcPrice(0.5, { percent: -1 })).toMatchObject({ adjustmentCents: -1, priceCents: 49 });
  });

  it("float dust cannot move a price across a half cent", () => {
    // 1.005 * 100 is 100.49999999999999 in floating point.
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-1.005)).toBe(-101);
    expect(toThousandths(7.25)).toBe(7250);
    expect(percentOfCents(1_000_000, 7250)).toBe(72_500);
    // 8.35% of $19,999.99 = 1,669.99916...: 166,999.9..., rounds to 167,000 cents.
    expect(gcPrice(19999.99, { percent: 8.35 })).toMatchObject({ adjustmentCents: 167_000 });
  });

  it("the adjustment is deterministic arithmetic: price = estimate + adjustment, to the cent, over many totals", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 500; i += 1) {
      const total = Math.round(next() * 5_000_000_00) / 100;
      const percent = Math.round((next() * 40 - 20) * 100) / 100;
      const priced = gcPrice(total, { percent });
      if (!priced.ok) continue;
      expect(priced.priceCents).toBe(priced.estimateCents + priced.adjustmentCents);
      // Within half a cent of the exact percentage.
      const exact = (priced.estimateCents * percent) / 100;
      expect(Math.abs(priced.adjustmentCents - exact)).toBeLessThanOrEqual(0.5000001);
    }
  });

  it("refuses both an amount and a percent, a non-number, and more than 100% either way", () => {
    expect(gcPrice(1000, { amount: 5, percent: 5 })).toMatchObject({ ok: false });
    expect(gcPrice(1000, { amount: Number.NaN })).toMatchObject({ ok: false });
    expect(gcPrice(1000, { percent: 101 })).toMatchObject({ ok: false });
    expect(gcPrice(1000, { percent: -100.5 })).toMatchObject({ ok: false });
  });

  it("refuses an adjustment that leaves a price of zero or below, in words", () => {
    const gone = gcPrice(1000, { amount: -1000 });
    expect(gone).toMatchObject({ ok: false });
    if (!gone.ok) expect(gone.error).toMatch(/zero or below/);
    expect(gcPrice(1000, { amount: -5000 })).toMatchObject({ ok: false });
    expect(gcPrice(1000, { percent: -100 })).toMatchObject({ ok: false });
    // No adjustment on an estimate of nothing is just the state of an empty estimate.
    expect(gcPrice(0, null)).toMatchObject({ ok: true, priceCents: 0 });
  });
});

describe("parseGcAdjustment", () => {
  const parse = (kind: string, value: string, reason = "pays net 60") => parseGcAdjustment({ kind, value, reason });

  it("'none' clears everything, reason included", () => {
    expect(parse("none", "ignored", "ignored")).toEqual({ ok: true, amount: null, percent: null, reason: null });
    expect(parse("", "", "")).toEqual({ ok: true, amount: null, percent: null, reason: null });
  });

  it("reads signed money the way people type it", () => {
    expect(parse("amount", "-2,500")).toMatchObject({ ok: true, amount: -2500, percent: null });
    expect(parse("amount", "$1,200.50")).toMatchObject({ ok: true, amount: 1200.5 });
    expect(parse("amount", "(300)")).toMatchObject({ ok: true, amount: -300 });
    expect(parse("amount", "+75")).toMatchObject({ ok: true, amount: 75 });
  });

  it("reads a percent, with or without the sign", () => {
    expect(parse("percent", "4.5")).toMatchObject({ ok: true, percent: 4.5, amount: null });
    expect(parse("percent", "-3%")).toMatchObject({ ok: true, percent: -3 });
  });

  it("refuses, naming the field, what cannot be an adjustment", () => {
    expect(parse("amount", "abc")).toMatchObject({ ok: false, field: "value" });
    expect(parse("amount", "")).toMatchObject({ ok: false, field: "value" });
    expect(parse("percent", "1e3")).toMatchObject({ ok: false, field: "value" });
    expect(parse("percent", "150")).toMatchObject({ ok: false, field: "value" });
    expect(parse("amount", "0")).toMatchObject({ ok: false, field: "value" });
    expect(parse("amount", "999999999999")).toMatchObject({ ok: false, field: "value" });
    expect(parse("bogus", "5")).toMatchObject({ ok: false, field: "kind" });
  });

  it("an adjustment needs a reason, and a short one", () => {
    expect(parse("amount", "-100", "   ")).toMatchObject({ ok: false, field: "reason" });
    expect(parse("amount", "-100", "x".repeat(201))).toMatchObject({ ok: false, field: "reason" });
    expect(parse("amount", "-100", "x".repeat(200))).toMatchObject({ ok: true });
  });
});

describe("adjustmentLabel", () => {
  it("shows the adjustment as it was entered, with a real minus", () => {
    expect(adjustmentLabel({ amount: -2500 }, money)).toBe("−$2500.00");
    expect(adjustmentLabel({ amount: 100 }, money)).toBe("+$100.00");
    expect(adjustmentLabel({ percent: 4.5 }, money)).toBe("+4.5%");
    expect(adjustmentLabel({ percent: -3 }, money)).toBe("−3%");
    expect(adjustmentLabel(null, money)).toBeNull();
    expect(adjustmentLabel({ amount: null, percent: null }, money)).toBeNull();
  });
});

describe("projectGcPrices", () => {
  it("prices every GC off ONE estimate total, side by side", () => {
    const rows = projectGcPrices(200000, [
      { invitationId: "a", adjustment: null },
      { invitationId: "b", adjustment: { percent: -5 } },
      { invitationId: "c", adjustment: { amount: 1500 } },
    ]);
    expect(rows.map((r) => (r.ok ? r.price.priceCents : null))).toEqual([20_000_000, 19_000_000, 20_150_000]);
  });

  it("with no estimate there are no prices, not prices off zero", () => {
    expect(projectGcPrices(null, [{ invitationId: "a", adjustment: { amount: 100 } }])).toEqual([]);
  });

  it("one GC's bad adjustment is that row's problem and nobody else's", () => {
    const rows = projectGcPrices(1000, [
      { invitationId: "a", adjustment: { amount: -5000 } },
      { invitationId: "b", adjustment: null },
    ]);
    expect(rows[0]).toMatchObject({ invitationId: "a", ok: false });
    expect(rows[1]).toMatchObject({ invitationId: "b", ok: true });
  });

  it("editing the estimate moves every price with it (nothing is stored)", () => {
    const adjustments = [
      { invitationId: "a", adjustment: { percent: 10 } },
      { invitationId: "b", adjustment: { amount: -100 } },
    ];
    const before = projectGcPrices(1000, adjustments).map((r) => (r.ok ? r.price.priceCents : null));
    const after = projectGcPrices(2000, adjustments).map((r) => (r.ok ? r.price.priceCents : null));
    expect(before).toEqual([110_000, 90_000]);
    expect(after).toEqual([220_000, 190_000]);
  });
});
