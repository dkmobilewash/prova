import { describe, expect, it } from "vitest";
import { cashReceived, readPaymentEntry } from "./payment-entry";
import { calculatePaymentReliability, type ReliabilityInvoiceInput } from "@/lib/gc-reliability";

/**
 * The two fields `LogPaymentForm` did not have, and the number the fee
 * columns were added for and nothing derived.
 *
 * Every test here names the wrong behaviour it exists to catch, and every
 * one was verified by putting that behaviour back and watching this file
 * go red — mutation log in the PR.
 *
 * These are pure-function tests because the app's unit suite has no
 * database (vitest.config.mts). `logPayment` itself is exercised against a
 * real Postgres in lib/actions/billing.dbtest.ts, which CI does not run.
 */

const NOW = new Date("2026-09-16T19:30:00.000Z");

function entry(over: Partial<Parameters<typeof readPaymentEntry>[0]> = {}) {
  return readPaymentEntry({
    receivedAtRaw: "2026-09-02",
    feeRaw: "",
    feeSourceRaw: "",
    amountCents: 10_000_000, // $100,000 applied to the invoice
    now: NOW,
    ...over,
  });
}

function ok(result: ReturnType<typeof readPaymentEntry>) {
  if (!result.ok) throw new Error(`expected ok, got refusal: ${result.error}`);
  return result.value;
}

