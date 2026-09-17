import { describe, expect, it } from "vitest";
import { calculateJobWip, calculateLineItemWip } from "./wip";

/**
 * WHAT AN APPROVED CHANGE ORDER'S MARKUP DOES TO WIP — pinned as it stands,
 * with the consequence named rather than smoothed over.
 *
 * Approving a change order writes the overhead-and-profit markup as its own
 * `JobLineItem`, priced at the markup with `budgetedUnitCost` and
 * `currentEstimatedUnitCost` of 0. That is right on the cost side: the
 * markup is margin and its direct cost genuinely is nothing.
 *
 * But a zero forecast makes `percentComplete` null (the guard is `> 0`, not
 * `!= null`), and a null percentComplete makes `earnedRevenue` null — while
 * the line's `contractValue` is the whole markup. So **the markup is in the
 * contract and can never be earned.**
 *
 * THIS TEST DOES NOT ASSERT THAT THIS IS RIGHT. It asserts what the numbers
 * currently ARE, because the fix is a decision about how WIP earns rather
 * than a line in the action that inserts the row — cost-to-cost cannot earn
 * a line with no cost, so the markup would have to earn pro rata with the
 * work it marks up. Nulling the costs instead is worse: it drags
 * estimatedCoverage down for a line that has no cost to forecast.
 *
 * Every number below moves when somebody makes that decision, and that is
 * the point: whoever makes it sees exactly what changes, and nothing drifts
 * silently while it is open. Review found this; the branch's own claim
 * mentioned only the percent-complete half.
 */

/** $10,000 of work, forecast to cost $6,000, half spent. */
const WORK = {
  quantity: 1,
  unitPrice: 10_000,
  budgetedUnitCost: 6_000,
  currentEstimatedUnitCost: 6_000,
  estimatedCostToComplete: null,
  actualCostToDate: 3_000,
};

/** The 15% markup approving a change order writes: priced, costed at zero. */
const MARKUP = {
  quantity: 1,
  unitPrice: 1_500,
  budgetedUnitCost: 0,
  currentEstimatedUnitCost: 0,
  estimatedCostToComplete: null,
  actualCostToDate: 0,
};

describe("an overhead-and-profit line, on its own", () => {
  const line = calculateLineItemWip(MARKUP);

  it("carries the full markup as contract value", () => {
    expect(line.contractValue).toBe(1_500);
  });

  it("has NO percent complete — a zero forecast cannot be divided into", () => {
    expect(line.percentComplete).toBeNull();
  });

  it("therefore EARNS NOTHING, ever, which is the finding", () => {
    // Not "earns zero so far". There is no arithmetic by which this line
    // ever earns: percentComplete is null whatever the job does, because
    // the forecast it would be measured against is 0.
    expect(line.earnedRevenue).toBeNull();
  });
});

describe("the same markup inside a job's WIP", () => {
  const work = calculateLineItemWip(WORK);
  const markup = calculateLineItemWip(MARKUP);

  const withoutMarkup = calculateJobWip([work], 0);
  const withMarkup = calculateJobWip([work, markup], 0);

  it("adds its value to the contract", () => {
    expect(withoutMarkup.contractValue).toBe(10_000);
    expect(withMarkup.contractValue).toBe(11_500);
  });

  it("adds NOTHING to earned revenue — the job earns the same as before", () => {
    // The work is half spent against a $6,000 forecast, so it has earned
    // half its $10,000. Adding $1,500 of contract value earns nothing more.
    expect(withoutMarkup.earnedRevenue).toBe(5_000);
    expect(withMarkup.earnedRevenue).toBe(5_000);
  });

  it("DROPS earned coverage, because the markup can only ever be a denominator", () => {
    // 100% of the contract could report an earned figure before; now
    // $1,500 of $11,500 never can. This is the number a reader would take
    // as "how much of this job's contract the earned figure covers".
    expect(withoutMarkup.earnedCoverage).toBe(1);
    expect(withMarkup.earnedCoverage).toBeCloseTo(10_000 / 11_500, 6);
  });

  it("reads OVERBILLED by the markup once the markup is billed", () => {
    // The consequence that reaches a surety. Bill the work's earned $5,000
    // plus the $1,500 markup and the job reports over-billing of exactly
    // the markup — not because anything was over-billed, but because the
    // markup cannot appear on the earned side of the subtraction.
    const billed = calculateJobWip([work, markup], 6_500);
    expect(billed.overUnderBilling).toBe(1_500);
  });
});
