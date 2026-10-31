import { describe, expect, it } from "vitest";
import {
  lineWrite,
  planPriceRefresh,
  updateToken,
  type RefreshEntry,
  type RefreshLine,
} from "./price-refresh";

const line = (over: Partial<RefreshLine> & { id: string }): RefreshLine => ({
  description: over.id,
  quantity: 100,
  unit: "SF",
  unitPrice: 2.5,
  budgetedUnitCost: 1.75,
  currentEstimatedUnitCost: 1.75,
  catalogEntryId: "board",
  ...over,
});

const board: RefreshEntry = { id: "board", unit: "SF", defaultUnitPrice: 2.7, defaultBudgetedUnitCost: 1.89 };

describe("planPriceRefresh", () => {
  it("lists a stale linked line with old -> new and the effect on cost and the bid", () => {
    const plan = planPriceRefresh([line({ id: "a" })], [board], { recapApplied: false });
    expect(plan.updates).toHaveLength(1);
    const [u] = plan.updates;
    expect(u.price).toEqual({ old: 2.5, next: 2.7 });
    expect(u.cost).toEqual({ old: 1.75, next: 1.89 });
    expect(u.priceEffect).toBeCloseTo(20, 6); // 100 x 0.20
    expect(u.costEffect).toBeCloseTo(14, 6); // 100 x 0.14
    expect(plan.bidBefore).toBeCloseTo(250, 6);
    expect(plan.bidAfter).toBeCloseTo(270, 6);
  });

  it("leaves lines with no catalog link alone and says they were set by you", () => {
    const plan = planPriceRefresh([line({ id: "typed", catalogEntryId: null })], [board], {
      recapApplied: false,
    });
    expect(plan.updates).toHaveLength(0);
    expect(plan.kept).toEqual([{ lineId: "typed", description: "typed", reason: "no-link" }]);
  });

  it("keeps a line whose price book item was deleted, has no price, or is in another unit", () => {
    const plan = planPriceRefresh(
      [
        line({ id: "gone", catalogEntryId: "deleted" }),
        line({ id: "bare", catalogEntryId: "bare" }),
        line({ id: "unit", unit: "LF" }),
      ],
      [board, { id: "bare", unit: "SF", defaultUnitPrice: null, defaultBudgetedUnitCost: null }],
      { recapApplied: false },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.kept.map((k) => [k.lineId, k.reason])).toEqual([
      ["gone", "entry-missing"],
      ["bare", "no-catalog-price"],
      ["unit", "unit-differs"],
    ]);
  });

  it("counts a line that already matches as current, not as an update", () => {
    const plan = planPriceRefresh(
      [line({ id: "ok", unitPrice: 2.7, budgetedUnitCost: 1.89 })],
      [board],
      { recapApplied: false },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.current).toBe(1);
  });

  it("once the recap has been applied, moves cost only and never the marked-up price", () => {
    const marked = line({ id: "m", unitPrice: 3.4 }); // 1.75 cost + markup
    const plan = planPriceRefresh([marked], [board], { recapApplied: true });
    const [u] = plan.updates;
    expect(u.price).toBeNull();
    expect(u.cost).toEqual({ old: 1.75, next: 1.89 });
    expect(plan.priceHeldForRecap).toBe(true);
    expect(plan.bidAfter).toBe(plan.bidBefore);
  });

  it("a cost-only line (no price on the line) still gets its cost, and a null price counts as 0", () => {
    const plan = planPriceRefresh(
      [line({ id: "gc", unitPrice: null })],
      [{ ...board, defaultUnitPrice: 2.7 }],
      { recapApplied: false },
    );
    expect(plan.updates[0].price).toEqual({ old: null, next: 2.7 });
    expect(plan.bidBefore).toBe(0);
  });

  it("does not offer a price decrease differently — a cut is an update too", () => {
    const plan = planPriceRefresh(
      [line({ id: "d" })],
      [{ ...board, defaultUnitPrice: 2.0, defaultBudgetedUnitCost: 1.5 }],
      { recapApplied: false },
    );
    expect(plan.updates[0].priceEffect).toBeCloseTo(-50, 6);
  });
});

describe("lineWrite", () => {
  const [update] = planPriceRefresh([line({ id: "a" })], [board], { recapApplied: false }).updates;

  it("moves price, cost and the forecast that still equals cost", () => {
    expect(lineWrite(update, { budgetedUnitCost: 1.75, currentEstimatedUnitCost: 1.75 })).toEqual({
      unitPrice: "2.7",
      budgetedUnitCost: "1.89",
      currentEstimatedUnitCost: "1.89",
    });
  });

  it("leaves a forecast somebody typed over cost alone", () => {
    const data = lineWrite(update, { budgetedUnitCost: 1.75, currentEstimatedUnitCost: 2.2 });
    expect(data.currentEstimatedUnitCost).toBeUndefined();
    expect(data.budgetedUnitCost).toBe("1.89");
  });
});

describe("updateToken", () => {
  it("changes when the figure the person confirmed changes", () => {
    const [u] = planPriceRefresh([line({ id: "a" })], [board], { recapApplied: false }).updates;
    const [v] = planPriceRefresh(
      [line({ id: "a" })],
      [{ ...board, defaultUnitPrice: 2.9 }],
      { recapApplied: false },
    ).updates;
    expect(updateToken(u)).not.toBe(updateToken(v));
  });
});
