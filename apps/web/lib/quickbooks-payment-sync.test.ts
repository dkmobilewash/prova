import { describe, expect, it } from "vitest";
import {
  buildPaymentPayload,
  paymentIdempotencyKeyFor,
  paymentPushBlockers,
  txnDateFor,
  verifyPushedPayment,
  type PaymentToPush,
} from "./quickbooks-payment-sync";

const payment = (over: Partial<PaymentToPush> = {}): PaymentToPush => ({
  paymentId: "cm_pay_abc123",
  invoiceId: "cm_inv_zzz",
  amountCents: 4_825_000,
  receivedAt: new Date("2026-08-14T00:00:00.000Z"),
  method: "Check 4417",
  note: null,
  customerQboId: "58",
  invoiceQboId: "1042",
  ...over,
});

describe("blockers", () => {
  it("refuses a payment whose invoice is not in QuickBooks yet", () => {
    // The ordering constraint. A payment is applied TO an invoice, so
    // pushing one first would either fail at Intuit or, worse, record an
    // unapplied credit that nobody reconciles.
    const blockers = paymentPushBlockers({
      hasConnection: true,
      customerQboId: "58",
      invoiceQboId: null,
      amountCents: 100,
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/invoice hasn't reached QuickBooks/i);
  });

  it("names every missing precondition rather than the first", () => {
    // The UI prints these. Fixing one and being told about the next is how
    // a setup screen wastes somebody's afternoon.
    const blockers = paymentPushBlockers({
      hasConnection: false,
      customerQboId: null,
      invoiceQboId: null,
      amountCents: 0,
    });
    expect(blockers).toHaveLength(4);
  });

  it("passes when everything is in place", () => {
    expect(
      paymentPushBlockers({
        hasConnection: true,
        customerQboId: "58",
        invoiceQboId: "1042",
        amountCents: 4_825_000,
      }),
    ).toEqual([]);
  });
});

describe("idempotency", () => {
  it("is stable across retries of the same payment", () => {
    expect(paymentIdempotencyKeyFor(payment())).toBe(paymentIdempotencyKeyFor(payment()));
  });

  it("changes when the amount is corrected", () => {
    // A retry must not duplicate; an edit must not be mistaken for a retry.
    expect(paymentIdempotencyKeyFor(payment())).not.toBe(
      paymentIdempotencyKeyFor(payment({ amountCents: 4_825_001 })),
    );
  });

  it("changes when it is applied to a different QuickBooks invoice", () => {
    expect(paymentIdempotencyKeyFor(payment())).not.toBe(
      paymentIdempotencyKeyFor(payment({ invoiceQboId: "1043" })),
    );
  });

  it("does not change when only the note is edited", () => {
    // A typo fixed in a memo is not a new financial fact and must not cause
    // a second document.
    expect(paymentIdempotencyKeyFor(payment())).toBe(
      paymentIdempotencyKeyFor(payment({ note: "corrected memo" })),
    );
  });
});

describe("the payload", () => {
  it("applies the whole amount against the invoice", () => {
    const built = buildPaymentPayload(payment(), {});
    expect(built.TotalAmt).toBe(48250);
    expect(built.Line).toHaveLength(1);
    expect(built.Line[0].Amount).toBe(48250);
    expect(built.Line[0].LinkedTxn).toEqual([{ TxnId: "1042", TxnType: "Invoice" }]);
    expect(built.CustomerRef).toEqual({ value: "58" });
  });

  it("does not send a PaymentMethodRef, and keeps the method readable", () => {
    // Prova stores free text; QuickBooks wants an entity id. Guessing the
    // mapping writes a false fact into someone's books.
    const built = buildPaymentPayload(payment(), {});
    expect(JSON.stringify(built)).not.toContain("PaymentMethodRef");
    expect(built.PrivateNote).toContain("Check 4417");
  });

  it("omits the deposit account when none is mapped", () => {
    // QuickBooks then uses Undeposited Funds, which is correct for money
    // not yet taken to the bank. Refusing to push would block a good push.
    expect(buildPaymentPayload(payment(), {}).DepositToAccountRef).toBeUndefined();
    expect(
      buildPaymentPayload(payment(), { depositAccountId: "35" }).DepositToAccountRef,
    ).toEqual({ value: "35" });
  });

  it("carries Id and SyncToken only when updating", () => {
    // QuickBooks rejects an update without the record's current SyncToken,
    // and treats a payload without an Id as a create.
    const created = buildPaymentPayload(payment(), {});
    expect(created.Id).toBeUndefined();
    expect(created.SyncToken).toBeUndefined();

    const updated = buildPaymentPayload(payment(), {
      existing: { qboId: "77", syncToken: "3" },
    });
    expect(updated.Id).toBe("77");
    expect(updated.SyncToken).toBe("3");
  });

  it("sends the date the money arrived, in UTC", () => {
    expect(txnDateFor(new Date("2026-08-14T23:30:00.000Z"))).toBe("2026-08-14");
    expect(buildPaymentPayload(payment(), {}).TxnDate).toBe("2026-08-14");
  });

  it("survives a payment with no method and no note", () => {
    const built = buildPaymentPayload(payment({ method: null, note: null }), {});
    expect(built.PrivateNote).toBe("Prova payment ABC123");
  });
});

describe("verification", () => {
  const sent = buildPaymentPayload(payment(), {});

  it("passes when the amount and the linked invoice both match", () => {
    expect(
      verifyPushedPayment(sent, {
        Id: "77",
        TotalAmt: 48250,
        Line: [{ Amount: 48250, LinkedTxn: [{ TxnId: "1042", TxnType: "Invoice" }] }],
      }),
    ).toEqual({ ok: true });
  });

  it("catches an amount QuickBooks changed", () => {
    const result = verifyPushedPayment(sent, {
      Id: "77",
      TotalAmt: 4825,
      Line: [{ Amount: 4825, LinkedTxn: [{ TxnId: "1042", TxnType: "Invoice" }] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/Amount differs/);
  });

  it("CATCHES A PAYMENT APPLIED TO THE WRONG INVOICE", () => {
    // The failure with no symptom: right money, wrong document. The wrong
    // invoice reads as settled and the real one keeps aging, and nothing on
    // either screen would ever say so.
    const result = verifyPushedPayment(sent, {
      Id: "77",
      TotalAmt: 48250,
      Line: [{ Amount: 48250, LinkedTxn: [{ TxnId: "999", TxnType: "Invoice" }] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/wrong invoice/i);
  });

  it("catches a payment QuickBooks applied to nothing", () => {
    const result = verifyPushedPayment(sent, { Id: "77", TotalAmt: 48250, Line: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/applied it to nothing/i);
  });

  it("does not invent a problem when the read-back omits lines", () => {
    // A thin read-back is not evidence of a mismatch, and a check that cries
    // wolf is a check people learn to ignore.
    expect(verifyPushedPayment(sent, { Id: "77", TotalAmt: 48250 })).toEqual({ ok: true });
  });
});
