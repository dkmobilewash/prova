"use client";

import { useState, useTransition } from "react";
import { linkContactToQuickBooks } from "@/lib/actions";

/**
 * Links a GC to a QuickBooks customer.
 *
 * This existed as an action with no button for exactly as long as it took
 * to write a test that needed it — the same gap contractor licences had.
 * An action nobody can reach is a feature that does not exist.
 *
 * Matching by name before creating is what the action does, and it is the
 * behaviour worth explaining here: the bookkeeper almost certainly already
 * has this GC in QuickBooks with payment history attached, and a second
 * copy splits that history in a way that is tedious to merge and easy not
 * to notice.
 */
export function LinkContactToQuickBooks({
  contactId,
  contactName,
  linkedQboId,
}: {
  contactId: string;
  contactName: string;
  linkedQboId: string | null;
}) {
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (linkedQboId && message === null) {
    return (
      <p className="text-xs text-slate-400">
        Linked to QuickBooks customer {linkedQboId}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await linkContactToQuickBooks(contactId);
            setMessage(
              result.ok
                ? { tone: "ok", text: `Linked ${contactName} to QuickBooks.` }
                : { tone: "bad", text: result.error },
            );
          });
        }}
        className="self-start rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? "Linking…" : "Link to QuickBooks"}
      </button>
      {message && (
        <p className={`text-xs ${message.tone === "ok" ? "text-emerald-300" : "text-amber-300"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
