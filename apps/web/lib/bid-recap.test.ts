import { describe, expect, it } from "vitest";
import {
  bidRecap,
  directCostByCategory,
  spreadToLines,
  spreadTotal,
  type RecapLine,
  type RecapRates,
} from "./bid-recap";

/**
 * A line, defaulting to "no cost and no price".
 *
 * `unitCost` IS THE FIGURE THE RECAP MARKS UP (#512). Every fixture below that
 * used to say `unitPrice: N` now says `unitCost: N`, and not one hand-derived
 * figure in this file moved — which is the clearest statement of what #512 was:
 * the arithmetic was always right, it was reading the wrong column. The worked
 * example was "$2,000 of material" all along; it just happened to be $2,000 of
 * SALE PRICE being marked up as though it were cost.
 *
 * `unitPrice` defaults to 0 rather than null so these lines stay BILLABLE, which
 * is what makes them eligible for the spread. A fixture that wants a cost-only
 * line sets `unitPrice: null` explicitly.
 */
const line = (over: Partial<RecapLine> & Pick<RecapLine, "id">): RecapLine => ({
  quantity: 1,
  unitCost: 0,
  unitPrice: 0,
  costCategory: null,
  ...over,
});

/** $2,000 of material and $1,000 of labor COST — the worked example every figure
 * below is derived from by hand. */
const LINES: RecapLine[] = [
  line({ id: "board", quantity: 1000, unitCost: 2, costCategory: "MATERIAL" }),
  line({ id: "hang", quantity: 100, unitCost: 10, costCategory: "LABOR" }),
];

const amountOf = (recap: ReturnType<typeof bidRecap>, key: string) =>
  recap.steps.find((step) => step.key === key)?.amount ?? null;

