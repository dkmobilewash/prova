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
  blockers,
}: {
  paymentId: string;
  /** Set once this payment exists in QuickBooks. */
  linkedQboId: string | null;
  lastVerifiedAt: string | null;
  /**
   * Why this cannot be sent yet, or empty.
   *
   * REQUIRED, and that is the fix rather than an inconvenience. The
   * server has always refused a blocked push — `pushPaymentToQuickBooks`
   * runs `paymentPushBlockers` before it calls Intuit and logs SKIPPED —
   * but nothing passed the reasons to this component, so the button
   * rendered live and unexplained on a payment whose invoice QuickBooks
   * had never seen. A browser test found it and stopped the whole run,
   * reasonably, because from the screen there was no way to tell a
   * working button from a broken one.
   *
   * The docstring above this component already said a payment that
   * cannot be sent "reads as broken unless the message says which" — and
   * the message was never wired. Making the prop required means the
   * compiler asks for it at every call site, which a test could not have
   * done as cheaply.
   */
  blockers: string[];
}) {
  const blocked = blockers.length > 0;
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
        disabled={isPending || blocked}
        className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
      >
        {isPending ? "Sending…" : linkedQboId ? "Re-send payment" : "Send payment to QuickBooks"}
      </button>

      {/* Said on the row, not after a click. A disabled control with no
          reason beside it is the same unanswered question as an enabled
          one that refuses. */}
      {blocked && message === null && (
        <p className="max-w-[18rem] text-right text-xs text-slate-500">{blockers.join(" ")}</p>
      )}

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
