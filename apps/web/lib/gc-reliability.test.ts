// Issue #189. Every test here is about a number a subcontractor reads to
// decide whether to bid a GC's next job, so each names the wrong behaviour
// it exists to catch. All were verified by putting that behaviour back and
// watching the named test go red — mutation log in the PR.
//
// There was no test file for this module before. That is not incidental:
// the defect below sat on `main` behind a number that still rendered.

import { describe, expect, it } from "vitest";
import { calculatePaymentReliability, type ReliabilityInvoiceInput } from "./gc-reliability";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function invoice(over: Partial<ReliabilityInvoiceInput> = {}): ReliabilityInvoiceInput {
  return {
    amount: 100_000,
    // No retainage terms unless a test says so. The #288 cases below set
    // it explicitly; everything above them is the #189 world, where the
    // amount due and the gross amount are the same number — which is why
    // those assertions are unchanged and still mean what they meant.
    retainageWithheld: null,
    issuedAt: day("2026-08-01"),
    dueAt: day("2026-08-31"),
    paidAmount: 100_000,
    feesDeducted: 0,
    lastPaymentAt: day("2026-08-20"),
    ...over,
  };
}

describe("a fee is not a shortfall", () => {
  // Textura is 0.22% of contract value capped at $5,000, charged to the
  // SUB, on a platform the GC chose. $100,000 billed, $220 taken in
  // transit, $99,780 in the bank.
  const skimmed = invoice({ paidAmount: 99_780, feesDeducted: 220 });

  it("counts an invoice settled when cash plus the platform's cut covers it", () => {
    const r = calculatePaymentReliability([skimmed]);
    expect(r.settledCount).toBe(1);
    expect(r.shortPaidCount).toBe(0);
    expect(r.averageDaysToPay).toBe(19);
    expect(r.onTimeRate).toBe(1);
  });

  it("does not let a skimming GC score better than one who paid by cheque", () => {
    // THE DEFECT, stated as an assertion. Before #189 the fee-reduced
    // invoice was excluded from the timing figures rather than counted as
    // late, so the GC whose platform took a cut looked FASTER.
    const cheque = invoice({ lastPaymentAt: day("2026-08-25") }); // 24 days, paid in full
    const platform = invoice({
      paidAmount: 99_780,
      feesDeducted: 220,
      lastPaymentAt: day("2026-08-25"), // same 24 days
    });

    const a = calculatePaymentReliability([cheque]);
    const b = calculatePaymentReliability([platform]);

    expect(b.averageDaysToPay).toBe(a.averageDaysToPay);
    expect(b.settledCount).toBe(a.settledCount);
    // The old code gave the platform GC averageDaysToPay === null — no
    // slow invoices, because it had no invoices at all.
    expect(b.averageDaysToPay).not.toBeNull();
  });

  it("still reports paidTotal as CASH, not cash plus the fee", () => {
    // What the sub banked is the honest answer to "how much have they
    // paid me". The fee is somebody else's revenue.
    const r = calculatePaymentReliability([skimmed]);
    expect(r.paidTotal).toBe(99_780);
    expect(r.outstandingTotal).toBe(220);
  });
});

describe("a genuine shortfall is named, not dropped", () => {
  it("excludes a part-paid invoice from timing but counts it in shortPaidCount", () => {
    const part = invoice({ paidAmount: 40_000, feesDeducted: 0 });
    const r = calculatePaymentReliability([part]);
    expect(r.settledCount).toBe(0);
    expect(r.shortPaidCount).toBe(1);
    // Not finished, so it has no days-to-pay — but the reader can see the
    // timing figures cover nothing.
    expect(r.averageDaysToPay).toBeNull();
    expect(r.onTimeRate).toBeNull();
  });

  it("reports how many invoices the average is actually over", () => {
    // An average over one invoice read as an average over four is the
    // whole complaint in #189, in a different column.
    const r = calculatePaymentReliability([
      invoice({ lastPaymentAt: day("2026-08-11") }), // settled, 10 days
      invoice({ paidAmount: 10_000 }), // short
      invoice({ paidAmount: 10_000 }), // short
      invoice({ paidAmount: 0, lastPaymentAt: null }), // never paid
    ]);
    expect(r.invoiceCount).toBe(4);
    expect(r.settledCount).toBe(1);
    expect(r.shortPaidCount).toBe(2);
    expect(r.averageDaysToPay).toBe(10);
  });

  it("does not count an unpaid invoice as short-paid", () => {
    // Nothing arrived, so there is nothing to be short OF. Counting it
    // would make a GC who has not paid yet look like one who underpaid.
    const r = calculatePaymentReliability([invoice({ paidAmount: 0, lastPaymentAt: null })]);
    expect(r.shortPaidCount).toBe(0);
    expect(r.settledCount).toBe(0);
  });

  it("does not use a tolerance, so a real short payment is never rounded away", () => {
    // A disputed backcharge deducted at source is exactly what a sub needs
    // to see. One dollar short with no fee recorded is short.
    const r = calculatePaymentReliability([invoice({ paidAmount: 99_999, feesDeducted: 0 })]);
    expect(r.settledCount).toBe(0);
    expect(r.shortPaidCount).toBe(1);
  });
});

