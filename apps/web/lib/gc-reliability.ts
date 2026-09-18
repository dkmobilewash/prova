// Payment reliability for a GC — pure arithmetic over that GC's existing
// invoices/payments (across all their jobs), same rule as lib/wip.ts: a
// figure like this has to be exactly reproducible, so it's plain
// TypeScript, computed at read time, and never stored on Contact itself.
//
// THE DEFECT THIS FILE CARRIED, and why the fix is shaped this way —
// issue #189. `fullyPaid` was `paidAmount >= amount`, and the timing
// figures were computed over only those. So an invoice short by ANY
// amount was not counted as late; it was not counted AT ALL.
//
// A subcontractor paid through Textura, GC Pay or Procore Pay receives the
// invoice amount LESS a platform fee — charged to the sub, on a platform
// the GC chose. Record the cheque that actually arrived and `paidAmount`
// is permanently short, so that invoice silently left the sample.
//
//   A general contractor whose chosen platform skims the subcontractor
//   therefore scored BETTER here than one who paid by cheque.
//
// Exactly backwards, and worst for the GCs a sub most needs warning about.
// The number still rendered; it just described a smaller and more
// flattering set of invoices than any reader would assume.
//
// Two changes close it, and they answer two different questions:
//
//   1. A fee is not a shortfall. `Payment.feeAmount` exists now, so an
//      invoice settles when cash plus what was skimmed in transit covers
//      it. The GC paid; a third party took a cut on the way.
//   2. A genuine shortfall is REPORTED rather than dropped. Anything with
//      payments that still does not settle is counted in
//      `shortPaidCount`, so a reader can see the sample is partial. This
//      repo names what it cannot compute rather than hiding it —
//      `hasUncomputedHours`, "Name not recorded" — and a timing average
//      over an unstated subset is the same failure in a different column.
//
// THE SAME DEFECT CAME BACK THROUGH A THIRD DOOR — issue #288, and #189's
// fix could not see it. `isSettled` compared cash against the GROSS invoice
// amount, and retainage is a slice of gross the GC is entitled to hold
// until substantial completion. So an invoice with retainage on it could
// never settle, however promptly the GC paid what was certified due, and
// the timing figures were computed over an EMPTY SET: onTimeRate and
// averageDaysToPay came back null for every GC who holds retainage, which
// is all of them. The panel rendered blank and looked like a feature that
// had not been built.
//
// Worse than #189's version, because #189 at least counted the
// fee-shortened invoices somewhere: these landed in `shortPaidCount`,
// so a GC paying exactly right was reported as having SHORT-PAID every
// invoice they had ever settled.

export interface ReliabilityInvoiceInput {
  /** Invoice.amount -- GROSS, retainage included. */
  amount: number;
  /** Invoice.retainageWithheld: the slice of `amount` held back until
   * substantial completion. Null when the job has no retainage terms.
   * Subtracted from what the GC has to cover for this invoice to count as
   * settled -- retainage arrives later, as a RetainageRelease, and is not
   * a payment this GC is late on. */
  retainageWithheld: number | null;
  issuedAt: Date;
  dueAt: Date | null;
  /** Sum of that invoice's payments — cash actually applied. */
  paidAmount: number;
  /** Sum of `Payment.feeAmount` across that invoice's payments: what a
   * payment platform deducted in transit. Zero for a cheque, and zero for
   * every row recorded before the column existed, which is why this is a
   * number rather than a nullable — an unknown fee and no fee are the
   * same arithmetic here, and pretending otherwise would put a `null`
   * into a sum. */
  feesDeducted: number;
  /** The latest payment's receivedAt, or null if nothing's been paid. */
  lastPaymentAt: Date | null;
}

