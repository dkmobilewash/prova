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
      const result = await pushInvoiceToQuickBooks(invoiceId);
      setMessage(
        result.ok
          ? { tone: "ok", text: "Sent to QuickBooks and verified." }
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
