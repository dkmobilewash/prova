import { describe, expect, it } from "vitest";
import { bidTotalOf } from "@/lib/estimating/recap-state";
import { gcPrice } from "@/lib/estimating/gc-price";
import { proposalPresentation, scopeSubtotals, type ProposalLineInput } from "./proposal-presentation";

/**
 * The proposal opened FOR ONE GC: the same three presentations, at that GC's
 * price. The invariant is the one the plain proposal already holds - whatever is
 * printed adds up to the printed total, to the cent - now with a total that is
 * not the estimate's own.
 */

const line = (over: Partial<ProposalLineInput> & { id: string }): ProposalLineInput => ({
  description: "line",
  unit: "SF",
  quantity: 1,
  unitPrice: 1,
  wallType: null,
  tradeScope: null,
  ...over,
});

const W2 = { code: "W2", name: "Rated partition" };
const W5 = { code: "W5", name: "Furring" };

const LINES: ProposalLineInput[] = [
  line({ id: "a", quantity: 1240, unitPrice: 2.37, wallType: W2 }),
  line({ id: "b", quantity: 3333.33, unitPrice: 1.15, wallType: W2 }),
  line({ id: "c", quantity: 7.5, unitPrice: 0.33, wallType: W5 }),
  line({ id: "d", quantity: 2.5, unitPrice: 1.15, wallType: W5 }),
  line({ id: "e", quantity: 1, unitPrice: 1234.56, tradeScope: "METAL_FRAMING_DRYWALL" }),
  line({ id: "f", quantity: 3, unitPrice: 0.335 }),
  line({ id: "g", quantity: 1, unitPrice: null }),
];

const priceFor = (adjustment: Parameters<typeof gcPrice>[1]) => {
  const priced = gcPrice(bidTotalOf(LINES), adjustment);
  if (!priced.ok) throw new Error(priced.error);
  return priced.priceCents;
};

describe("proposal at a GC's price", () => {
  it("with no price given, every mode is exactly what it was", () => {
    for (const mode of ["lump", "scope", "itemized"] as const) {
      const plain = proposalPresentation(LINES, mode);
      expect(proposalPresentation(LINES, mode, undefined)).toEqual(plain);
      // Itemized prints the sum as it is; lump and scope print it in whole cents.
      expect(plain.total).toBeCloseTo(bidTotalOf(LINES), 2);
    }
    const itemized = proposalPresentation(LINES, "itemized");
    if (itemized.mode !== "itemized") throw new Error("mode");
    expect(itemized.adjustmentCents).toBeNull();
  });

  it("lump: one row at the GC's price", () => {
    const cents = priceFor({ percent: -4 });
    const lump = proposalPresentation(LINES, "lump", cents);
    expect(lump.total).toBe(cents / 100);
    if (lump.mode !== "lump") throw new Error("mode");
    expect(lump.rows).toHaveLength(1);
    expect(lump.rows[0].amountCents).toBe(cents);
    expect(cents).toBeLessThan(Math.round(bidTotalOf(LINES) * 100));
  });

  it("by scope: the subtotals add up to the GC's price to the cent, over many prices", () => {
    let seed = 11;
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 300; i += 1) {
      const percent = Math.round((next() * 30 - 15) * 100) / 100;
      const amount = Math.round((next() * 5000 - 2500) * 100) / 100;
      const priced = gcPrice(bidTotalOf(LINES), i % 2 ? { percent } : { amount });
      if (!priced.ok) continue;
      const presentation = proposalPresentation(LINES, "scope", priced.priceCents);
      if (presentation.mode !== "scope") throw new Error("mode");
      expect(presentation.rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(priced.priceCents);
      expect(presentation.total).toBe(priced.priceCents / 100);
      // No scope row can go negative or invent a scope.
      expect(presentation.rows.every((row) => row.amountCents >= 0)).toBe(true);
      expect(scopeSubtotals(LINES).rows.map((row) => row.key).sort()).toEqual(
        presentation.rows.map((row) => row.key).sort(),
      );
    }
  });

  it("by scope: a price equal to the estimate's own splits exactly as the plain proposal does", () => {
    const own = Math.round(bidTotalOf(LINES) * 100);
    expect(scopeSubtotals(LINES, own)).toEqual(scopeSubtotals(LINES));
  });

  it("itemized: the lines still add to the estimate, one adjustment row carries the difference, the total is the GC's price", () => {
    const cents = priceFor({ amount: -2500 });
    const itemized = proposalPresentation(LINES, "itemized", cents);
    if (itemized.mode !== "itemized") throw new Error("mode");
    const lineCents = Math.round(bidTotalOf(LINES) * 100);
    expect(itemized.adjustmentCents).toBe(cents - lineCents);
    expect(itemized.adjustmentCents).toBe(-250000);
    expect(lineCents + itemized.adjustmentCents!).toBe(Math.round(itemized.total * 100));
    expect(itemized.total).toBe(cents / 100);
  });

  it("itemized: a GC quoted the estimate as it stands gets no adjustment row", () => {
    const itemized = proposalPresentation(LINES, "itemized", priceFor(null));
    if (itemized.mode !== "itemized") throw new Error("mode");
    expect(itemized.adjustmentCents).toBeNull();
  });

  it("an estimate of nothing priced by a dollar adjustment is one 'Other work' row, not a division by zero", () => {
    const empty = [line({ id: "z", quantity: 1, unitPrice: null })];
    const scoped = proposalPresentation(empty, "scope", 150_000);
    if (scoped.mode !== "scope") throw new Error("mode");
    expect(scoped.rows).toEqual([{ key: "other", label: "Other work", amountCents: 150_000 }]);
  });

  it("the row types still have no unit price in them, whatever the price", () => {
    const scoped = proposalPresentation(LINES, "scope", priceFor({ percent: 3 }));
    if (scoped.mode !== "scope") throw new Error("mode");
    for (const row of scoped.rows) expect(Object.keys(row).sort()).toEqual(["amountCents", "key", "label"]);
  });
});
