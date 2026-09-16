"use client";

import { useRef, useState, useTransition } from "react";
import { logPayment } from "@/lib/actions";
import { Hint } from "@/components/Hint";
import { localToday } from "@/components/localToday";

/**
 * Logs a payment against an invoice.
 *
 * A plain `<form action={logPayment.bind(...)}>` can't show what the action
 * returns, and logPayment now refuses an amount that would overpay the
 * invoice (see the guard's own comment in lib/actions/billing.ts) — a
 * refusal nobody could see would just look like the button did nothing.
 * Same useTransition + inline error shape as PayApplications.tsx.
 *
 * WHY THIS IS COLLAPSED BEHIND A BUTTON, when it used to sit open under
 * every unpaid invoice. The received date defaults to the READER'S
 * calendar date via `localToday()`, and CLAUDE.md's rule is that it may
 * only be called in a component mounted by a user action — the server
 * renders in UTC, so a default computed in server-rendered markup
 * disagrees with the client's and breaks hydration. Opening on a click is
 * also what every other add-form in this app does.
 *
 * THE TWO FIELDS THAT ARE NEW, and what each one switches on:
 *
 *   - RECEIVED. `Payment.receivedAt` was `@default(now())`, so the stored
 *     date was the timestamp of the click and that is what QuickBooks got
 *     as `TxnDate` (lib/quickbooks-payment-sync.ts). Prova and QuickBooks
 *     then disagreed by however long the cheque sat in the mail, and the
 *     reconciliation report reported a discrepancy that was not real.
 *   - FEE. `Payment.feeAmount`/`.feeSource` have existed, documented and
 *     read by lib/gc-reliability.ts, with no form writing either — so a
 *     Textura or GC Pay deduction had nowhere to go. It is one small box
 *     beside the method, and the box naming who took it only appears once
 *     there is a fee to attribute.
 *
 * AMOUNT IS THE GROSS, and the label says so rather than leaving it to be
 * guessed. It is what was applied to the invoice, before the fee — that is
 * what clears the balance here and in QuickBooks. What reached the bank is
 * derived from the two (lib/billing/payment-entry.ts) and shown on the
 * payment row.
 */
const inputClass =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

export function LogPaymentForm({ jobId, invoiceId }: { jobId: string; invoiceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Controlled only so the "who took it" box can appear once there is a
  // fee to attribute. The value still reaches the action off the form.
  const [fee, setFee] = useState("");

  if (!isOpen) {
    return (
      <div className="mt-3 border-t border-line-row pt-3">
        <Hint text="Opens the form. Records money you have actually received against this invoice. It changes what the invoice shows as outstanding here; it does not move any money and it does not tell the GC.">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-ink hover:bg-neutral-700"
          >
            Log a payment
          </button>
        </Hint>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          try {
            const result = await logPayment(jobId, invoiceId, formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            formRef.current?.reset();
            setFee("");
            setIsOpen(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not log this payment");
          }
        });
      }}
      className="mt-3 flex flex-col gap-2 border-t border-line-row pt-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Amount applied
          <input
            name="amount"
            placeholder="Amount"
            required
            className={`w-28 ${inputClass}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Received
          <input
            type="date"
            name="receivedAt"
            // Mounted by the click above, never server-rendered — see the
            // header and components/localToday.ts.
            defaultValue={localToday()}
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Method
          <input name="method" placeholder="Check, cash…" className={`w-32 ${inputClass}`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Platform fee
          <input
            name="feeAmount"
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            placeholder="0.00"
            className={`w-20 ${inputClass}`}
          />
        </label>
        {fee.trim() !== "" && (
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Taken by
            <input name="feeSource" placeholder="Textura, GC Pay…" className={`w-32 ${inputClass}`} />
          </label>
        )}
        <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
          Note
          <input name="note" placeholder="Optional" className={`w-full ${inputClass}`} />
        </label>
      </div>
      <p className="text-xs text-ink-muted">
        Amount applied is what the GC paid against this invoice, <strong className="text-ink-label">before</strong>{" "}
        any platform fee — that is what clears the balance. Put a Textura or GC Pay deduction in Platform fee and the
        row will show what actually reached the bank.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Hint text="Records money you have actually received against this invoice. It changes what the invoice shows as outstanding here; it does not move any money and it does not tell the GC.">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-ink hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Logging…" : "Log payment"}
          </button>
        </Hint>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
            // The uncontrolled inputs go with the unmounted form; `fee` is
            // state and would otherwise survive the cancel and reappear
            // with the next payment.
            setFee("");
          }}
          className="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
