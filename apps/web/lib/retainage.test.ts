import { describe, expect, it } from "vitest";
import { calculateRetainageSummary, totalRetainageHeld } from "./retainage";

/** retainage.ts had no test file at all before issue #46 — which is part
 * of how a card that could never show a number stayed shipped. */
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

describe("totalRetainageHeld", () => {
  const august = new Date(Date.UTC(2026, 7, 10));
  const july = new Date(Date.UTC(2026, 6, 28));

  it("counts a job that reached substantial completion", () => {
    // Issue #46, verified against seeded data: $13,420 withheld, nothing
    // released, completion 2026-08-10 — the card rendered $0.00.
    expect(
      totalRetainageHeld([
        {
          substantialCompletionDate: august,
          invoiceRetainageWithheld: [13420],
          releaseAmounts: [],
        },
      ]),
    ).toBe(13420);
  });

  it("counts a job completed in a PREVIOUS month", () => {
    // The second half of #46. "Releasing this month" dropped a job that
    // completed on the 28th of last month with retainage still unpaid —
    // the normal case, not an edge one. Retainage is chased for months,
    // and a figure that resets on the 1st says nothing is owed on the day
    // it is most owed.
    expect(
      totalRetainageHeld([
        { substantialCompletionDate: july, invoiceRetainageWithheld: [5000], releaseAmounts: [] },
      ]),
    ).toBe(5000);
  });

  it("subtracts what has already been released", () => {
    expect(
      totalRetainageHeld([
        {
          substantialCompletionDate: august,
          invoiceRetainageWithheld: [10000, 3420],
          releaseAmounts: [4000],
        },
      ]),
    ).toBe(9420);
  });

  it("counts a job with NO completion date at all", () => {
    // Reversed after the dry run. substantialCompletionDate is the date a
    // job is EXPECTED to reach substantial completion — a forecasting
    // anchor, not a record that it happened. Requiring it dropped real
    // money held on jobs nobody had forecast yet, and it let a caption
    // claim an event the column does not record.
    expect(
      totalRetainageHeld([
        { substantialCompletionDate: null, invoiceRetainageWithheld: [8000], releaseAmounts: [] },
      ]),
    ).toBe(8000);
  });

  it("counts a job whose expected completion is in the FUTURE", () => {
    // The dry-run case exactly: $300 held on a Contracted job expecting
    // completion eight weeks out. The GC is holding that money today.
    const future = new Date(Date.UTC(2026, 9, 28));
    expect(
      totalRetainageHeld([
        { substantialCompletionDate: future, invoiceRetainageWithheld: [100, 200], releaseAmounts: [] },
      ]),
    ).toBe(300);
  });

  it("sums across jobs and returns zero for none", () => {
    expect(
      totalRetainageHeld([
        { substantialCompletionDate: august, invoiceRetainageWithheld: [1000], releaseAmounts: [] },
        { substantialCompletionDate: july, invoiceRetainageWithheld: [2000], releaseAmounts: [500] },
      ]),
    ).toBe(2500);
    expect(totalRetainageHeld([])).toBe(0);
  });

  it("treats a fully released job as nothing held", () => {
    expect(
      totalRetainageHeld([
        { substantialCompletionDate: august, invoiceRetainageWithheld: [5000], releaseAmounts: [5000] },
      ]),
    ).toBe(0);
  });
});
