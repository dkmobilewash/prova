import { describe, expect, it } from "vitest";
import { changesByType, gcSummary, sumRows, type ItemFacts } from "./addendumChanges";

const items = new Map<string, ItemFacts>([
  // S6A: 200 ft on the job priced at $4,000 → $20 a foot; 15 ft high, both faces.
  ["s6a", { id: "s6a", code: "S6A", name: "S6A walls", heightFt: 15, sides: 2, jobFeet: 200, jobDollars: 4000 }],
  // C8B: no priced lines yet.
  ["c8b", { id: "c8b", code: "C8B", name: "C8B walls", heightFt: 15, sides: 2, jobFeet: 100, jobDollars: null }],
]);
const old = (itemId: string, x1: number, y: number, x2: number, feet: number) => ({ itemId, xs: [x1, x2], ys: [y, y], feet });
const run = (x1: number, y: number, x2: number, feet: number) => ({ x1, y1: y, x2, y2: y, feet });

describe("changesByType", () => {
  it("a wall the revision kept carries its type and changes nothing", () => {
    const { rows, matched } = changesByType({ olds: [old("s6a", 0.1, 0.2, 0.4, 30)], news: [run(0.1, 0.2, 0.4, 30)], items });
    expect(matched).toBe(1);
    expect(rows).toEqual([{ itemId: "s6a", code: "S6A", name: "S6A walls", oldFt: 30, newFt: 30, deltaFt: 0, deltaSqFt: 0, deltaDollars: 0 }]);
  });

  it("a wall gone is its type's footage, area and price taken off; a new wall is untyped, with no price", () => {
    const { rows, matched } = changesByType({ olds: [old("s6a", 0.1, 0.2, 0.4, 30), old("s6a", 0.1, 0.5, 0.3, 20)], news: [run(0.1, 0.2, 0.4, 30), run(0.6, 0.6, 0.8, 12)], items });
    expect(matched).toBe(1);
    expect(rows.find((r) => r.itemId === "s6a")).toMatchObject({ oldFt: 50, newFt: 30, deltaFt: -20, deltaSqFt: -600, deltaDollars: -400 });
    expect(rows.find((r) => r.itemId === null)).toMatchObject({ name: "New walls, no type yet", oldFt: 0, newFt: 12, deltaFt: 12, deltaSqFt: null, deltaDollars: null });
  });

  it("a type with no priced lines has area but no $", () => {
    const { rows } = changesByType({ olds: [old("c8b", 0.1, 0.2, 0.4, 30)], news: [], items });
    expect(rows).toEqual([{ itemId: "c8b", code: "C8B", name: "C8B walls", oldFt: 30, newFt: 0, deltaFt: -30, deltaSqFt: -900, deltaDollars: null }]);
  });

  it("a revised run a hair off its earlier twin is the same wall", () => {
    expect(changesByType({ olds: [old("s6a", 0.1, 0.2, 0.4, 30)], news: [run(0.1003, 0.2002, 0.3998, 30)], items }).matched).toBe(1);
  });
});

describe("sumRows", () => {
  it("adds the sheets' rows by item, typed by code, new walls last", () => {
    const a = changesByType({ olds: [old("s6a", 0.1, 0.2, 0.4, 30)], news: [run(0.6, 0.6, 0.8, 12)], items }).rows;
    const b = changesByType({ olds: [old("s6a", 0.1, 0.2, 0.4, 10), old("c8b", 0.1, 0.3, 0.4, 5)], news: [run(0.1, 0.3, 0.4, 5)], items }).rows;
    const sum = sumRows([...a, ...b]);
    expect(sum.map((r) => [r.code, r.deltaFt])).toEqual([["C8B", 0], ["S6A", -40], [null, 12]]);
    expect(sum.find((r) => r.code === "S6A")?.deltaDollars).toBe(-800);
  });
});

describe("gcSummary: the changes in words a GC reads", () => {
  it("the sheets, each type's change in LF, SF and $, the net, and what is still to be priced", () => {
    const text = gcSummary({
      planLabel: "Addendum 1",
      sheets: [
        { pageNumber: 1, sheetNumber: "A101", replaces: { label: "bid.pdf", pageNumber: 3 }, status: "compared", runs: 2, matched: 1 },
        { pageNumber: 2, sheetNumber: "A102", replaces: { label: "bid.pdf", pageNumber: 4 }, status: "no scale", runs: 0, matched: 0 },
        { pageNumber: 5, sheetNumber: "A103", replaces: null, status: "new sheet", runs: 0, matched: 0 },
      ],
      rows: [
        { itemId: "s6a", code: "S6A", name: "S6A walls", oldFt: 50, newFt: 30, deltaFt: -20, deltaSqFt: -400, deltaDollars: -400 },
        { itemId: null, code: null, name: "New walls, no type yet", oldFt: 0, newFt: 12, deltaFt: 12, deltaSqFt: null, deltaDollars: null },
      ],
    });
    expect(text).toBe(
      [
        "Addendum 1: changes to our framing and drywall scope",
        "",
        "Sheets compared: A101.",
        "Revised, still to compare: A102.",
        "New sheets: A103.",
        "",
        "• S6A: −20 LF (−400 SF), −$400.00",
        "• New walls (type to confirm): +12 LF, to be priced",
        "",
        "Net change to our price: −$400.00, plus the walls still to be priced.",
      ].join("\n"),
    );
  });
});