describe("retainage is held by contract, not paid late — issue #288", () => {
  // $100,000 billed, 10% retained, the GC paid the $90,000 an AIA G702
  // certifies as currently due. They were not late by a dollar.
  const withRetainage = invoice({ retainageWithheld: 10_000, paidAmount: 90_000 });

  it("counts an invoice settled once the GC has paid what was CERTIFIED DUE", () => {
    // THE DEFECT: isSettled compared cash against GROSS, so this could
    // never be true, the settled set was empty, and both timing figures
    // came back null for every GC who holds retainage — which is all of
    // them. The panel rendered blank and read as an unbuilt feature.
    const r = calculatePaymentReliability([withRetainage]);
    expect(r.settledCount).toBe(1);
    expect(r.onTimeRate).toBe(1);
    expect(r.averageDaysToPay).toBe(19);
  });

  it("does not report a GC who paid exactly right as having short-paid", () => {
    // Worse than the blank panel, and the half that would have survived a
    // narrower fix: these invoices were landing in shortPaidCount, so a GC
    // paying to the penny was reported as short on every invoice they had
    // ever settled.
    expect(calculatePaymentReliability([withRetainage]).shortPaidCount).toBe(0);
  });

  it("still ages a GC who is short of even the net amount", () => {
    // $85,000 against $90,000 due. Five thousand really is owed, and a fix
    // that simply excused retainage-bearing invoices would swallow it.
    const short = invoice({ retainageWithheld: 10_000, paidAmount: 85_000 });
    const r = calculatePaymentReliability([short]);
    expect(r.settledCount).toBe(0);
    expect(r.shortPaidCount).toBe(1);
  });

  it("combines with the fee rule rather than replacing it", () => {
    // Both deductions at once: $90,000 due, a platform took $220 of it, so
    // $89,780 arrived. Settled. The two rules are independent and #189's
    // has to keep working inside #288's.
    const r = calculatePaymentReliability([
      invoice({ retainageWithheld: 10_000, paidAmount: 89_780, feesDeducted: 220 }),
    ]);
    expect(r.settledCount).toBe(1);
    expect(r.shortPaidCount).toBe(0);
  });

  it("keeps outstandingTotal gross, and names what the timings excluded", () => {
    // The money is not written off — it is still outstanding, it is just
    // not LATE. And the panel has to be able to say how much of the
    // billed total these timings were not asked about.
    const r = calculatePaymentReliability([withRetainage]);
    expect(r.outstandingTotal).toBe(10_000);
    expect(r.retainageExcluded).toBe(10_000);
  });

  it("treats no retainage terms as no subtraction", () => {
    // Null is not zero as a claim, but it is zero as arithmetic — and a
    // GC on a job with no retainage rate must be judged exactly as before.
    const r = calculatePaymentReliability([invoice({ retainageWithheld: null, paidAmount: 99_999 })]);
    expect(r.settledCount).toBe(0);
    expect(r.retainageExcluded).toBe(0);
  });
});

describe("the timing figures themselves", () => {
  it("averages days from issued to the last payment, across settled invoices only", () => {
    const r = calculatePaymentReliability([
      invoice({ issuedAt: day("2026-08-01"), lastPaymentAt: day("2026-08-11") }), // 10
      invoice({ issuedAt: day("2026-08-01"), lastPaymentAt: day("2026-08-31") }), // 30
    ]);
    expect(r.averageDaysToPay).toBe(20);
  });

  it("counts on-time only against invoices that HAVE a due date", () => {
    const r = calculatePaymentReliability([
      invoice({ dueAt: day("2026-08-31"), lastPaymentAt: day("2026-08-20") }), // on time
      invoice({ dueAt: day("2026-08-31"), lastPaymentAt: day("2026-09-10") }), // late
      invoice({ dueAt: null, lastPaymentAt: day("2026-09-30") }), // no opinion
    ]);
    expect(r.onTimeRate).toBe(0.5);
    expect(r.settledCount).toBe(3);
  });

  it("is null rather than zero when nothing has settled", () => {
    // Zero would read as "they always pay late". Null reads as "no answer
    // yet", which is the true statement.
    const r = calculatePaymentReliability([invoice({ paidAmount: 0, lastPaymentAt: null })]);
    expect(r.averageDaysToPay).toBeNull();
    expect(r.onTimeRate).toBeNull();
  });

  it("returns an empty-but-honest shape for a GC with no invoices", () => {
    const r = calculatePaymentReliability([]);
    expect(r).toEqual({
      invoiceCount: 0,
      invoicedTotal: 0,
      paidTotal: 0,
      outstandingTotal: 0,
      onTimeRate: null,
      averageDaysToPay: null,
      settledCount: 0,
      shortPaidCount: 0,
      retainageExcluded: 0,
    });
  });
});
