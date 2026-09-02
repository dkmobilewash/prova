import {
  amountToCents,
  centsToAmount,
  formatUsd,
  type Cents,
  type VerificationResult,
} from "./quickbooks-sync";

/**
 * Pushing a Prova `Payment` to QuickBooks as a Payment applied to an invoice.
 *
 * WHY THIS EXISTS AT ALL, WHICH IS THE WHOLE POINT
 *
 * Invoices have pushed since #31. Payments never have. So QuickBooks has
 * been carrying every invoice this app ever sent as fully outstanding,
 * forever: accounts receivable overstated by the entire amount collected,
 * and an aging report that is fiction. A bookkeeper opening that file would
 * not call the sync "partial" — they would call it wrong, and they would be
 * right. Invoices without payments is the worst of the three states,
 * because both halves look healthy on their own.
 *
 * NO NEW OAUTH SCOPE IS NEEDED, and it is worth writing down why, because
 * the client's own comment reads as though one is. That comment refers to
 * QuickBooks PAYMENTS — Intuit's card-processing product, scope
 * `com.intuit.quickbooks.payment`, which this app deliberately does not use
 * because it does not charge cards. The Payment ENTITY in the Accounting
 * API is covered by `com.intuit.quickbooks.accounting`, which the existing
 * connection already holds. Nobody re-consents, and the redirect-URI trap
 * in CLAUDE.md does not fire.
 *
 * Everything here is pure and takes its inputs as arguments, same as
 * quickbooks-sync.ts, so the arithmetic that decides what a GC is recorded
 * as having paid can be tested without a database or Intuit.
 */

export type PaymentToPush = {
  paymentId: string;
  invoiceId: string;
  amountCents: Cents;
  /** Entered by a person — when the money actually arrived, not when it was
   * typed in. Rendered as a UTC calendar date, same rule as every other
   * date in this app. */
  receivedAt: Date;
  /** Free text in Prova ("check 4417", "ACH"). See buildPaymentPayload for
   * why it does not become a QuickBooks PaymentMethodRef. */
  method: string | null;
  note: string | null;
  /** The GC, already linked to a QuickBooks customer. */
  customerQboId: string;
  /** The QuickBooks invoice this pays. Its presence is the precondition:
   * a payment cannot be applied to a document QuickBooks does not have. */
  invoiceQboId: string;
};

export type QboPaymentPayload = {
  CustomerRef: { value: string };
  TotalAmt: number;
  TxnDate: string;
  PrivateNote?: string;
  DepositToAccountRef?: { value: string };
  Line: {
    Amount: number;
    LinkedTxn: { TxnId: string; TxnType: "Invoice" }[];
  }[];
  /** Present only on an update. Same rule as the invoice push: QuickBooks
   * rejects an update that does not carry the record's current SyncToken. */
  Id?: string;
  SyncToken?: string;
};

/** UTC calendar date. The instant is not what an accountant is recording —
 * the day the money arrived is. */
export function txnDateFor(receivedAt: Date): string {
  return receivedAt.toISOString().slice(0, 10);
}

/**
 * Stable across retries of the same payment, different the moment its money
 * or its target changes.
 *
 * The invoice key includes a line fingerprint because an invoice's shape can
 * change underneath it. A payment has no lines of its own — what can change
 * is the amount, or which QuickBooks invoice it lands on — so those are what
 * the key carries.
 */
export function paymentIdempotencyKeyFor(payment: PaymentToPush): string {
  return ["payment", payment.paymentId, payment.amountCents, payment.invoiceQboId].join(":");
}

/**
 * What must be true before a payment push is attempted.
 *
 * The first one is the ordering constraint that makes this whole feature
 * conditional: a payment is APPLIED to an invoice, so the invoice has to
 * exist in QuickBooks first. Prova's own order of operations already
 * guarantees this in practice — you cannot record a payment against an
 * invoice you never sent — but "in practice" is not a check, and a payment
 * that silently vanished because its invoice had not synced yet would be
 * the exact silent divergence this integration exists to prevent.
 */
export function paymentPushBlockers(input: {
  hasConnection: boolean;
  customerQboId: string | null;
  invoiceQboId: string | null;
  amountCents: Cents;
}): string[] {
  const blockers: string[] = [];
  if (!input.hasConnection) blockers.push("QuickBooks isn't connected.");
  if (!input.invoiceQboId) {
    blockers.push(
      "This payment's invoice hasn't reached QuickBooks yet — push the invoice first.",
    );
  }
  if (!input.customerQboId) {
    blockers.push("This job's GC isn't linked to a QuickBooks customer yet.");
  }
  if (input.amountCents <= 0) {
    blockers.push("A payment of zero or less can't be pushed.");
  }
  return blockers;
}

