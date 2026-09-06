"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLineItemAsCatalogEntry } from "@/lib/actions";

/**
 * "Save as catalog item", with somewhere for the answer to go.
 *
 * The answer that matters is the refusal. The catalog now declines a second
 * entry under a description it already holds, and the reason is the whole
 * value of the message: two copies of one item split the actuals between
 * them, so each can sit below the two-line minimum sample forever and the
 * variance flag that would have caught a bad price never fires on either.
 * Thrown, that sentence is a digest in production; a button with no
 * feedback at all just looks like it worked.
 */
export function SaveAsCatalogItem({ lineItemId }: { lineItemId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="mt-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            try {
              const result = await saveLineItemAsCatalogEntry(lineItemId);
              if (!result.ok) {
                setMessage({ ok: false, text: result.error });
                return;
              }
              setMessage({ ok: true, text: "Saved to the catalog." });
              router.refresh();
            } catch {
              setMessage({ ok: false, text: "Could not save this to the catalog" });
            }
          });
        }}
        className="text-xs text-slate-500 hover:text-slate-300 hover:underline disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save as catalog item"}
      </button>
      {message && (
        <p className={`mt-1 text-xs ${message.ok ? "text-slate-400" : "text-amber-300"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
