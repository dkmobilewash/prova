import { describe, expect, it } from "vitest";

import { alternateDirection, bidLineProblem, bidTotals, type BidLineInput } from "./bid-lines";

const line = (over: Partial<BidLineInput> & Pick<BidLineInput, "kind">): BidLineInput => ({
  label: "Alternate 1",
  amount: null,
  unit: null,
  unitPrice: null,
  accepted: null,
  ...over,
});

const alternate = (amount: number, accepted: boolean | null = null) =>
  line({ kind: "ALTERNATE", amount, accepted });
const allowance = (amount: number) => line({ kind: "ALLOWANCE", amount, label: "Allowance A" });
const unitPrice = () =>
  line({ kind: "UNIT_PRICE", unit: "SF of 5/8 board", unitPrice: 3.1, label: "Unit price A" });

describe("an allowance is inside the base bid and is never added to it", () => {
  it("reports what is carried WITHOUT changing the award", () => {
    // THE BUG THIS PINS: adding a $15,000 allowance to a $200,000 base sends
    // the bid out $15,000 high, and nothing on the page looks wrong.
    const totals = bidTotals(200_000, [allowance(15_000)]);
    expect(totals.allowancesCarried).toBe(15_000);
    expect(totals.allowanceCount).toBe(1);
    expect(totals.awardedTotal).toBe(200_000);
  });

  it("does not let an allowance reach the alternates either", () => {
    const totals = bidTotals(200_000, [allowance(15_000)]);
    expect(totals.alternatesOffered).toBe(0);
    expect(totals.alternatesAccepted).toBe(0);
    expect(totals.alternateCount).toBe(0);
  });
});

describe("a unit price is a rate and enters no total", () => {
  it("is counted but never summed", () => {
    const totals = bidTotals(100_000, [unitPrice(), unitPrice()]);
    expect(totals.unitPriceCount).toBe(2);
    expect(totals.awardedTotal).toBe(100_000);
    expect(totals.alternatesOffered).toBe(0);
    expect(totals.allowancesCarried).toBe(0);
  });
});

describe("an alternate sits outside the base and only counts once accepted", () => {
  it("separates what was offered from what was taken", () => {
    const totals = bidTotals(100_000, [
      alternate(12_400, true),
      alternate(5_000, false),
      alternate(2_000, null),
    ]);
    expect(totals.alternatesOffered).toBe(19_400);
    expect(totals.alternatesAccepted).toBe(12_400);
    expect(totals.acceptedCount).toBe(1);
    expect(totals.awardedTotal).toBe(112_400);
  });

  it("treats a DEDUCT as the negative it is, in both figures", () => {
    const totals = bidTotals(100_000, [alternate(-8_000, true)]);
    expect(totals.alternatesOffered).toBe(-8_000);
    expect(totals.awardedTotal).toBe(92_000);
  });

  it("counts what the GC has not answered, so a total is not read as settled", () => {
    // "Not accepted yet" and "rejected" are different facts about a live
    // negotiation; collapsing them would make this award look final.
    const totals = bidTotals(100_000, [alternate(2_000, null), alternate(3_000, false)]);
    expect(totals.undecidedCount).toBe(1);
    expect(totals.awardedTotal).toBe(100_000);
  });

  it("gives no award at all without a base — alternates alone are not a bid", () => {
    const totals = bidTotals(null, [alternate(12_400, true)]);
    expect(totals.awardedTotal).toBeNull();
    expect(totals.alternatesAccepted).toBe(12_400);
  });

  it("skips an alternate with no amount rather than counting it as zero", () => {
    const totals = bidTotals(100_000, [alternate(5_000, true), line({ kind: "ALTERNATE", accepted: true })]);
    expect(totals.alternateCount).toBe(2);
    expect(totals.alternatesAccepted).toBe(5_000);
  });
});

describe("the three kinds together", () => {
  it("keeps each one in its own place", () => {
    const totals = bidTotals(200_000, [
      allowance(15_000),
      alternate(12_400, true),
      alternate(-3_000, null),
      unitPrice(),
    ]);
    expect(totals.base).toBe(200_000);
    expect(totals.allowancesCarried).toBe(15_000); // inside the base
    expect(totals.alternatesOffered).toBe(9_400); // 12,400 - 3,000
    expect(totals.alternatesAccepted).toBe(12_400);
    expect(totals.undecidedCount).toBe(1);
    expect(totals.unitPriceCount).toBe(1);
    // Base + accepted alternates. NOT base + allowance + alternates.
    expect(totals.awardedTotal).toBe(212_400);
  });

  it("is empty-safe", () => {
    expect(bidTotals(null, [])).toEqual({
      base: null,
      allowancesCarried: 0,
      allowanceCount: 0,
      alternatesOffered: 0,
      alternateCount: 0,
      alternatesAccepted: 0,
      acceptedCount: 0,
      undecidedCount: 0,
      awardedTotal: null,
      unitPriceCount: 0,
    });
  });
});

describe("what a line has to be before it is saved", () => {
  it("needs the GC's own label", () => {
    expect(bidLineProblem(alternate(100))).toBeNull();
    expect(bidLineProblem({ ...alternate(100), label: "  " })).toMatch(/label/);
  });

  it("refuses an alternate with no amount, and one of zero", () => {
    expect(bidLineProblem(line({ kind: "ALTERNATE" }))).toMatch(/needs an amount/);
    expect(bidLineProblem(alternate(0))).toMatch(/changes nothing/);
  });

  it("refuses a negative allowance", () => {
    expect(bidLineProblem(allowance(-100))).toMatch(/cannot be negative/);
    expect(bidLineProblem(allowance(100))).toBeNull();
  });

  it("makes a unit price carry a rate and a unit, and no total", () => {
    expect(bidLineProblem(unitPrice())).toBeNull();
    expect(bidLineProblem({ ...unitPrice(), unitPrice: null })).toMatch(/needs a rate/);
    expect(bidLineProblem({ ...unitPrice(), unit: " " })).toMatch(/what the rate is per/);
    expect(bidLineProblem({ ...unitPrice(), unitPrice: -1 })).toMatch(/cannot be negative/);
    expect(bidLineProblem({ ...unitPrice(), amount: 500 })).toMatch(/not a total/);
  });

  it("keeps a rate off an alternate and an allowance", () => {
    expect(bidLineProblem({ ...alternate(100), unitPrice: 3 })).toMatch(/Only a unit price/);
    expect(bidLineProblem({ ...allowance(100), unit: "SF" })).toMatch(/Only a unit price/);
  });
});

describe("an alternate says its direction in words", () => {
  it("names ADD and DEDUCT, because a minus sign is the easiest thing to miss", () => {
    expect(alternateDirection(12_400)).toBe("ADD");
    expect(alternateDirection(-8_000)).toBe("DEDUCT");
  });

  it("has no direction without an amount", () => {
    expect(alternateDirection(null)).toBeNull();
    expect(alternateDirection(0)).toBeNull();
  });
});
