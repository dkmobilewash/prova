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
      try {
        const result = await pushPaymentToQuickBooks(paymentId);
        setMessage(
          result.ok
            ? { tone: "ok", text: "Applied to the invoice in QuickBooks and verified." }
            : { tone: "bad", text: result.error },
        );
      } catch {
        // A THROWN action renders NOTHING without this, and that is exactly
        // what happened on 2026-09-03: the POST reached the server and
        // returned 200, the click produced no success, no error and no
        // sync-log row, and a person watching would reasonably conclude it
        // had worked.
        //
        // Everything INSIDE the action returns ActionResult — the blockers,
        // the item resolution, the push itself are all wrapped. But
        // `accessTokenFor` runs before any of those try blocks, so a throw
        // there escapes the action and lands in a transition nobody caught.
        //
        // The thrown message is deliberately NOT shown: production redacts
        // it to a digest, which tells a person nothing. This says the one
        // thing that is known — the attempt did not complete — and points at
        // the log, where a real refusal would have been recorded.
        setMessage({
          tone: "bad",
          text:
            "That didn't complete, and QuickBooks may not have been reached at all. " +
            "Check Settings → Recent sync activity before trying again: if there is no " +
            "entry for this attempt, nothing was sent.",
        });
      }
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
