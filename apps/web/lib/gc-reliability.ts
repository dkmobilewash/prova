// Payment reliability for a GC — pure arithmetic over that GC's existing
// invoices/payments (across all their jobs), same rule as lib/wip.ts: a
// figure like this has to be exactly reproducible, so it's plain
// TypeScript, computed at read time, and never stored on Contact itself.

export interface ReliabilityInvoiceInput {
  amount: number;
  issuedAt: Date;
  dueAt: Date | null;
  /** Sum of that invoice's payments. */
  paidAmount: number;
  /** The latest payment's receivedAt, or null if nothing's been paid. */
  lastPaymentAt: Date | null;
}

export interface PaymentReliability {
  invoiceCount: number;
  invoicedTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  /** Share of fully-paid invoices (with a due date) paid on or before it.
   * Null when there's no fully-paid invoice with a due date to judge. */
  onTimeRate: number | null;
  /** Average days from issued to fully paid, across fully-paid invoices.
   * Null when nothing's been fully paid yet. */
  averageDaysToPay: number | null;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function calculatePaymentReliability(invoices: ReliabilityInvoiceInput[]): PaymentReliability {
  const invoicedTotal = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const paidTotal = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);

  const fullyPaid = invoices.filter((inv) => inv.paidAmount >= inv.amount && inv.lastPaymentAt);

  const withDueDate = fullyPaid.filter((inv) => inv.dueAt);
  const onTimeRate =
    withDueDate.length === 0
      ? null
      : withDueDate.filter((inv) => inv.lastPaymentAt! <= inv.dueAt!).length / withDueDate.length;

  const averageDaysToPay =
    fullyPaid.length === 0
      ? null
      : fullyPaid.reduce((sum, inv) => sum + (inv.lastPaymentAt!.getTime() - inv.issuedAt.getTime()) / MS_PER_DAY, 0) /
        fullyPaid.length;

  return {
    invoiceCount: invoices.length,
    invoicedTotal,
    paidTotal,
    outstandingTotal: invoicedTotal - paidTotal,
    onTimeRate,
    averageDaysToPay,
  };
}