/**
 * Builds the QuickBooks Payment payload.
 *
 * TWO DELIBERATE OMISSIONS.
 *
 * `method` does NOT become a PaymentMethodRef. QuickBooks wants the id of a
 * PaymentMethod entity in the company file; Prova stores free text a person
 * typed. Mapping one to the other means guessing that "check 4417" means the
 * PaymentMethod named "Check", and guessing wrong writes a false fact into
 * someone's books. It rides in PrivateNote instead, where a bookkeeper reads
 * it and decides. A mapping screen for this is a real feature; inventing the
 * mapping is not.
 *
 * `DepositToAccountRef` is optional rather than required. Left out,
 * QuickBooks deposits to Undeposited Funds, which is the correct default for
 * a payment that has not been taken to the bank yet — refusing to push
 * without a mapped account would block a correct push over a preference.
 *
 * And the amount is sent whole. If it exceeds the invoice's balance
 * QuickBooks records the remainder as a customer credit, which is what an
 * overpayment IS; trimming it to the balance would quietly lose money that a
 * GC actually sent.
 */
export function buildPaymentPayload(
  payment: PaymentToPush,
  options: { depositAccountId?: string | null; existing?: { qboId: string; syncToken: string } },
): QboPaymentPayload {
  const noteParts = [
    `Prova payment ${payment.paymentId.slice(-6).toUpperCase()}`,
    payment.method ? `Method: ${payment.method}` : null,
    payment.note,
  ].filter((part): part is string => Boolean(part && part.trim()));

  const payload: QboPaymentPayload = {
    CustomerRef: { value: payment.customerQboId },
    TotalAmt: centsToAmount(payment.amountCents),
    TxnDate: txnDateFor(payment.receivedAt),
    PrivateNote: noteParts.join(" · "),
    Line: [
      {
        Amount: centsToAmount(payment.amountCents),
        LinkedTxn: [{ TxnId: payment.invoiceQboId, TxnType: "Invoice" }],
      },
    ],
  };

  if (options.depositAccountId) {
    payload.DepositToAccountRef = { value: options.depositAccountId };
  }
  if (options.existing) {
    payload.Id = options.existing.qboId;
    payload.SyncToken = options.existing.syncToken;
  }
  return payload;
}

export type QboPaymentReadback = {
  Id: string;
  SyncToken?: string;
  TotalAmt?: number;
  Line?: { Amount?: number; LinkedTxn?: { TxnId?: string; TxnType?: string }[] }[];
};

/**
 * Did the payment land as the amount we sent, against the invoice we meant?
 *
 * The second half is the one that matters and has no equivalent on the
 * invoice side. A payment recorded for the right money against the WRONG
 * invoice is worse than a failed push: both documents look settled, the
 * wrong one is marked paid, and the real one keeps aging. Nothing on either
 * screen would show it.
 */
export function verifyPushedPayment(
  sent: QboPaymentPayload,
  got: QboPaymentReadback,
): VerificationResult {
  const problems: string[] = [];

  const sentTotal = amountToCents(sent.TotalAmt);
  const gotTotal =
    got.TotalAmt !== undefined
      ? amountToCents(got.TotalAmt)
      : (got.Line ?? []).reduce((sum, l) => sum + amountToCents(l.Amount ?? 0), 0);

  if (sentTotal !== gotTotal) {
    problems.push(
      `Amount differs: sent ${formatUsd(sentTotal)}, QuickBooks holds ${formatUsd(gotTotal)}.`,
    );
  }

  const sentInvoiceId = sent.Line[0]?.LinkedTxn[0]?.TxnId;
  const gotInvoiceIds = (got.Line ?? [])
    .flatMap((l) => l.LinkedTxn ?? [])
    .filter((t) => t.TxnType === "Invoice")
    .map((t) => t.TxnId);

  if (got.Line !== undefined && sentInvoiceId && !gotInvoiceIds.includes(sentInvoiceId)) {
    problems.push(
      `Applied to the wrong invoice: sent it against ${sentInvoiceId}, QuickBooks applied it to ` +
        `${gotInvoiceIds.length > 0 ? gotInvoiceIds.join(", ") : "nothing"}.`,
    );
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
