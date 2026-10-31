import { describe, expect, it } from "vitest";
import { applyOutcome, applyPlan, bidRecap, spreadTotal, type RecapLine, type RecapRates } from "./bid-recap";

/**
 * THE CONTRACTOR WALK'S RECAP, figure for figure (`e2e/specs/bid-contractor-walk.spec.ts`,
 * step 6). The walk printed three numbers that read as three different bids:
 *
 *   - the line prices the sub typed:        $34,915.00
 *   - the recap's "Bid total":              $31,917.00
 *   - "Apply to line prices to make it":    $31,990.50 — and after Apply the
 *     proposal printed $31,990.50.
 *
 * And the guide's apply-recap ask said "Applying it adds $7,385.00 to the bid",
 * which is none of the three differences: it is the markup over DIRECT COST
 * ($31,917.00 − $24,532.00). Pressing Apply LOWERED the bid by $2,924.50.
 *
 * This file pins the cause of the $73.50 gap and the one function every
 * surface must now read "what Apply produces" from.
 */

/** The walk's three hand-typed lines, with the cost types it set on the recap. */
const LINES: RecapLine[] = [
  { id: "frame", quantity: 1250, unitCost: 6.8, unitPrice: 9.5, costCategory: "LABOR" },
  { id: "board", quantity: 9600, unitCost: 0.62, unitPrice: 0.95, costCategory: "MATERIAL" },
  { id: "finish", quantity: 9600, unitCost: 1.05, unitPrice: 1.45, costCategory: "LABOR" },
];

const RATES: RecapRates = {
  laborMarkupPercent: 10,
  materialMarkupPercent: 8,
  overheadPercent: 10,
  profitPercent: 8,
};

const lineTotal = (lines: readonly RecapLine[]) =>
  Math.round(lines.reduce((sum, line) => sum + line.quantity * (line.unitPrice ?? 0), 0) * 100) / 100;

describe("the walk's recap — what each figure on the screen was", () => {
  it("the typed line prices come to $34,915.00", () => {
    expect(lineTotal(LINES)).toBe(34_915);
  });

  it("the recap's bid total is $31,917.00, and $7,385.00 of it is markup over the $24,532.00 direct cost", () => {
    const recap = bidRecap(LINES, RATES);
    expect(recap.direct.total).toBe(24_532);
    expect(recap.bidTotal).toBe(31_917);
    // The figure the ask used to call "adds … to the bid". It is what the RATES
    // add to COST, not what pressing Apply does to the bid on the lines.
    expect(recap.addedTotal).toBe(7_385);
  });

  it("Apply writes lines that total $31,990.50 — a $2,924.50 CUT from the typed prices, not a $7,385.00 rise", () => {
    const outcome = applyOutcome(LINES, RATES);
    expect(outcome.landsAt).toBe(31_990.5);
    expect(Math.round((outcome.landsAt! - lineTotal(LINES)) * 100) / 100).toBe(-2_924.5);
  });
});

