// Issue #288, and there was no test file for this module at all before —
// which is not incidental. `calculateArAgingInvoice` had no retainage term
// in it, the retainage section of /cash-flow counted the same dollars
// again, and the whole thing typechecked, linted and tested green for as
// long as it has existed, because nothing ever asked it the question.
//
// Every test here names the wrong behaviour it exists to catch, and every
// one was verified by putting that behaviour back and watching the named
// test go red. The mutation log is in the PR.
//
// WHAT IS ASSUMED, stated once here rather than implied in ten places: a
// Payment row is the cash that arrived against the invoice, and retainage
// arrives separately as a RetainageRelease (a per-JOB row — there is no way
// to log a release as a payment, and `releaseRetainage` does not create
// one). So a GC who pays exactly what an AIA G702 certifies — gross less
// retainage — has paid in full for aging purposes. That is the only reading
// under which the two ledgers do not double-count; see the PR for the
// evidence and for the one fixture on `main` that contradicts it.

import { describe, expect, it } from "vitest";
import {
  arBalanceFor,
  calculateArAgingInvoice,
  calculateCashFlowForecast,
  summarizeArAging,
  type ArAgingInvoiceInput,
} from "./cash-flow";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = day("2026-09-16");

function invoice(over: Partial<ArAgingInvoiceInput> = {}): ArAgingInvoiceInput {
  return {
    invoiceId: "inv-1",
    jobId: "job-1",
    jobName: "Riverside Medical",
    contactName: "Acme GC",
    // $100,000 billed with 10% held: the shape in the issue.
    amount: 100_000,
    retainageWithheld: 10_000,
    paidAmount: 0,
    issuedAt: day("2026-05-01"),
    dueAt: day("2026-05-31"),
    paymentTermsDays: null,
    ...over,
  };
}

describe("retainage is not receivable", () => {
  it("drops an invoice paid to its NET amount out of aging entirely", () => {
    // THE DEFECT, as an assertion. The GC paid the $90,000 that was
    // certified due on a $100,000 invoice with $10,000 retained. The old
    // balance was amount - paid = $10,000, and that sat in the table
    // ageing 1-30 -> 31-60 -> 61-90 -> 90+ as though they were late.
    const row = calculateArAgingInvoice(invoice({ paidAmount: 90_000 }), NOW);
    expect(row).toBeNull();
  });

  it("ages what is genuinely short, and only that", () => {
    // $80,000 against $90,000 due. Ten thousand really is owed and really
    // is late — a fix that simply stopped ageing retainage-bearing
    // invoices would swallow this, which is the failure mode opposite to
    // the one above and just as bad.
    const row = calculateArAgingInvoice(invoice({ paidAmount: 80_000 }), NOW);
    expect(row?.balance).toBe(10_000);
    expect(row?.bucket).toBe("DAYS_90_PLUS");
  });

  it("subtracts nothing when the job has no retainage terms", () => {
    // Null is not zero as a claim, but it is zero as arithmetic, and an
    // invoice on a job with no retainage rate must age exactly as it did
    // before this change.
    const row = calculateArAgingInvoice(invoice({ retainageWithheld: null, paidAmount: 90_000 }), NOW);
    expect(row?.balance).toBe(10_000);
  });

  it("keeps the gross balance available, and does not age off it", () => {
    // "What is still unbilled-to-cash on this invoice" is a real question.
    // It is just not the same question as "what is overdue".
    const row = calculateArAgingInvoice(invoice({ paidAmount: 80_000 }), NOW);
    expect(row?.grossBalance).toBe(20_000);
    expect(row?.balance).toBe(10_000);
  });

  it("does not leave float dust ageing as an overdue balance", () => {
    // Not a hypothetical: these three numbers are what the app itself
    // produces. `retainageWithheldFor` is `(amount * pct/100).toFixed(2)`,
    // so a $1,000.35 invoice at 10% snapshots $100.04, and a GC paying the
    // net pays $900.31.
    //
    //   1000.35 - 100.04 - 900.31 === 1.1368683772161603e-13
    //
    // Positive, so the old `balance <= 0` test fails and the invoice stays
    // in the table — for ever, ageing into 90+, at a balance that renders
    // as $0.00 with no way for anyone to see what it is. This is the
    // reason the subtraction is done in whole cents rather than the reason
    // being written down and not acted on.
    const row = calculateArAgingInvoice(
      invoice({ amount: 1_000.35, retainageWithheld: 100.04, paidAmount: 900.31 }),
      NOW,
    );
    expect(1_000.35 - 100.04 - 900.31).toBeGreaterThan(0); // the dust is real
    expect(row).toBeNull();
  });

  it("does not leave float dust when the ROUNDING in cents() is what is missing", () => {
    // The test above pins the wrong half of `cents()`, and only a mutation
    // run shows it. There are two ways to lose this guard, and its fixture
    // survives one of them:
    //
    //   arBalanceFor -> plain float subtraction   1000.35-100.04-900.31
    //                                             = +1.1368683772161603e-13  CAUGHT
    //   cents() -> `value * 100`, no Math.round   (100034.99999999999
    //                                              - 10004.000000000002
    //                                              - 90031.00000000001)/100
    //                                             = 0 exactly               SURVIVES
    //
    // Multiplying by 100 first does not remove the dust, it changes its
    // SIGN — and at $1,000.35 it happens to cancel, so the invoice still
    // drops out and every assertion above still passes with the rounding
    // deleted. `Math.round` was load-bearing and untested.
    //
    // $1,024.13 at 10% is the same construction with the sign the other
    // way: (amount * 10/100).toFixed(2) === "102.41", the GC pays the
    // $921.72 net, and without the rounding the balance comes out at
    // +1.4551915228366852e-13 -- above zero, so the invoice stays in the
    // aging table for ever at a balance that renders as $0.00. That is
    // issue #288's own symptom, reintroduced by dropping one Math.round.
    const row = calculateArAgingInvoice(
      invoice({ amount: 1_024.13, retainageWithheld: 102.41, paidAmount: 921.72 }),
      NOW,
    );
    // The fixture is only worth anything if the unrounded arithmetic really
    // does go positive here — asserted, so a future edit to these three
    // numbers cannot quietly make this test vacuous again.
    expect((1_024.13 * 100 - 102.41 * 100 - 921.72 * 100) / 100).toBeGreaterThan(0);
    expect(row).toBeNull();
  });

  it("is the same subtraction wherever it is asked", () => {
    // arBalanceFor is exported because /cash-flow, the Today receivables
    // tile and the Ask receivables tool all need it, and this repo has
    // twice shipped two surfaces that mirrored an invoice rule by hand and
    // disagreed. One function, asserted to agree with the aging row.
    const input = invoice({ paidAmount: 80_000 });
    expect(arBalanceFor(input)).toBe(calculateArAgingInvoice(input, NOW)!.balance);
  });
});

