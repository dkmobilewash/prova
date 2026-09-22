import { describe, expect, it } from "vitest";
import {
  bidRecap,
  directCostByCategory,
  spreadToLines,
  spreadTotal,
  type RecapLine,
  type RecapRates,
} from "./bid-recap";

const line = (over: Partial<RecapLine> & Pick<RecapLine, "id">): RecapLine => ({
  quantity: 1,
  unitPrice: 0,
  costCategory: null,
  ...over,
});

/** $2,000 of material and $1,000 of labor — the worked example every figure
 * below is derived from by hand. */
const LINES: RecapLine[] = [
  line({ id: "board", quantity: 1000, unitPrice: 2, costCategory: "MATERIAL" }),
  line({ id: "hang", quantity: 100, unitPrice: 10, costCategory: "LABOR" }),
];

const amountOf = (recap: ReturnType<typeof bidRecap>, key: string) =>
  recap.steps.find((step) => step.key === key)?.amount ?? null;

describe("direct cost by cost type", () => {
  it("totals each type, and counts a line with no type separately", () => {
    const direct = directCostByCategory([
      ...LINES,
      line({ id: "sub", quantity: 1, unitPrice: 500, costCategory: "SUBCONTRACTOR" }),
      line({ id: "unknown", quantity: 1, unitPrice: 250 }),
    ]);
    expect(direct.byCategory).toEqual({ MATERIAL: 2000, LABOR: 1000, SUBCONTRACTOR: 500, OTHER: 0 });
    expect(direct.uncategorised).toBe(250);
    expect(direct.uncategorisedLineCount).toBe(1);
    expect(direct.total).toBe(3750);
  });

  it("counts a cost-only line as $0 but still reports it as uncoded", () => {
    const direct = directCostByCategory([line({ id: "gc", quantity: 1, unitPrice: null })]);
    expect(direct.total).toBe(0);
    expect(direct.uncategorisedLineCount).toBe(1);
  });
});

describe("the bid recap, step by step", () => {
  // Worked by hand:
  //   direct            3000.00   (2000 material + 1000 labor)
  //   material 10%      + 200.00  -> 3200.00   (material sold 2200)
  //   labor 5%          +  50.00  -> 3250.00
  //   tax 8% on 2200    + 176.00  -> 3426.00
  //   overhead 10%      + 342.60  -> 3768.60
  //   profit 5%         + 188.43  -> 3957.03   (ON overhead, not before it)
  //   bond 1%           +  39.57  -> 3996.60
  const RATES: RecapRates = {
    materialMarkupPercent: 10,
    laborMarkupPercent: 5,
    materialTaxPercent: 8,
    overheadPercent: 10,
    profitPercent: 5,
    bondPercent: 1,
  };

  it("adds up to the bid total, in the documented order", () => {
    const recap = bidRecap(LINES, RATES);
    expect(recap.direct.total).toBe(3000);
    expect(amountOf(recap, "markup:MATERIAL")).toBe(200);
    expect(amountOf(recap, "markup:LABOR")).toBe(50);
    expect(amountOf(recap, "materialTax")).toBe(176);
    expect(amountOf(recap, "overhead")).toBe(342.6);
    expect(amountOf(recap, "profit")).toBe(188.43);
    expect(amountOf(recap, "bond")).toBe(39.57);
    expect(recap.bidTotal).toBe(3996.6);
    expect(recap.addedTotal).toBe(996.6);
  });

  it("computes profit ON overhead — the order that earns what the rate says", () => {
    // If profit were taken before overhead it would be 5% of 3426 = 171.30.
    const recap = bidRecap(LINES, RATES);
    expect(amountOf(recap, "profit")).toBe(188.43);
    expect(amountOf(recap, "profit")).not.toBe(171.3);
    // And each step's runningTotal is the sum after it, in order.
    const totals = recap.steps.map((step) => step.runningTotal);
    expect(totals).toEqual([3200, 3250, 3426, 3768.6, 3957.03, 3996.6]);
  });

  it("taxes the material only, at what the material is SOLD for", () => {
    // Tax on marked-up material (2200), not on raw material (2000 -> 160),
    // and not on the whole job (3250 -> 260).
    expect(amountOf(bidRecap(LINES, { materialMarkupPercent: 10, materialTaxPercent: 8 }), "materialTax")).toBe(176);
    // No material on the job: nothing to tax, even at 8%.
    const laborOnly = [line({ id: "hang", quantity: 100, unitPrice: 10, costCategory: "LABOR" })];
    expect(amountOf(bidRecap(laborOnly, { materialTaxPercent: 8 }), "materialTax")).toBeNull();
  });

  it("escalates the base the tax is charged on, so the two cannot disagree", () => {
    // Direct 3000 + 10% material markup = 3200 (no labor markup in this case).
    // Material 2000 +10% = 2200, escalated 10% = 2420, taxed 8% = 193.60.
    const recap = bidRecap(LINES, { materialMarkupPercent: 10, escalationPercent: 10, materialTaxPercent: 8 });
    expect(amountOf(recap, "escalation")).toBe(320); // 10% of 3200
    expect(amountOf(recap, "materialTax")).toBe(193.6);
  });

  it("changes nothing when no rate is set", () => {
    const recap = bidRecap(LINES, {});
    expect(recap.bidTotal).toBe(3000);
    expect(recap.addedTotal).toBe(0);
    expect(recap.steps).toEqual([]);
  });

  it("never marks up a line that has no cost type", () => {
    const withUncoded = [...LINES, line({ id: "unknown", quantity: 1, unitPrice: 1000 })];
    const recap = bidRecap(withUncoded, { materialMarkupPercent: 10, laborMarkupPercent: 5 });
    // The $1,000 is in the direct total but earns no markup of its own.
    expect(recap.direct.total).toBe(4000);
    expect(amountOf(recap, "markup:MATERIAL")).toBe(200);
    expect(recap.bidTotal).toBe(4250);
    expect(recap.direct.uncategorisedLineCount).toBe(1);
  });
});

