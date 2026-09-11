"use client";

import { useRef, useState, useTransition } from "react";
import { logPayment } from "@/lib/actions";

/**
 * Logs a payment against an invoice.
 *
 * A plain `<form action={logPayment.bind(...)}>` can't show what the action
 * returns, and logPayment now refuses an amount that would overpay the
 * invoice (see the guard's own comment in lib/actions/billing.ts) — a
 * refusal nobody could see would just look like the button did nothing.
 * Same useTransition + inline error shape as PayApplications.tsx.
 */
export function LogPaymentForm({ jobId, invoiceId }: { jobId: string; invoiceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not log this payment");
          }
        });
      }}
      className="mt-3 flex flex-col gap-2 border-t border-line-row pt-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <input
          name="amount"
          placeholder="Amount"
          required
          className="w-24 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
        <input
          name="method"
          placeholder="Method (check, cash...)"
          className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
        <input
          name="note"
          placeholder="Note (optional)"
          className="flex-1 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-ink hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Logging…" : "Log payment"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
