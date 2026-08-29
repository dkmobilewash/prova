import { describe, expect, it } from "vitest";

import { calculateRetainageSummary } from "@/lib/retainage";

// First test over the money math. The existing suite covers derived state
// and dates; the billing calculations in retainage.ts, wip.ts and
// pay-application.ts had none, and that is where the last shipped defect
// was (materials-stored dropped from pay app running totals, e51a9e7).
//
// The null case below is the one worth having: invoiceRetainageWithheld is
// `(number | null)[]` because retainage is snapshotted per invoice at
// creation, so any invoice issued before a retainage rate was set carries
// null. A sum that propagated that null would report NaN withheld on a job
// that mixes pre- and post-retainage invoices.
describe("calculateRetainageSummary", () => {
  it("sums withheld and released amounts into an outstanding balance", () => {
    const summary = calculateRetainageSummary({
      invoiceRetainageWithheld: [5000, 2500],
      releaseAmounts: [1000],
      substantialCompletionDate: null,
    });

    expect(summary.totalWithheld).toBe(7500);
    expect(summary.totalReleased).toBe(1000);
    expect(summary.balance).toBe(6500);
  });

  it("treats an invoice with no retainage snapshot as zero withheld", () => {
    const summary = calculateRetainageSummary({
      invoiceRetainageWithheld: [5000, null],
      releaseAmounts: [],
      substantialCompletionDate: null,
    });

    expect(summary.totalWithheld).toBe(5000);
    expect(summary.balance).toBe(5000);
  });

  it("reports a negative balance when releases exceed what was withheld", () => {
    const summary = calculateRetainageSummary({
      invoiceRetainageWithheld: [1000],
      releaseAmounts: [1500],
      substantialCompletionDate: null,
    });

    expect(summary.balance).toBe(-500);
  });
});
