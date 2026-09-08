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

export interface ReliabilityInvoiceInput {
  amount: number;
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
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** An invoice is settled when cash received plus what a platform took in
 * transit covers what was billed.
 *
 * Deliberately NOT a tolerance ("within a dollar"). A tolerance is a
 * number somebody picks, and it would swallow a real short payment of
 * that size — a disputed backcharge deducted at source is exactly the
 * thing a sub needs to see, not round away. This asks a question with a
 * real answer instead: was the balance taken by a fee, or is it still owed?
 */
function isSettled(invoice: ReliabilityInvoiceInput): boolean {
  return invoice.paidAmount + invoice.feesDeducted >= invoice.amount;
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
    outstandingTotal: invoicedTotal - paidTotal,
    onTimeRate,
    averageDaysToPay,
    settledCount: settled.length,
    shortPaidCount: shortPaid.length,
  };
}
