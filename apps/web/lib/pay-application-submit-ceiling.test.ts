import { describe, expect, it } from "vitest";
import { payAppEntryError } from "./pay-application";
import { scheduledValueFor, type PayAppJobLineItem } from "./pay-application-query";

/**
 * ISSUE #567 — the over-billing ceiling at SUBMIT was checked against a
 * scheduled value that ignored `isDeleted`, on the document a GC pays
 * against.
 *
 * `submitPayApplication` carried its own copy of the live-line half of
 * `scheduledValueFor`, under a comment reading "Same expression the job
 * page and the report use for a live line". The qualifier was the defect:
 * its query selected no `isDeleted`, so a removed line had no second branch
 * and was measured against its PRE-DEDUCTION value.
 *
 * WHY THIS IS A PURE TEST AND NEEDS NO DATABASE. The defect is entirely in
 * which NUMBER reaches `payAppEntryError`, and both halves of that are pure
 * functions. `pay-application-query.test.ts` already pins the render side
 * (`expect(row!.scheduledValue).toBe(10000)`); nothing pinned the write
 * side against it, which is how two expressions for one money figure stayed
 * disagreeing. This file is that missing half.
 *
 * The fixture is the one from `pay-application-query.test.ts`: line L3 at
 * $40,000 with $10,000 already billed, then removed by an approved
 * deductive change order.
 */

const REMOVED_L3: PayAppJobLineItem = {
  id: "L3",
  description: "Soffit framing",
  quantity: 1,
  unitPrice: 40000,
  isDeleted: true,
};

const LIVE_L1: PayAppJobLineItem = {
  id: "L1",
  description: "Metal stud framing",
  quantity: 1,
  unitPrice: 100000,
  isDeleted: false,
};

/** What `submitPayApplication` now passes: PRIOR earnings only. */
const priorEarnings = (previousBilled: number, previousMaterialsStored: number) =>
  previousBilled + previousMaterialsStored;

describe("the ceiling a pay-app submission is checked against", () => {
  it("refuses new billing on a line a deductive change order removed", () => {
    // The exact input from the issue: $25,000 this period on a removed line
    // that had earned $10,000. Before the fix this was ACCEPTED, an invoice
    // was created, and the G703 printed 100% complete with the contract sum
    // to date grown by $25,000.
    const error = payAppEntryError({
      lineItemId: "L3",
      description: REMOVED_L3.description,
      scheduledValue: scheduledValueFor(REMOVED_L3, priorEarnings(10000, 0)),
      previousBilled: 10000,
      thisPeriodBilled: 25000,
      previousMaterialsStored: 0,
      materialsStoredValue: 0,
    });

    expect(error, "a removed line accepted $25,000 of new billing — issue #567").not.toBeNull();
    expect(error).toContain("$35,000");
    expect(error).toContain("$10,000");
  });

  it("still accepts a zero entry on a removed line", () => {
    // A removed line appears on the continuation sheet at what it earned, so
    // it must remain submittable — it just cannot earn anything further.
    expect(
      payAppEntryError({
        lineItemId: "L3",
        description: REMOVED_L3.description,
        scheduledValue: scheduledValueFor(REMOVED_L3, priorEarnings(10000, 0)),
        previousBilled: 10000,
        thisPeriodBilled: 0,
        previousMaterialsStored: 0,
        materialsStoredValue: 0,
      }),
    ).toBeNull();
  });

  it("still accepts a downward correction on a removed line", () => {
    // The route back for an over-billed removed line. There is no void, edit
    // or delete invoice action in this app by design, so a later application
    // is the only place an earlier one can be corrected — and the floor is
    // enforced separately by the can't-un-bill guard, not by this ceiling.
    expect(
      payAppEntryError({
        lineItemId: "L3",
        description: REMOVED_L3.description,
        scheduledValue: scheduledValueFor(REMOVED_L3, priorEarnings(10000, 0)),
        previousBilled: 10000,
        thisPeriodBilled: -5000,
        previousMaterialsStored: 0,
        materialsStoredValue: 0,
      }),
    ).toBeNull();
  });

  it("leaves a live line's ceiling exactly as it was", () => {
    // The regression that matters most: the fix must not tighten anything on
    // the 99% case. A live line is still measured against quantity x
    // unitPrice, and the floor argument is not consulted at all.
    const atTheLimit = payAppEntryError({
      lineItemId: "L1",
      description: LIVE_L1.description,
      scheduledValue: scheduledValueFor(LIVE_L1, priorEarnings(0, 0)),
      previousBilled: 40000,
      thisPeriodBilled: 60000,
      previousMaterialsStored: 0,
      materialsStoredValue: 0,
    });
    expect(atTheLimit, "$100,000 against a $100,000 line is exactly at the ceiling").toBeNull();

    const overIt = payAppEntryError({
      lineItemId: "L1",
      description: LIVE_L1.description,
      scheduledValue: scheduledValueFor(LIVE_L1, priorEarnings(0, 0)),
      previousBilled: 40000,
      thisPeriodBilled: 60001,
      previousMaterialsStored: 0,
      materialsStoredValue: 0,
    });
    expect(overIt).not.toBeNull();
  });

  it("leaves a live cost-only line billable", () => {
    // `scheduledValue > 0` is load-bearing in payAppEntryError: a null
    // unitPrice is a cost-only budget line with no contract value, and
    // without that condition every unpriced line becomes unbillable. The
    // floor must not be substituted in for a LIVE line.
    const costOnly: PayAppJobLineItem = {
      id: "L5",
      description: "General conditions",
      quantity: 1,
      unitPrice: null,
      isDeleted: false,
    };
    expect(scheduledValueFor(costOnly, priorEarnings(7000, 0))).toBe(0);
    expect(
      payAppEntryError({
        lineItemId: "L5",
        description: costOnly.description,
        scheduledValue: scheduledValueFor(costOnly, priorEarnings(7000, 0)),
        previousBilled: 7000,
        thisPeriodBilled: 3000,
        previousMaterialsStored: 0,
        materialsStoredValue: 0,
      }),
    ).toBeNull();
  });
});