describe("direct cost by cost type", () => {
  it("totals each type, and counts a line with no type separately", () => {
    const direct = directCostByCategory([
      ...LINES,
      line({ id: "sub", quantity: 1, unitCost: 500, costCategory: "SUBCONTRACTOR" }),
      line({ id: "unknown", quantity: 1, unitCost: 250 }),
    ]);
    // `toEqual` on the whole object rather than key-by-key, deliberately: a
    // category the accumulator has stopped initialising shows up here as a
    // missing key, and a missing key is what turned EQUIPMENT into a NaN bid.
    expect(direct.byCategory).toEqual({
      MATERIAL: 2000,
      LABOR: 1000,
      SUBCONTRACTOR: 500,
      EQUIPMENT: 0,
      OTHER: 0,
    });
    expect(direct.uncategorised).toBe(250);
    expect(direct.uncategorisedLineCount).toBe(1);
    expect(direct.total).toBe(3750);
  });

  it("counts a line with neither a cost nor a price as $0, still reporting it as uncoded", () => {
    // Renamed at #512: this used to be called "a cost-only line", which it was
    // when `unitPrice` WAS the cost. It has no cost now, so it is the
    // nothing-recorded case — a takeoff line, which arrives with both columns
    // empty. The real cost-only line has its own test below.
    const direct = directCostByCategory([line({ id: "gc", quantity: 1, unitPrice: null })]);
    expect(direct.total).toBe(0);
    expect(direct.uncategorisedLineCount).toBe(1);
    expect(direct.pricedWithNoCostLineCount).toBe(0);
  });

  it("puts a genuine COST-ONLY line into the cost base — general conditions are real money", () => {
    // Cost set, no sale price. New behaviour: before #512 such a line
    // contributed $0, because the only figure being summed was the price it
    // does not have. It is a cost you incur, so the bid has to carry it.
    const direct = directCostByCategory([
      line({ id: "gc", quantity: 1, unitCost: 4000, unitPrice: null, costCategory: "OTHER" }),
    ]);
    expect(direct.byCategory.OTHER).toBe(4000);
    expect(direct.total).toBe(4000);
    expect(direct.pricedWithNoCostLineCount).toBe(0);
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
    const laborOnly = [line({ id: "hang", quantity: 100, unitCost: 10, costCategory: "LABOR" })];
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
    const withUncoded = [...LINES, line({ id: "unknown", quantity: 1, unitCost: 1000 })];
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
      line({ id: "a", quantity: 1, unitCost: 1 }),
      line({ id: "b", quantity: 1, unitCost: 1 }),
      line({ id: "c", quantity: 1, unitCost: 1 }),
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

  it("leaves an unpriced line unpriced rather than selling general conditions", () => {
    const withCostOnly = [...LINES, line({ id: "gc", quantity: 1, unitPrice: null })];
    const spread = spreadToLines(withCostOnly, 3996.6);
    expect(spread.map((s) => s.id).sort()).toEqual(["board", "hang"]);
  });

  it("carries a cost-only line's COST into the bid and still pays it nothing back", () => {
    // The mirror of the rule above, and the case that changed at #512. General
    // conditions cost real money and are recovered through the billable lines —
    // so the line is in the cost base, gets marked up, and receives no share of
    // the spread, because giving it a unit price would make it look sold.
    const withGc = [
      ...LINES,
      line({ id: "gc", quantity: 1, unitCost: 500, unitPrice: null, costCategory: "OTHER" }),
    ];
    expect(directCostByCategory(withGc).total).toBe(3500);

    const spread = spreadToLines(withGc, 3500);
    expect(spread.map((s) => s.id).sort()).toEqual(["board", "hang"]);

    // Its $500 of cost is recovered by the two billable lines: $3,500 of bid is
    // spread across lines that only carry $3,000 of cost between them, so each
    // is raised past its own cost to carry the general conditions too.
    //
    // 3,497 and not 3,500, and that is the documented rounding rather than a
    // slip: a 1,000-unit line's unit price holds two decimals, so its smallest
    // possible step is $10. `spreadTotal` is what reports this, and the screen
    // shows it whenever it differs from the bid — asserted exactly here rather
    // than with a tolerance, because a tolerance would hide the very gap this
    // function exists to surface.
    expect(spreadTotal(withGc, spread)).toBe(3497);
  });

  it("reports the real total when a unit price cannot hold the exact share", () => {
    // 3 units at 1.00 taking a 10.00 bid: 3.3333.. per unit, stored as 3.33,
    // so the honest total is 9.99 and the screen must say so rather than 10.
    const awkward = [line({ id: "a", quantity: 3, unitCost: 1 })];
    const spread = spreadToLines(awkward, 10);
    expect(spread[0].unitPrice).toBe("3.33");
    expect(spreadTotal(awkward, spread)).toBe(9.99);
  });

  it("produces nothing to spread when the job has no priced line", () => {
    expect(spreadToLines([line({ id: "gc", quantity: 1, unitPrice: null })], 500)).toEqual([]);
  });
});

/**
 * #512 — THE DOUBLE MARKUP, AS A NUMBER.
 *
 * The bug this file's fixtures could not see, because every one of them carried
 * a single figure that was read as cost. A real catalog entry carries TWO:
 * `defaultUnitPrice 2.85` and `defaultBudgetedUnitCost 1.90`, and
 * `catalogLineFields` puts the price in `unitPrice` and the cost in
 * `budgetedUnitCost`. The recap marked up the price.
 *
 * The figures here are the issue's own click-through, so a person can reproduce
 * them on screen: 100 SF, material markup 15%, overhead 10%, profit 10%.
 */
describe("#512: the recap marks up cost, not the sale price", () => {
  const CATALOG_LINE = line({
    id: "board",
    quantity: 100,
    unitCost: 1.9,
    unitPrice: 2.85,
    costCategory: "MATERIAL",
  });
  const RATES: RecapRates = { materialMarkupPercent: 15, overheadPercent: 10, profitPercent: 10 };

  it("builds from $190 of cost, not $285 of price", () => {
    const direct = directCostByCategory([CATALOG_LINE]);
    expect(direct.byCategory.MATERIAL).toBe(190);
    expect(direct.total).toBe(190);
    // The number the recap used to start from. Asserted by value so the wrong
    // answer is visible in the file rather than merely absent.
    expect(direct.total).not.toBe(285);
  });

  it("lands near $264 rather than near $397 — the margin is not charged twice", () => {
    const recap = bidRecap([CATALOG_LINE], RATES);
    // 190 → +15% material = 218.50 → +10% overhead = 240.35 → +10% profit on
    // that = 264.39. Every step is checked by the tests above; this pins the end.
    expect(recap.bidTotal).toBeCloseTo(264.39, 2);

    // What it was: 285 marked up the same way. The $2.85 already carried the
    // margin, so this was a second one on top — a bid a sub loses.
    // 285 → +15% = 327.75 → +10% overhead = 360.53 → +10% profit = 396.58.
    // (396.58, not the 396.59 an unrounded calculation gives: the module rounds
    // each step, which is what the screen shows.)
    const doubled = bidRecap([{ ...CATALOG_LINE, unitCost: 2.85 }], RATES);
    expect(doubled.bidTotal).toBeCloseTo(396.58, 2);
    expect(recap.bidTotal).toBeLessThan(doubled.bidTotal);
  });

  it("still sells it for more than it costs, which is the point of the layer", () => {
    const recap = bidRecap([CATALOG_LINE], RATES);
    expect(recap.bidTotal).toBeGreaterThan(190);
  });
});

/**
 * A LINE WITH A PRICE AND NO COST — reported, never guessed at.
 *
 * Not an edge case: the bid wizard's add-a-line form collected no cost at all
 * until #512, an AI-drafted line falls back to the model's price with no cost,
 * and a QuickBooks service item routinely carries a sales price and none. The
 * rule is the one this module already applies to an uncategorised line — name
 * it on screen, mark it up at nothing — and NOT the one that would look
 * helpful, which is to read the price as the cost.
 */
describe("#512: a line with a price and no cost", () => {
  const PRICED_NO_COST = line({
    id: "mystery",
    quantity: 100,
    unitCost: null,
    unitPrice: 4,
    costCategory: "MATERIAL",
  });

  it("is counted and totalled at its PRICE, and kept out of the cost base", () => {
    const direct = directCostByCategory([...LINES, PRICED_NO_COST]);
    expect(direct.pricedWithNoCostLineCount).toBe(1);
    expect(direct.pricedWithNoCost).toBe(400);
    // The cost base is untouched by it — still the worked example's $3,000.
    expect(direct.total).toBe(3000);
    expect(direct.byCategory.MATERIAL).toBe(2000);
  });

  it("is NOT read as $400 of cost, which is the fallback that would restore the bug", () => {
    const withIt = bidRecap([...LINES, PRICED_NO_COST], { materialMarkupPercent: 15 });
    const withoutIt = bidRecap(LINES, { materialMarkupPercent: 15 });
    expect(withIt.bidTotal).toBe(withoutIt.bidTotal);
  });

  it("is not reported as merely uncoded — it has a cost type, it has no cost", () => {
    const direct = directCostByCategory([PRICED_NO_COST]);
    expect(direct.uncategorisedLineCount).toBe(0);
    expect(direct.pricedWithNoCostLineCount).toBe(1);
  });

  it("is reported even when it has no cost type either, and only once", () => {
    const direct = directCostByCategory([{ ...PRICED_NO_COST, costCategory: null }]);
    expect(direct.pricedWithNoCostLineCount).toBe(1);
    // Missing the cost is the bigger problem and the one that is named. Counting
    // it in both buckets would double-report one line in two warnings.
    expect(direct.uncategorisedLineCount).toBe(0);
  });

  it("gets no share of the spread, so applying cannot WIPE the price it has", () => {
    // The destructive case. With no cost it has no share; a share of $0 written
    // back as a unit price would set this line to 0.00 and delete a figure
    // somebody typed.
    const spread = spreadToLines([...LINES, PRICED_NO_COST], 3996.6);
    expect(spread.map((s) => s.id)).not.toContain("mystery");
  });

  it("keeps its price in what the spread REALLY comes to", () => {
    // spreadTotal is the honest-total figure on screen. This line is not paid by
    // the spread, so what it contributes is the $400 of price it already had —
    // which is how the gap between the bid and the line total becomes visible
    // without a second warning.
    const lines = [...LINES, PRICED_NO_COST];
    const spread = spreadToLines(lines, 3000);
    expect(spreadTotal(lines, spread)).toBeCloseTo(3400, 1);
  });
});

/**
 * THE WIZARD-BUILT JOB: every line priced, none costed.
 *
 * What a contractor onboarded through the bid wizard actually had before #512
 * added a cost box to it. The recap reads $0 direct cost and says so on every
 * line, rather than inventing a cost base from the prices — and no backfill was
 * run, because a migration setting cost = price would write a 0%-margin figure
 * nobody typed.
 */
describe("#512: a job with prices and no costs at all", () => {
  const WIZARD_JOB: RecapLine[] = [
    line({ id: "a", quantity: 100, unitCost: null, unitPrice: 12, costCategory: "MATERIAL" }),
    line({ id: "b", quantity: 40, unitCost: null, unitPrice: 30, costCategory: "LABOR" }),
  ];

  it("reads $0 direct cost and names every line", () => {
    const direct = directCostByCategory(WIZARD_JOB);
    expect(direct.total).toBe(0);
    expect(direct.pricedWithNoCostLineCount).toBe(2);
    expect(direct.pricedWithNoCost).toBe(2400);
  });

  it("produces a $0 bid rather than a plausible wrong one", () => {
    const recap = bidRecap(WIZARD_JOB, { materialMarkupPercent: 15, overheadPercent: 10, profitPercent: 10 });
    expect(recap.bidTotal).toBe(0);
    expect(recap.addedTotal).toBe(0);
  });

  it("spreads nothing, so no price on the job is touched", () => {
    expect(spreadToLines(WIZARD_JOB, 0)).toEqual([]);
  });
});