describe("the $73.50 between the recap's $31,917.00 and Apply's $31,990.50 — the cause, established", () => {
  const recap = bidRecap(LINES, RATES);
  const plan = applyPlan(LINES, recap.bidTotal);
  const spread = plan.kind === "PRICED" ? plan.spread : [];

  it("the spread's line TOTALS are exact to the cent; the stored UNIT PRICES are rounded to cents", () => {
    // Each line's share of $31,917.00 by cost, and the unit price that share
    // needs — more decimals than `JobLineItem.unitPrice` (Decimal(12, 2)) holds.
    const share = (id: string) => {
      const line = LINES.find((l) => l.id === id)!;
      return (line.quantity * line.unitCost! * recap.bidTotal) / recap.direct.total;
    };
    expect(share("frame") / 1250).toBeCloseTo(8.847, 3);
    expect(share("board") / 9600).toBeCloseTo(0.80664, 5);
    expect(share("finish") / 9600).toBeCloseTo(1.36609, 5);
    // What is written: each rounded to the cent.
    expect(spread).toEqual([
      { id: "frame", unitPrice: "8.85" },
      { id: "board", unitPrice: "0.81" },
      { id: "finish", unitPrice: "1.37" },
    ]);
  });

  it("the rounding is multiplied by the quantity: +$3.70, +$32.24 and +$37.56 is the $73.50", () => {
    const drift = (id: string, quantity: number, unitCost: number) => {
      const exact = (quantity * unitCost * recap.bidTotal) / recap.direct.total;
      const written = Number(spread.find((s) => s.id === id)!.unitPrice) * quantity;
      return written - exact;
    };
    expect(drift("frame", 1250, 6.8)).toBeCloseTo(3.7, 2);
    expect(drift("board", 9600, 0.62)).toBeCloseTo(32.24, 2);
    expect(drift("finish", 9600, 1.05)).toBeCloseTo(37.56, 2);
    expect(spreadTotal(LINES, spread) - recap.bidTotal).toBeCloseTo(73.5, 2);
  });

  it("NO choice of cent unit prices near each line's share lands on $31,917.00 — exact is not reachable with a 2-decimal unit price", () => {
    // Every combination of the cent below and the cent above each line's
    // ideal unit price. On 9,600 SF one cent of unit price is $96 of line
    // total, so the reachable totals sit $12.50-$96 apart and none is the bid.
    const ideal = LINES.map((line) => (line.unitCost! * recap.bidTotal) / recap.direct.total);
    const totals: number[] = [];
    for (const a of [Math.floor(ideal[0]! * 100), Math.ceil(ideal[0]! * 100)])
      for (const b of [Math.floor(ideal[1]! * 100), Math.ceil(ideal[1]! * 100)])
        for (const c of [Math.floor(ideal[2]! * 100), Math.ceil(ideal[2]! * 100)])
          totals.push((1250 * a + 9600 * b + 9600 * c) / 100);
    expect(totals).not.toContain(recap.bidTotal);
    // The nearest a cent-priced spread can get, either side.
    const below = Math.max(...totals.filter((t) => t < recap.bidTotal));
    const above = Math.min(...totals.filter((t) => t > recap.bidTotal));
    expect(below).toBe(31_894.5);
    expect(above).toBe(31_978);
  });
});

describe("applyOutcome — the ONE answer to 'what will Apply produce'", () => {
  it("is the figure the action writes: applyPlan's spread, summed by spreadTotal", () => {
    const outcome = applyOutcome(LINES, RATES);
    const recap = bidRecap(LINES, RATES);
    const plan = applyPlan(LINES, recap.bidTotal);
    expect(outcome.recap).toEqual(recap);
    expect(outcome.plan).toEqual(plan);
    expect(outcome.landsAt).toBe(spreadTotal(LINES, plan.kind === "NOTHING" ? [] : plan.spread));
  });

  it("is null when Apply would write nothing, so nobody is promised a figure Apply refuses to produce", () => {
    const costOnly: RecapLine[] = [{ id: "gc", quantity: 1, unitCost: 500, unitPrice: null, costCategory: "OTHER" }];
    const priceOnly: RecapLine[] = [{ id: "p", quantity: 10, unitCost: null, unitPrice: 5, costCategory: "LABOR" }];
    expect(applyOutcome(priceOnly, RATES).plan.kind).toBe("NOTHING");
    expect(applyOutcome(priceOnly, RATES).landsAt).toBeNull();
    // Cost-only and nothing priced: Apply OFFERS to price it, so there is a figure.
    expect(applyOutcome(costOnly, { otherMarkupPercent: 10 }).plan.kind).toBe("PRICE_UNPRICED");
    expect(applyOutcome(costOnly, { otherMarkupPercent: 10 }).landsAt).toBe(550);
  });
});
