import { describe, expect, it } from "vitest";
import { recapLines, recapStateFor } from "./recap-state";
import { proposalPriceState } from "./proposal-recap-currency";

/**
 * ── THIS MONEY JUDGEMENT HAD NO TEST, AND THAT IS WHY THIS FILE EXISTS ──
 *
 * `recapStateFor` is the forty lines that used to sit inside
 * `jobs/[id]/proposal/page.tsx`, lifted so the job page's "needs you" list and
 * the proposal document could not hold two copies of it.
 *
 * Lifting it was supposed to be behaviour-preserving, and the whole suite agreed
 * — 11,100 tests green. Then three mutations of the lifted function stayed green
 * too: dropping `appliedAt` (so an applied recap reads as never-applied),
 * dropping `appliedTotal` (so a stale recap cannot be detected), and dropping
 * the cost the markup is applied TO. Each of those is a wrong price on a
 * document a GC reads, and nothing in this repo could see any of them.
 *
 * So the refactor was unverified, and so was the page before it. What the
 * mutations measured was not the lift — it was the absence of a test, which had
 * been there all along.
 */

const line = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  quantity: 10,
  budgetedUnitCost: 100,
  unitPrice: 150,
  costCategory: "MATERIAL",
  ...over,
});

/** A recap row with every rate null unless named. */
const row = (over: Record<string, unknown> = {}) => ({
  appliedAt: null as Date | null,
  appliedTotal: null as unknown,
  materialMarkupPercent: null,
  laborMarkupPercent: null,
  subcontractorMarkupPercent: null,
  equipmentMarkupPercent: null,
  otherMarkupPercent: null,
  escalationPercent: null,
  materialTaxPercent: null,
  overheadPercent: null,
  profitPercent: null,
  bondPercent: null,
  contingencyPercent: null,
  ...over,
});

describe("the recap state the proposal and the job page share", () => {
  it("is null with no recap row, because nothing has been set up to apply", () => {
    expect(recapStateFor(null, [line()])).toBeNull();
  });

  it("READS THE RATES OFF THE ROW — a dropped rate is money left on the table", () => {
    // 10 × $100 of material at 20% is $200 the bid should carry.
    const state = recapStateFor(row({ materialMarkupPercent: 20 }), [line()]);
    expect(state!.addedTotal).toBe(200);
  });

  it("MARKS UP `budgetedUnitCost` AND NOT the PM's live re-forecast (#512)", () => {
    // The nuance the proposal page documented and the reason this is a function
    // rather than a copied block. `currentEstimatedUnitCost` is a different
    // number for a different purpose — it moves after the bid goes out — so
    // marking it up would re-price a bid nobody re-sent.
    //
    // Set at ten times the budget: if the wrong field were read, `addedTotal`
    // would be 2,000 rather than 200.
    const state = recapStateFor(row({ materialMarkupPercent: 20 }), [
      line({ budgetedUnitCost: 100, currentEstimatedUnitCost: 1000 }),
    ]);
    expect(state!.addedTotal).toBe(200);
  });

  it("CARRIES `appliedAt`, which is the whole difference between two states", () => {
    // Without it, `proposalPriceState` reads an applied recap as NEVER_APPLIED
    // and the job page tells somebody to apply a markup that is already in the
    // prices — which, acted on, marks the bid up twice.
    const when = new Date("2026-10-01T00:00:00.000Z");
    const state = recapStateFor(row({ materialMarkupPercent: 20, appliedAt: when, appliedTotal: 1200 }), [
      line(),
    ]);
    expect(state!.appliedAt).toBe(when);
    expect(state!.appliedTotal).toBe(1200);

    // Through the consumer, which is what makes the two fields matter.
    expect(proposalPriceState(state, 1200).kind).toBe("CURRENT");
  });

  it("CARRIES `appliedTotal`, which is how a stale markup is caught", () => {
    // Applied at 1,200, but the lines now total 1,500 — somebody edited the
    // estimate after applying. Part marked up, part not.
    const state = recapStateFor(
      row({ materialMarkupPercent: 20, appliedAt: new Date("2026-10-01T00:00:00.000Z"), appliedTotal: 1200 }),
      [line()],
    );
    expect(proposalPriceState(state, 1500).kind).toBe("STALE");
  });

  it("reports NEVER_APPLIED when rates exist and nothing has been applied", () => {
    const state = recapStateFor(row({ materialMarkupPercent: 20 }), [line()]);
    expect(proposalPriceState(state, 1500).kind).toBe("NEVER_APPLIED");
  });

  it("reports NO_RECAP when every rate is blank, because nothing would be added", () => {
    const state = recapStateFor(row(), [line()]);
    expect(state!.addedTotal).toBe(0);
    expect(proposalPriceState(state, 1500).kind).toBe("NO_RECAP");
  });

  it("treats a Decimal-like value the way Prisma hands it over", () => {
    // Both callers pass Prisma rows, where money arrives as `Decimal` rather
    // than `number`. `Number()` is what the page did and what this keeps.
    const state = recapStateFor(row({ materialMarkupPercent: { toString: () => "20" } }), [
      line({ quantity: { toString: () => "10" }, budgetedUnitCost: { toString: () => "100" } }),
    ]);
    expect(state!.addedTotal).toBe(200);
  });

  describe("recapLines — the one conversion the markup and the margin share", () => {
    it("converts cost, price and quantity, and narrows the category", () => {
      expect(recapLines([line()])).toEqual([
        { id: "l1", quantity: 10, unitCost: 100, unitPrice: 150, costCategory: "MATERIAL" },
      ]);
    });

    it("keeps a missing cost as NULL rather than as zero", () => {
      // A line with no recorded cost is not a free line. `bid-recap.ts` counts
      // those separately and marks them up at nothing; a zero would silently
      // join them to the costed total and understate the markup.
      expect(recapLines([line({ budgetedUnitCost: null })])[0].unitCost).toBeNull();
      expect(recapLines([line({ unitPrice: null })])[0].unitPrice).toBeNull();
    });

    it("keeps an absent category as null, which is marked up at nothing", () => {
      expect(recapLines([line({ costCategory: null })])[0].costCategory).toBeNull();
    });
  });
});
