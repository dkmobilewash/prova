"use client";

import { useState, useTransition } from "react";
import { pushInvoiceToQuickBooks } from "@/lib/actions";

/**
 * Sends one invoice to QuickBooks.
 *
 * Explicit, per invoice, and never automatic. Contractors in the research
 * this product is built against describe accounting integrations that
 * pushed things they didn't expect and then diverged silently; a button
 * someone presses is slower and far easier to trust.
 *
 * The result is rendered in place rather than thrown, and the wording
 * distinguishes the three outcomes that actually differ: it worked, it was
 * refused, or it was accepted but QuickBooks now holds something different.
 * That third case is the one every competitor reports as success.
 */
export function PushInvoiceToQuickBooks({
  invoiceId,
  linkedQboId,
  lastVerifiedAt,
  blockers,
}: {
  invoiceId: string;
  /** Set once this invoice exists in QuickBooks. */
  linkedQboId: string | null;
  lastVerifiedAt: string | null;
  /** Why this cannot be sent yet, or empty. Required for the same reason
   * as on the payment button: `pushBlockers` has always existed and the
   * action has always honoured it, but nothing handed the reasons to the
   * UI, so a button that could not work looked identical to one that
   * could. */
  blockers: string[];
}) {
  const blocked = blockers.length > 0;
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function push() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await pushInvoiceToQuickBooks(invoiceId);
        setMessage(
          result.ok
            ? { tone: "ok", text: "Sent to QuickBooks and verified." }
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
        {isPending
          ? "Sending…"
          : linkedQboId
            ? "Re-send to QuickBooks"
            : "Send to QuickBooks"}
      </button>

      {blocked && message === null && (
        <p className="max-w-[18rem] text-right text-xs text-slate-500">{blockers.join(" ")}</p>
      )}

      {/* Shown when there's no message of its own, so the row always says
          whether this invoice is in QuickBooks without being asked. */}
      {message === null && linkedQboId && (
        <p className="text-xs text-slate-500">
          QuickBooks invoice {linkedQboId}
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
