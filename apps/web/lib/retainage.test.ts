import { describe, expect, it } from "vitest";
import { calculateRetainageSummary } from "./retainage";

/** retainage.ts had no test file at all before issue #46 — which is part
 * of how a card that could never show a number stayed shipped.
 *
 * The seven `totalRetainageHeld` cases that used to follow moved to
 * lib/retainage-query.dbtest.ts when #97 replaced that helper with two
 * aggregates. They were not dropped: every one of them (a COMPLETE job, a
 * job completed in a previous month, a job with no completion date, a job
 * whose expected completion is in the future, a fully released job) is now
 * asserted against real rows, which is where #46 and #97 both lived. This
 * file keeps the per-job arithmetic, which four callers still use and
 * which was never the thing that broke. */
describe("calculateRetainageSummary", () => {
  const completion = new Date(Date.UTC(2026, 7, 10));

  it("is withheld minus released", () => {
    const summary = calculateRetainageSummary({
      invoiceRetainageWithheld: [10000, 3420],
      releaseAmounts: [4000],
      substantialCompletionDate: completion,
    });
    expect(summary.totalWithheld).toBe(13420);
    expect(summary.totalReleased).toBe(4000);
    expect(summary.balance).toBe(9420);
  });

  it("treats a null withholding as nothing withheld, not as zero-rated", () => {
    // An invoice with no retainage recorded is not an invoice with a
    // retainage of zero for reporting purposes, but it contributes the
    // same to the total — worth pinning so a later change to `?? 0`
    // somewhere else has to disagree with this out loud.
    expect(
      calculateRetainageSummary({
        invoiceRetainageWithheld: [null, 500, null],
        releaseAmounts: [],
        substantialCompletionDate: completion,
      }).totalWithheld,
    ).toBe(500);
  });
});
