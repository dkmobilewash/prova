import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { QuoteData } from "@/components/vendorPricing";
import { buyoutRows, commitmentsByLine, isBuyoutLine, poLineAmount, type BuyoutLineInput } from "./purchase-orders";

const quote = (over: Partial<QuoteData>): QuoteData => ({
  id: "q",
  vendorId: "v",
  vendorName: "Vendor",
  catalogEntryId: "cat",
  description: "Board",
  unit: "SF",
  unitPrice: 1,
  quotedOn: "2026-10-01",
  validUntil: null,
  source: "QUOTE",
  notes: null,
  ...over,
} as QuoteData);

const line: BuyoutLineInput = {
  id: "l1",
  description: "5/8 type X",
  unit: "SF",
  quantity: 1000,
  budgetedUnitCost: 0.8,
  costCategory: "MATERIAL",
  catalogEntryId: "cat",
};
const TODAY = "2026-10-30";

describe("committed", () => {
  it("counts ISSUED and CLOSED as committed and DRAFT only as drafted", () => {
    const map = commitmentsByLine([
      { lineItemId: "l1", quantity: 100, unitPrice: 1.1, status: "ISSUED" },
      { lineItemId: "l1", quantity: 50, unitPrice: 1, status: "CLOSED" },
      { lineItemId: "l1", quantity: 10, unitPrice: 3, status: "DRAFT" },
    ]);
    expect(map.get("l1")).toEqual({ committed: 160, drafted: 30, quantityBought: 160 });
  });

  it("rounds each line to the cent without float dust", () => {
    expect(poLineAmount({ quantity: 3, unitPrice: 0.1 })).toBe(0.3);
  });
});

describe("the buyout comparison", () => {
  it("leaves labor out: that is the sub's own crew", () => {
    expect(isBuyoutLine({ costCategory: "LABOR" })).toBe(false);
    expect(isBuyoutLine({ costCategory: "SUBCONTRACTOR" })).toBe(true);
    expect(isBuyoutLine({ costCategory: null })).toBe(true);
    expect(buyoutRows([{ ...line, costCategory: "LABOR" }], [], new Map(), TODAY)).toEqual([]);
  });

  it("compares live quotes in the line's unit, cheapest first, against the budget for what is left", () => {
    const [row] = buyoutRows(
      [line],
      [quote({ id: "a", vendorId: "a", vendorName: "Foundation", unitPrice: 0.9 }), quote({ id: "b", vendorId: "b", vendorName: "Acme", unitPrice: 0.7 })],
      new Map([["l1", { committed: 80, drafted: 0, quantityBought: 100 }]]),
      TODAY,
    );
    expect(row.budget).toBe(800);
    expect(row.quantityLeft).toBe(900);
    expect(row.offers.map((o) => [o.vendorName, o.extended, o.overBudget, o.cheapest])).toEqual([
      ["Acme", 630, -90, true],
      ["Foundation", 810, 90, false],
    ]);
  });

  it("shows a quote in another unit without offering or converting it", () => {
    const [row] = buyoutRows([line], [quote({ unit: "MSF", unitPrice: 800, vendorName: "Foundation" })], new Map(), TODAY);
    expect(row.offers).toEqual([]);
    expect(row.otherUnits).toEqual([{ vendorName: "Foundation", unit: "MSF", unitPrice: 800 }]);
  });

  it("drops an expired quote and a quote for a different catalog item", () => {
    const [row] = buyoutRows([line], [quote({ validUntil: "2026-10-01" }), quote({ id: "x", catalogEntryId: "other" })], new Map(), TODAY);
    expect(row.offers).toEqual([]);
  });

  it("matches nothing on a line that did not come from the catalog", () => {
    const [row] = buyoutRows([{ ...line, catalogEntryId: null }], [quote({ catalogEntryId: null })], new Map(), TODAY);
    expect(row.offers).toEqual([]);
  });

  it("has no over-budget figure on a line with no budgeted cost, and floors quantity left at zero", () => {
    const [row] = buyoutRows(
      [{ ...line, budgetedUnitCost: null }],
      [quote({})],
      new Map([["l1", { committed: 0, drafted: 1, quantityBought: 1200 }]]),
      TODAY,
    );
    expect(row.budget).toBeNull();
    expect(row.quantityLeft).toBe(0);
    expect(row.offers[0].overBudget).toBeNull();
  });
});

describe("a commitment is never added to a cost", () => {
  it("is not read by any job-cost arithmetic", () => {
    for (const file of ["lib/wip.ts", "lib/labor-job-cost.ts", "lib/retainage.ts", "lib/pay-application.ts"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source.length, file).toBeGreaterThan(100);
      expect(source, file).not.toMatch(/purchaseOrder|PurchaseOrder|purchase-orders/);
    }
  });
});