export interface PaymentReliability {
  invoiceCount: number;
  invoicedTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  /** Share of settled invoices (with a due date) paid on or before it.
   * Null when there's no settled invoice with a due date to judge. */
  onTimeRate: number | null;
  /** Average days from issued to settled, across settled invoices.
   * Null when nothing has settled yet. */
  averageDaysToPay: number | null;
  /** How many invoices the timing figures are computed over. Reported so
   * an average over three invoices is not read as an average over thirty. */
  settledCount: number;
  /** Invoices with payments against them that still do not settle even
   * after counting fees. These are excluded from the timing figures
   * because they are not finished — but they are NAMED here rather than
   * silently dropped, which is the whole of issue #189. */
  shortPaidCount: number;
  /** Retainage subtracted from what these invoices had to be paid to count
   * as settled. The timing figures above are about how promptly this GC
   * pays what is CERTIFIED DUE; this much is money they are still holding,
   * legitimately, and no lateness is being claimed about it either way.
   * Reported so the panel can say so instead of leaving a reader to assume
   * the on-time rate covers every dollar billed. */
  retainageExcluded: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Whole cents at the settlement boundary, for the reason
 * lib/cash-flow.ts spells out: this is now a three-term comparison of
 * Decimal(12,2) values round-tripped through JS numbers, and a tenth of a
 * cent of float dust decides whether an invoice is finished. */
function cents(value: number): number {
  return Math.round(value * 100);
}

/** What the GC has to cover for this invoice to be finished: gross less
 * the retainage they are entitled to hold until substantial completion. */
function amountDue(invoice: ReliabilityInvoiceInput): number {
  return invoice.amount - (invoice.retainageWithheld ?? 0);
}

/** An invoice is settled when cash received plus what a platform took in
 * transit covers what was DUE — gross less retainage.
 *
 * Deliberately NOT a tolerance ("within a dollar"). A tolerance is a
 * number somebody picks, and it would swallow a real short payment of
 * that size — a disputed backcharge deducted at source is exactly the
 * thing a sub needs to see, not round away. This asks a question with a
 * real answer instead: was the balance taken by a fee, held back as
 * retainage, or is it still owed?
 */
function isSettled(invoice: ReliabilityInvoiceInput): boolean {
  return cents(invoice.paidAmount) + cents(invoice.feesDeducted) >= cents(amountDue(invoice));
}

export function calculatePaymentReliability(invoices: ReliabilityInvoiceInput[]): PaymentReliability {
  const invoicedTotal = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  // Cash, not cash-plus-fees. What the sub actually banked is the honest
  // answer to "how much have they paid me", and the fee is somebody
  // else's revenue rather than the GC's payment.
  const paidTotal = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);

  const settled = invoices.filter((inv) => isSettled(inv) && inv.lastPaymentAt);

  // Something was paid, and it still does not cover the invoice. Not late
  // — unfinished — and the reason the timing figures below cover fewer
  // invoices than a reader might assume.
  const shortPaid = invoices.filter(
    (inv) => inv.lastPaymentAt != null && !isSettled(inv),
  );

  const withDueDate = settled.filter((inv) => inv.dueAt);
  const onTimeRate =
    withDueDate.length === 0
      ? null
      : withDueDate.filter((inv) => inv.lastPaymentAt! <= inv.dueAt!).length / withDueDate.length;

  const averageDaysToPay =
    settled.length === 0
      ? null
      : settled.reduce((sum, inv) => sum + (inv.lastPaymentAt!.getTime() - inv.issuedAt.getTime()) / MS_PER_DAY, 0) /
        settled.length;

  return {
    invoiceCount: invoices.length,
    invoicedTotal,
    paidTotal,
    // Deliberately GROSS, and deliberately not the aging balance: "how much
    // of what I billed this GC has not reached me" is a true statement
    // about a relationship, retainage included. Whether any of it is LATE
    // is the question the timing figures answer, and that one is net.
    outstandingTotal: invoicedTotal - paidTotal,
    retainageExcluded: invoices.reduce((sum, inv) => sum + (inv.retainageWithheld ?? 0), 0),
    onTimeRate,
    averageDaysToPay,
    settledCount: settled.length,
    shortPaidCount: shortPaid.length,
  };
}
