import { describe, expect, it } from "vitest";
import { packFor, packsFor, planMaterialOrder, type OrderLine } from "./materialOrder";

// Rows from the supplier price-list fixture (e2e/fixtures/supplier-price-list.csv), in the supplier's words.
const q = (id: string, description: string, unit: string, unitPrice: number) => ({ id, description, unit, unitPrice });
const SCREWS = q("s", 'Drywall Screws Fine Thread #6 (5000/box) 1-1/4"', "BX", 42.5);
const COMPOUND = q("c", "All Purpose Joint Compound 4.5 gal / 61.7 lb", "PAIL", 21.4);
const TAPE = q("t", `Joint Tape Paper 2-1/16" x 500'`, "RL", 6.95);
const BATTS = q("b", 'R-19 Kraft Faced Batt 75.8 SF/bag 6-1/4" x 15" x 93"', "BAG", 62.9);
const TRACK = q("k", `Track 25 GA 6" x 10'`, "EA", 6.4);
const STUD = q("u", `Steel Stud 25 GA 6" x 12'`, "EA", 8.2);
const BOARD_MSF = q("x", `Gypsum Board Type X 5/8" x 4' x 12'`, "MSF", 510);
const BOARD_EA = q("r", `Gypsum Board Regular 5/8" x 4' x 8'`, "EA", 14.25);
const LIGHTWEIGHT = q("l", "Lightweight All Purpose Joint Compound 3.5 gal", "PAIL", 19.8);

describe("the pack, from what the supplier's row says", () => {
  it("a box, pail, roll, bag or piece holds its price over the price per estimate unit", () => {
    expect(packFor(SCREWS, "M")).toMatchObject({ unit: "BX", perPack: 5, pricePerPack: 42.5 });
    expect(packFor(COMPOUND, "LB")).toMatchObject({ unit: "PAIL", perPack: 61.7, pricePerPack: 21.4 });
    expect(packFor(TAPE, "RL")).toMatchObject({ unit: "RL", perPack: 1, pricePerPack: 6.95 });
    expect(packFor(BATTS, "SF")).toMatchObject({ unit: "BAG", perPack: 75.8, pricePerPack: 62.9 });
    expect(packFor(TRACK, "LF")).toMatchObject({ unit: "EA", perPack: 10, pricePerPack: 6.4 });
    expect(packFor(STUD, "EA")).toMatchObject({ unit: "EA", perPack: 1, pricePerPack: 8.2 });
    expect(packFor(BOARD_EA, "SHT")).toMatchObject({ unit: "EA", perPack: 1, pricePerPack: 14.25 });
  });

  it("board priced per MSF is bought by the sheet the row names: a 4x12 is 1.5 of the estimate's 4x8s", () => {
    // $510 per MSF × 48 sf = $24.48 a 4x12 sheet.
    expect(packFor(BOARD_MSF, "SHT")).toMatchObject({ unit: "SHT", perPack: 1.5, pricePerPack: 24.48 });
  });

  it("a row that does not say what is in the pack is refused with the reason, never guessed", () => {
    expect(packFor(LIGHTWEIGHT, "LB")).toEqual({ why: expect.stringContaining("weight is not stated") });
    expect(packFor(q("f", "Delivery - boom truck", "EA", 125), "EA")).toEqual({ why: expect.stringContaining("not a material") });
  });

  it("whole packs, rounded up; a hair over is still that pack", () => {
    expect(packsFor(12.2, 5)).toBe(3);
    expect(packsFor(10, 5)).toBe(2);
    expect(packsFor(10.0000001, 5)).toBe(2);
    expect(packsFor(0.3, 61.7)).toBe(1);
    expect(packsFor(100, 1.5)).toBe(67);
  });
});

const line = (id: string, description: string, quantity: number, unit: string, quotes: OrderLine["quotes"], phase: OrderLine["phase"] = null): OrderLine => ({ id, description, quantity, unit, quotes, phase });

describe("planning the order", () => {
  it("one order, every line in whole packs at the supplier's price; what it cannot price is skipped with why", () => {
    const plan = planMaterialOrder(
      [
        line("1", "drywall screws, Type S, per 1,000 (W1)", 12.2, "M", [SCREWS]),
        line("2", "joint compound (W1)", 130, "LB", [COMPOUND]),
        line("3", '5/8" Type X, 4x8 sheets (W1)', 100, "SHT", [BOARD_MSF]),
        line("4", "corner bead", 40, "EA", []),
        line("5", "lightweight compound", 20, "LB", [LIGHTWEIGHT]),
      ],
      "Northgate",
    );
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]!.lines.map((l) => [l.lineItemId, l.quantity, l.unit, l.unitPrice])).toEqual([
      ["1", 3, "BX", 42.5],
      ["2", 3, "PAIL", 21.4],
      ["3", 67, "SHT", 24.48],
    ]);
    expect(plan.skipped).toEqual([
      { description: "corner bead", why: "not on Northgate's price list" },
      { description: "lightweight compound", why: expect.stringContaining("weight is not stated") },
    ]);
  });

  it("one order per phase code the lines carry, and one for the lines with none", () => {
    const framing = { id: "p1", code: "0921", name: "Framing" };
    const board = { id: "p2", code: "0929", name: "Board" };
    const plan = planMaterialOrder([line("1", "studs", 40, "EA", [STUD], framing), line("2", "board", 32, "SHT", [BOARD_EA], board), line("3", "tape", 4, "RL", [TAPE])], "Northgate");
    expect(plan.orders.map((o) => [o.phase?.code ?? null, o.lines.map((l) => l.lineItemId)])).toEqual([
      [null, ["3"]],
      ["0921", ["1"]],
      ["0929", ["2"]],
    ]);
    expect(plan.orders[1]!.lines[0]!.description).toBe(`0921 Framing: Steel Stud 25 GA 6" x 12'`);
  });
});