describe("the aging summary says what it left out", () => {
  it("reports the retainage netted out of the balances it is showing", () => {
    // A table 10% lighter than the invoices behind it, with nothing on
    // screen to say why, is the kind of number this product refuses to
    // show. Same reasoning as costCoverage in lib/wip.ts.
    const rows = [
      calculateArAgingInvoice(invoice({ paidAmount: 0 }), NOW)!,
      calculateArAgingInvoice(invoice({ invoiceId: "inv-2", amount: 50_000, retainageWithheld: 2_500 }), NOW)!,
    ];
    const summary = summarizeArAging(rows);
    expect(summary.totalOutstanding).toBe(90_000 + 47_500);
    expect(summary.retainageExcluded).toBe(12_500);
  });
});

describe("the forecast counts every dollar exactly once", () => {
  // The arithmetic the /cash-flow row total does — arExpected +
  // retainageExpected — asserted rather than rendered. Before #288 the AR
  // half contained the retainage half's dollars, so this sum overstated
  // the forecast by the retainage on every partially settled invoice.
  const aged = [
    calculateArAgingInvoice(invoice({ paidAmount: 30_000, dueAt: day("2026-09-30") }), NOW)!,
  ];
  const retainage = [
    {
      jobId: "job-1",
      jobName: "Riverside Medical",
      outstandingBalance: 10_000,
      substantialCompletionDate: day("2026-10-15"),
    },
  ];

  it("has no dollar in both halves", () => {
    const forecast = calculateCashFlowForecast(aged, retainage, NOW, 6);

    // $100,000 billed, $10,000 retained, $30,000 paid. Sixty thousand is
    // due now; ten thousand is due at completion; thirty thousand has
    // arrived. Nothing else is outstanding, so the two halves must sum to
    // exactly $70,000 — the old code made it $80,000.
    expect(forecast.totalArOutstanding).toBe(60_000);
    expect(forecast.totalRetainageOutstanding).toBe(10_000);

    const rowTotals = forecast.months.reduce((sum, m) => sum + m.arExpected + m.retainageExpected, 0);
    expect(rowTotals).toBe(70_000);
  });

  it("puts the retainage in the completion month, not the invoice's due month", () => {
    const forecast = calculateCashFlowForecast(aged, retainage, NOW, 6);
    const september = forecast.months.find((m) => m.key === "2026-09")!;
    const october = forecast.months.find((m) => m.key === "2026-10")!;

    // The whole point of moving these dollars: they are not late, and they
    // are not arriving in September either. They arrive around completion.
    expect(september.arExpected).toBe(60_000);
    expect(september.retainageExpected).toBe(0);
    expect(october.arExpected).toBe(0);
    expect(october.retainageExpected).toBe(10_000);
  });
});
