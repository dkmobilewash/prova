/**
 * Reading the two fields `LogPaymentForm` was missing, and the one number
 * the fee columns were added for and nothing ever derived.
 *
 * Pure on purpose, and in `lib/billing/` rather than in
 * `lib/actions/billing.ts`, for the reason `invoice-number.ts` gives: that
 * file is `"use server"` and may only export async Server Actions, so
 * nothing in it can be unit-tested. The app's unit suite has no database,
 * which is why the parsing and the refusals live here where they can be
 * executed with real inputs.
 *
 * ---------------------------------------------------------------------
 * WHAT `amount` MEANS, because the repo says two different things and the
 * answer decides what a person types into the form.
 *
 * `Payment.amount`'s own schema comment settles it. It enumerates both
 * options and picks one: "record the cheque that arrived and the invoice
 * sits short forever, or record the full amount and the fee vanishes from
 * the system" — with `feeAmount` there is no longer a choice to make.
 * `amount` is what was APPLIED to the invoice, gross, before any platform
 * fee; `feeAmount` is what was taken in transit; and
 *
 *     cash received = amount - feeAmount
 *
 * is derived, never stored. That has to be the convention, because
 * `amount` is also what `invoice.amount - SUM(payments.amount)` subtracts
 * to get the balance and what QuickBooks receives as `TotalAmt`. Record
 * the net cheque there and a fully-settled $100,000 invoice shows $220
 * owing here and $220 open in QuickBooks, permanently.
 *
 * `lib/gc-reliability.ts` reads as if it expected the other convention —
 * its `paidTotal` comment says "what the sub actually banked", and its
 * test fixture is `paidAmount: 99_780, feesDeducted: 220`. That file is
 * NOT changed here (see the changelog entry); what matters for this module
 * is that the schema is the authority on what the column holds, and this
 * is what the form now writes.
 */

/** A received date this many days ahead of the server's UTC date is still
 * accepted. Not slack — a real offset: the reader's calendar can legally
 * be a day ahead of UTC (UTC+14 exists), and the form's default comes from
 * the READER's calendar via `components/localToday.ts`. One day is the
 * largest that gap can be, so this rejects a typed year or a transposed
 * month without ever refusing a date somebody is actually standing in. */
export const RECEIVED_DATE_FUTURE_GRACE_DAYS = 1;

export type PaymentEntry = {
  /** UTC midnight on the day the money arrived — the day a person typed,
   * not the moment they clicked. Stored and rendered in UTC, so the job
   * page renders it with `formatCalendarDate`, not `formatInstant`. */
  receivedAt: Date;
  /** Decimal strings, the shape Prisma takes for `@db.Decimal`, or null. */
  feeAmount: string | null;
  feeSource: string | null;
};

export type PaymentEntryResult =
  | { ok: true; value: PaymentEntry }
  | { ok: false; error: string };

function cents(value: number): number {
  return Math.round(value * 100);
}

/** Money for a sentence a user reads. Not `lib/money.ts` — that is fine
 * here too, but this module is deliberately dependency-free so the unit
 * suite executes exactly what the action executes. */
function dollars(amountCents: number): string {
  return `$${(amountCents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** UTC midnight on the day `instant` falls on, in UTC. */
function utcMidnight(instant: Date): number {
  return Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Turns the raw form fields into what `logPayment` writes, or into a
 * sentence explaining why it cannot.
 *
 * Refusals are RETURNED rather than thrown: `logPayment` promises an
 * `ActionResult`, and production redacts a thrown Server Action message to
 * a digest. Every refusal below is something a person mistyped and can
 * correct, which is exactly the case that must stay legible.
 *
 * `amountCents` is passed in rather than parsed here because the action
 * already has it — the fee has to be checked against the payment it was
 * taken out of, and a fee that swallows the whole payment means one of the
 * two numbers is wrong.
 */
export function readPaymentEntry(input: {
  receivedAtRaw: string;
  feeRaw: string;
  feeSourceRaw: string;
  amountCents: number;
  now: Date;
}): PaymentEntryResult {
  const receivedRaw = input.receivedAtRaw.trim();

  // Blank falls back to the moment of the click — the behaviour this
  // replaced, kept for the same reason `createRetainageRelease` keeps it
  // three functions away: a caller that does not send the field is not
  // silently broken. The form always sends one, so in practice this branch
  // is the Ask/CSV shape rather than a person leaving the box empty.
  let receivedAt: Date;
  if (!receivedRaw) {
    receivedAt = input.now;
  } else {
    const parsed = new Date(`${receivedRaw}T00:00:00.000Z`);
    // ONE check, not two. A `/^\d{4}-\d{2}-\d{2}$/` test in front of this
    // was here and was removed: mutation-testing it showed nothing could
    // kill it, because the round trip below already requires the input to
    // BE that shape. It catches both halves — anything unparseable (NaN)
    // and anything `new Date` silently rolls forward (2026-02-31 becomes
    // 3 March, which would store a day the remittance does not name).
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== receivedRaw) {
      return { ok: false, error: `“${receivedRaw}” is not a date this can read — use the date picker.` };
    }
    const latest = utcMidnight(input.now) + RECEIVED_DATE_FUTURE_GRACE_DAYS * DAY_MS;
    if (parsed.getTime() > latest) {
      return {
        ok: false,
        error: "A payment cannot be received in the future — check the date you entered.",
      };
    }
    receivedAt = parsed;
  }

  const feeRaw = input.feeRaw.trim();
  const feeSourceRaw = input.feeSourceRaw.trim();

  if (!feeRaw) {
    if (feeSourceRaw) {
      // Silently dropping the source would lose the only thing the person
      // typed about the fee, and storing it with no amount records a fee
      // of unknown size — which reads as no fee everywhere downstream.
      return {
        ok: false,
        error: `Enter the fee ${feeSourceRaw} took, or clear the box naming them.`,
      };
    }
    return { ok: true, value: { receivedAt, feeAmount: null, feeSource: null } };
  }

  const feeValue = Number(feeRaw);
  if (!Number.isFinite(feeValue)) {
    return { ok: false, error: "The platform fee must be a number." };
  }
  if (feeValue < 0) {
    return { ok: false, error: "A platform fee cannot be negative." };
  }

  const feeCents = cents(feeValue);

  // A recorded zero and no fee are the same arithmetic everywhere that
  // reads these columns (`feeAmount ?? 0`), so a zero is stored as absent
  // rather than as a row claiming a fee of nothing.
  if (feeCents === 0) {
    return { ok: true, value: { receivedAt, feeAmount: null, feeSource: null } };
  }

  if (feeCents >= input.amountCents) {
    return {
      ok: false,
      error:
        `A ${dollars(feeCents)} fee on a ${dollars(input.amountCents)} payment would leave ` +
        "nothing received. The amount is what was applied to the invoice, before the fee.",
    };
  }

  return {
    ok: true,
    value: {
      receivedAt,
      feeAmount: (feeCents / 100).toFixed(2),
      feeSource: feeSourceRaw || null,
    },
  };
}

/**
 * What actually reached the bank: what was applied to the invoice, less
 * what a platform took on the way.
 *
 * `Payment.feeAmount`'s schema comment has said since the columns landed
 * that this is derived and never stored. Until now nothing derived it —
 * the job page printed `payment.amount` and the fee, once recorded, was
 * invisible on the page that records it.
 *
 * Cents in the middle, because `100000 - 220` in floats is fine and
 * `1234.56 - 0.07` is not, and this is money on a GC-facing job.
 */
export function cashReceived(amount: number, feeAmount: number | null): number {
  return (cents(amount) - cents(feeAmount ?? 0)) / 100;
}