/**
 * THE TRAP THE FIX HAD TO AVOID, PINNED SO IT CANNOT BE REINTRODUCED AS A
 * TIDY-UP.
 *
 * The obvious reading of #567 is "two expressions for one figure, make them
 * one" — and sharing the function while also sharing the RENDER side's
 * argument would have been strictly worse than the bug.
 *
 * `payAppEntryError` compares `totalCompletedAndStoredToDate` against
 * `scheduledValue`, and the render side's floor IS that same total. Pass it
 * here and the comparison becomes `x > x`: false for every input, so a
 * removed line accepts any amount at all. The shipped bug at least capped
 * at the pre-deduction value.
 */
describe("why the submit floor is not the render floor", () => {
  const renderFloorInclusiveOfThisPeriod = 10000 + 25000;

  it("the inclusive floor makes the ceiling vacuous — the worse fix", () => {
    const scheduledValue = scheduledValueFor(REMOVED_L3, renderFloorInclusiveOfThisPeriod);
    expect(scheduledValue).toBe(35000);

    expect(
      payAppEntryError({
        lineItemId: "L3",
        description: REMOVED_L3.description,
        scheduledValue,
        previousBilled: 10000,
        thisPeriodBilled: 25000,
        previousMaterialsStored: 0,
        materialsStoredValue: 0,
      }),
      "sharing the render side's argument accepted the over-billing — this is the fix that looks right",
    ).toBeNull();
  });

  it("and it would accept an arbitrarily large amount", () => {
    // Not a near miss. The ceiling moves with the entry, so there is no
    // amount it refuses.
    expect(
      payAppEntryError({
        lineItemId: "L3",
        description: REMOVED_L3.description,
        scheduledValue: scheduledValueFor(REMOVED_L3, 10000 + 9_999_999),
        previousBilled: 10000,
        thisPeriodBilled: 9_999_999,
        previousMaterialsStored: 0,
        materialsStoredValue: 0,
      }),
    ).toBeNull();
  });

  it("while the prior-earnings floor refuses both", () => {
    const floor = priorEarnings(10000, 0);
    expect(scheduledValueFor(REMOVED_L3, floor)).toBe(10000);

    for (const thisPeriodBilled of [25000, 9_999_999]) {
      expect(
        payAppEntryError({
          lineItemId: "L3",
          description: REMOVED_L3.description,
          scheduledValue: scheduledValueFor(REMOVED_L3, floor),
          previousBilled: 10000,
          thisPeriodBilled,
          previousMaterialsStored: 0,
          materialsStoredValue: 0,
        }),
        `entering ${thisPeriodBilled} on a removed line was accepted`,
      ).not.toBeNull();
    }
  });
});
