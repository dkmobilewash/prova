"use client";

import { useState, useTransition } from "react";
import { pushPaymentToQuickBooks } from "@/lib/actions";

/**
 * Sends one recorded payment to QuickBooks, applied to its invoice.
 *
 * Deliberately the same shape as PushInvoiceToQuickBooks: explicit, per
 * record, never automatic, result rendered in place. The research this
 * product is built against is full of accounting integrations that pushed
 * things nobody expected and then diverged silently, and two sync buttons
 * that behave differently would be two things to learn rather than one.
 *
 * The wording differs in one place that matters. An invoice that cannot be
 * sent is usually a setup problem; a payment that cannot be sent is most
 * often an ORDERING problem — its invoice has not reached QuickBooks yet —
 * and that reads as broken unless the message says which.
 */
export function PushPaymentToQuickBooks({
  paymentId,
  linkedQboId,
  lastVerifiedAt,
}: {
  paymentId: string;
  /** Set once this payment exists in QuickBooks. */
  linkedQboId: string | null;
  lastVerifiedAt: string | null;
}) {
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function push() {
    setMessage(null);
    startTransition(async () => {
      const result = await pushPaymentToQuickBooks(paymentId);
      setMessage(
        result.ok
          ? { tone: "ok", text: "Applied to the invoice in QuickBooks and verified." }
          : { tone: "bad", text: result.error },
      );
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={push}
        disabled={isPending}
        className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
      >
        {isPending ? "Sending…" : linkedQboId ? "Re-send payment" : "Send payment to QuickBooks"}
      </button>

      {message === null && linkedQboId && (
        <p className="text-xs text-slate-500">
          QuickBooks payment {linkedQboId}
          {lastVerifiedAt ? ` · verified ${lastVerifiedAt}` : " · not verified"}
        </p>
      )}

      {message && (
        <p
          className={`max-w-[18rem] text-right text-xs ${
            message.tone === "ok" ? "text-emerald-300" : "text-amber-300"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
