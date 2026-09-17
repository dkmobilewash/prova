import { describe, expect, it } from "vitest";
import {
  lineTotal,
  orderTotal,
  unitSummary,
  unitTotals,
} from "./purchaseOrderTotals";

/**
 * What a purchase order adds up to, in dollars AND in units.
 *
 * The dollars half is the obvious one. The UNITS half is the half a
 * money-only total silently loses, and it is the half the customer actually
 * described: "Quiet Rock, 104 sheets at 32 square foot per sheet". The
 * person reading that order needs to know it is 104 sheets as much as they
 * need to know what 104 sheets costs — 104 sheets is what arrives on the
 * truck and what somebody counts at the gate.
 *
 * Every assertion here is written so that it CANNOT pass against the
 * arithmetic it is guarding against:
 *
 *   - a float multiply, which gives 0.30000000000000004 for 3 x 0.10;
 *   - summing the UNROUNDED line totals, which puts a total on screen that
 *     does not equal the column above it;
 *   - totalling quantities ACROSS units, which turns 104 sheets and 2,400
 *     linear feet into 2,504 of nothing.
 */

describe("a line's total is quantity x unit cost", () => {
  it("multiplies the two numbers on the line", () => {
    // The customer's own line: 104 sheets of Quiet Rock.
    expect(lineTotal({ quantity: 104, unitCost: 18.75 })).toBe(1950);
  });

  it("is exact in cents where a float multiply is not", () => {
    // 3 * 0.1 === 0.30000000000000004 in IEEE 754. A purchase order is a
    // document a vendor invoices against, so a cent of drift is a phone
    // call rather than a rounding curiosity.
    expect(3 * 0.1).not.toBe(0.3);
    expect(lineTotal({ quantity: 3, unitCost: 0.1 })).toBe(0.3);
  });

  it("holds at the hundredths both columns are stored at", () => {
    // Decimal(12, 2) on both operands, so this is lossless rather than an
    // approximation: 12.5 * 3.33 = 41.625, which lands on 41.63.
    expect(lineTotal({ quantity: 12.5, unitCost: 3.33 })).toBe(41.63);
    expect(lineTotal({ quantity: 0, unitCost: 99.99 })).toBe(0);
    expect(lineTotal({ quantity: 1, unitCost: 0 })).toBe(0);
  });

  it("scales to an order somebody would really raise", () => {
    expect(lineTotal({ quantity: 2400, unitCost: 1.07 })).toBe(2568);
  });
});

describe("the order total is the sum of the line totals", () => {
  const lines = [
    { quantity: 104, unit: "sheets", unitCost: 18.75 }, // 1950.00
    { quantity: 2400, unit: "LF", unitCost: 1.07 }, //    2568.00
    { quantity: 12.5, unit: "EA", unitCost: 3.33 }, //      41.63
  ];

  it("adds up the figures that are on screen", () => {
    expect(orderTotal(lines)).toBe(4559.63);
  });

  it("equals the visible column rather than a more precise invisible one", () => {
    // Summing UNROUNDED products would give 4559.625 here. The total on a
    // purchase order is the number somebody checks with a calculator
    // against the column above it, so it has to be that column's sum.
    const visible = lines.reduce((sum, line) => sum + lineTotal(line), 0);
    expect(orderTotal(lines)).toBe(Math.round(visible * 100) / 100);
    expect(orderTotal(lines)).not.toBe(4559.625);
  });

  it("is zero for an order with no lines, not NaN", () => {
    expect(orderTotal([])).toBe(0);
  });
});

describe("the units total too, and never across units", () => {
  it("totals each unit separately", () => {
    const totals = unitTotals([
      { quantity: 104, unit: "sheets", unitCost: 18.75 },
      { quantity: 2400, unit: "LF", unitCost: 1.07 },
    ]);
    expect(totals).toEqual([
      { unit: "sheets", quantity: 104 },
      { unit: "LF", quantity: 2400 },
    ]);
  });

  it("never adds one unit to another", () => {
    // 104 sheets + 2,400 LF is not 2,504 of anything. The guard is that no
    // entry anywhere in the result carries the combined figure.
    const totals = unitTotals([
      { quantity: 104, unit: "sheets", unitCost: 18.75 },
      { quantity: 2400, unit: "LF", unitCost: 1.07 },
    ]);
    expect(totals).toHaveLength(2);
    expect(totals.map((t) => t.quantity)).not.toContain(2504);
  });

  it("adds two lines that really are the same unit", () => {
    expect(
      unitTotals([
        { quantity: 104, unit: "sheets", unitCost: 18.75 },
        { quantity: 36, unit: "sheets", unitCost: 21.4 },
      ]),
    ).toEqual([{ unit: "sheets", quantity: 140 }]);
  });

  it("groups case- and space-insensitively but shows the first spelling", () => {
    // It is their document; normalising their words on screen is a
    // correction nobody asked for.
    expect(
      unitTotals([
        { quantity: 10, unit: "Sheets", unitCost: 1 },
        { quantity: 5, unit: "sheets", unitCost: 1 },
        { quantity: 2, unit: " SHEETS ", unitCost: 1 },
      ]),
    ).toEqual([{ unit: "Sheets", quantity: 17 }]);
  });

  it("leaves a lump-sum line out rather than bucketing it under an empty label", () => {
    expect(
      unitTotals([
        { quantity: 1, unit: null, unitCost: 4500 },
        { quantity: 104, unit: "sheets", unitCost: 18.75 },
        { quantity: 1, unit: "   ", unitCost: 900 },
      ]),
    ).toEqual([{ unit: "sheets", quantity: 104 }]);
  });

  it("keeps fractional quantities exact", () => {
    expect(
      unitTotals([
        { quantity: 0.1, unit: "TON", unitCost: 100 },
        { quantity: 0.2, unit: "TON", unitCost: 100 },
      ]),
    ).toEqual([{ unit: "TON", quantity: 0.3 }]);
  });
});

describe("the one-line unit summary", () => {
  it("reads the way somebody would say it out loud", () => {
    expect(
      unitSummary([
        { quantity: 104, unit: "sheets", unitCost: 18.75 },
        { quantity: 2400, unit: "LF", unitCost: 1.07 },
      ]),
    ).toBe("104 sheets · 2,400 LF");
  });

  it("is null when nothing on the order carries a unit", () => {
    expect(unitSummary([{ quantity: 1, unit: null, unitCost: 4500 }])).toBeNull();
    expect(unitSummary([])).toBeNull();
  });
});