describe("the received date is entered, not stamped", () => {
  it("stores the day a person typed, at UTC midnight", () => {
    // THE DEFECT. receivedAt was @default(now()), so a cheque that sat in
    // the mail for a fortnight was recorded as received today — and that
    // is what QuickBooks got as TxnDate (lib/quickbooks-payment-sync.ts),
    // so the two systems disagreed and the reconciliation report showed a
    // discrepancy that was not real.
    const value = ok(entry({ receivedAtRaw: "2026-09-02" }));
    expect(value.receivedAt.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(value.receivedAt.getTime()).not.toBe(NOW.getTime());
  });

  it("falls back to the moment of the click only when nothing was entered", () => {
    // Deliberate, and the same fallback createRetainageRelease keeps three
    // functions away: a caller that does not send the field is not
    // silently broken. The form always sends one.
    expect(ok(entry({ receivedAtRaw: "" })).receivedAt.getTime()).toBe(NOW.getTime());
  });

  it("refuses something that is not a calendar date", () => {
    const result = entry({ receivedAtRaw: "last tuesday" });
    expect(result.ok).toBe(false);
  });

  it("refuses a date that does not exist rather than rolling it forward", () => {
    // `new Date("2026-02-31")` is 2 March, silently. A payment dated a day
    // that never happened would be stored as a different day than the one
    // on the remittance.
    const result = entry({ receivedAtRaw: "2026-02-31" });
    expect(result.ok).toBe(false);
  });

  it("accepts a date one day ahead of UTC, because a reader's calendar can be", () => {
    // The form's default comes from the READER's calendar
    // (components/localToday.ts) and UTC+14 exists, so a legitimate entry
    // can be tomorrow in UTC. Refusing it would reject a correct date.
    expect(entry({ receivedAtRaw: "2026-09-17" }).ok).toBe(true);
  });

  it("refuses a date further ahead than any calendar can be", () => {
    expect(entry({ receivedAtRaw: "2026-09-18" }).ok).toBe(false);
    expect(entry({ receivedAtRaw: "2062-09-02" }).ok).toBe(false);
  });
});

describe("a platform fee, and the cash it leaves behind", () => {
  it("records the fee and who took it", () => {
    const value = ok(entry({ feeRaw: "220", feeSourceRaw: " Textura " }));
    expect(value.feeAmount).toBe("220.00");
    expect(value.feeSource).toBe("Textura");
  });

  it("derives cash received as amount minus fee", () => {
    // Textura is 0.22% of contract value, charged to the SUB on a platform
    // the GC chose. $100,000 applied to the invoice, $220 taken in
    // transit, $99,780 in the bank.
    expect(cashReceived(100_000, 220)).toBe(99_780);
  });

  it("derives cash received in cents, so the cent case does not drift", () => {
    // `100000.04 - 220.22` in floats is 99779.81999999999, which
    // `money()` renders as $99,779.82 — but any comparison, any sum of
    // several of these, and any round-trip through a Decimal carries the
    // error. The realistic case, not a contrived one: a pay application
    // with cents on it and a Textura fee.
    expect(cashReceived(100_000.04, 220.22)).toBe(99_779.82);
  });

  it("is the full amount when no fee was taken", () => {
    expect(cashReceived(100_000, null)).toBe(100_000);
  });

  it("stores a zero fee as no fee", () => {
    // Everything that reads these columns spells it `feeAmount ?? 0`, so a
    // recorded zero and an absent fee are the same arithmetic. A row
    // claiming a fee of nothing is noise.
    const value = ok(entry({ feeRaw: "0" }));
    expect(value.feeAmount).toBeNull();
  });

  it("refuses a negative fee", () => {
    expect(entry({ feeRaw: "-220" }).ok).toBe(false);
  });

  it("refuses a fee that swallows the whole payment", () => {
    // The amount is the GROSS applied to the invoice, before the fee — see
    // Payment.amount in billing.prisma. A fee at or above it means one of
    // the two numbers is the wrong one, most likely a net cheque typed
    // into the amount box.
    const result = entry({ feeRaw: "100000", amountCents: 10_000_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("applied to the invoice");
  });

  it("refuses naming who took a fee without saying how much", () => {
    // Dropping the name silently would lose the only thing typed about the
    // fee; storing it with no amount records a fee of unknown size, which
    // reads as no fee everywhere downstream.
    const result = entry({ feeRaw: "", feeSourceRaw: "Textura" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Textura");
  });

  it("refuses a fee that is not a number", () => {
    expect(entry({ feeRaw: "a bit" }).ok).toBe(false);
  });
});

/**
 * WHAT A RECORDED FEE DOES TO THE GC RELIABILITY FIGURES — and this is a
 * correction to the brief this branch was written from, which said the
 * figures "move when a fee is present". Under the convention the schema
 * mandates they do not, and the tests below are what that actually looks
 * like. See lib/billing/payment-entry.ts's header for the evidence.
 */
describe("the recorded fee and lib/gc-reliability.ts", () => {
  const base: ReliabilityInvoiceInput = {
    amount: 100_000,
    issuedAt: new Date("2026-08-01T00:00:00.000Z"),
    dueAt: new Date("2026-08-31T00:00:00.000Z"),
    paidAmount: 100_000,
    feesDeducted: 0,
    // Null, not 0, and the distinction is the point: this fixture is a job
    // with NO retainage terms, so there is nothing to withhold. A 0 would
    // say "terms that withheld nothing this period", which is a different
    // claim and would make these fee assertions read as a statement about
    // retainage behaviour that they are not making. Added when #288 made
    // the field required on this type — the two branches were each green
    // alone and only disagreed once merged.
    retainageWithheld: null,
    lastPaymentAt: new Date("2026-08-20T00:00:00.000Z"),
  };

  it("leaves the timing figures alone when the full amount was applied", () => {
    // Because `amount` is the GROSS — what was applied to the invoice —
    // the invoice already settles without the fee term. What the fee
    // changes is that the $220 exists in the system at all, and that cash
    // received is derivable. It does NOT move settledCount or onTimeRate.
    const withoutFee = calculatePaymentReliability([base]);
    const withFee = calculatePaymentReliability([{ ...base, feesDeducted: 220 }]);
    expect(withFee.settledCount).toBe(withoutFee.settledCount);
    expect(withFee.onTimeRate).toBe(withoutFee.onTimeRate);
    expect(withFee.averageDaysToPay).toBe(withoutFee.averageDaysToPay);
  });

  it("does move them for the net-cheque shape the fee field replaces", () => {
    // This is the shape gc-reliability.ts was written against and the one
    // the fee field exists to make unnecessary: before there was anywhere
    // to put the fee, the natural entry was the cheque that arrived, and
    // the invoice then read as short-paid forever.
    const cheque = { ...base, paidAmount: 99_780, feesDeducted: 0 };
    expect(calculatePaymentReliability([cheque]).shortPaidCount).toBe(1);
    expect(calculatePaymentReliability([cheque]).settledCount).toBe(0);

    const withFee = calculatePaymentReliability([{ ...cheque, feesDeducted: 220 }]);
    expect(withFee.shortPaidCount).toBe(0);
    expect(withFee.settledCount).toBe(1);
  });

  it("settles a payment short by less than the fee — a limit, not a feature", () => {
    // STATED OUT LOUD rather than left to be discovered. `isSettled` is
    // `paidAmount + feesDeducted >= amount`, which is tolerant of both
    // conventions; with gross amounts the fee term is slack, so a genuine
    // shortfall smaller than the recorded fee reads as settled. Unreachable
    // until a form wrote a fee, which is what this branch did.
    const disputed = { ...base, paidAmount: 99_900, feesDeducted: 220 };
    expect(calculatePaymentReliability([disputed]).settledCount).toBe(1);
    expect(calculatePaymentReliability([disputed]).shortPaidCount).toBe(0);
    // Without the fee it is correctly counted as unfinished.
    expect(calculatePaymentReliability([{ ...disputed, feesDeducted: 0 }]).shortPaidCount).toBe(1);
  });
});