describe("spreading the bid back onto the lines", () => {
  it("puts the odd cents where they are owed, so unit-quantity lines land exactly", () => {
    // Three $1 lines splitting $100: 33.33 + 33.33 + 33.34.
    const thirds = [
      line({ id: "a", quantity: 1, unitPrice: 1 }),
      line({ id: "b", quantity: 1, unitPrice: 1 }),
      line({ id: "c", quantity: 1, unitPrice: 1 }),
    ];
    const spread = spreadToLines(thirds, 100);
    const cents = spread.map((s) => Math.round(Number(s.unitPrice) * 100));
    expect(cents.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(cents.sort()).toEqual([3333, 3333, 3334]);
  });

  it("keeps each line's share of the job, to the nearest storable unit price", () => {
    // 2000 : 1000 of a 3996.60 bid = 2664.40 : 1332.20, i.e. 2.6644 and
    // 13.322 per unit. A unit price holds two decimals, so those store as 2.66
    // and 13.32 — the closest price to each share, which is all a stored unit
    // price can be.
    const spread = spreadToLines(LINES, 3996.6);
    const byId = Object.fromEntries(spread.map((s) => [s.id, s.unitPrice]));
    expect(byId.board).toBe("2.66");
    expect(byId.hang).toBe("13.32");
  });

  it("REPORTS the total those prices really come to, rather than the bid", () => {
    // 2.66 x 1000 + 13.32 x 100 = 2660 + 1332 = 3992.00 against a 3996.60 bid.
    // On a 1,000-unit line one cent of unit price is ten dollars of line, so an
    // exact landing is not available — and the screen shows this figure beside
    // the bid instead of claiming the bid was written.
    const spread = spreadToLines(LINES, 3996.6);
    expect(spreadTotal(LINES, spread)).toBe(3992);
    expect(spreadTotal(LINES, spread)).not.toBe(3996.6);
  });

  it("leaves a cost-only line unpriced rather than selling general conditions", () => {
    const withCostOnly = [...LINES, line({ id: "gc", quantity: 1, unitPrice: null })];
    const spread = spreadToLines(withCostOnly, 3996.6);
    expect(spread.map((s) => s.id).sort()).toEqual(["board", "hang"]);
  });

  it("reports the real total when a unit price cannot hold the exact share", () => {
    // 3 units at 1.00 taking a 10.00 bid: 3.3333.. per unit, stored as 3.33,
    // so the honest total is 9.99 and the screen must say so rather than 10.
    const awkward = [line({ id: "a", quantity: 3, unitPrice: 1 })];
    const spread = spreadToLines(awkward, 10);
    expect(spread[0].unitPrice).toBe("3.33");
    expect(spreadTotal(awkward, spread)).toBe(9.99);
  });

  it("produces nothing to spread when the job has no priced line", () => {
    expect(spreadToLines([line({ id: "gc", quantity: 1, unitPrice: null })], 500)).toEqual([]);
  });
});
