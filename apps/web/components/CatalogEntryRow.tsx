"use client";

import { useState, useTransition } from "react";
import { deleteLineItemCatalogEntry } from "@/lib/actions";

/**
 * Deleting a catalog entry, in two steps.
 *
 * It used to be one click, straight to the server action. Browser testing
 * caught it: four deletions, four rows gone on the next render, no confirm
 * anywhere. Every other list in the app already asks twice, and this one is
 * a worse thing to lose by a misclick than most.
 *
 * Worse because of a second-order effect that isn't visible on the row: a
 * job line item records the entry it was priced from, that relation is
 * optional, and so deleting the entry sets the link to null rather than
 * refusing. The rows survive — but the actuals feedback loop for that work
 * is severed silently, and nothing on screen would ever tell you. So the
 * confirm step says how many costed lines are about to be unlinked, which is
 * the number that should make someone stop.
 */
export function CatalogEntryRow({
  entryId,
  linkedLineCount,
  children,
}: {
  entryId: string;
  linkedLineCount: number;
  children: React.ReactNode;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteLineItemCatalogEntry(entryId);
      if (result.ok) setIsConfirming(false);
      else setError(result.error);
    });
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div className="min-w-0">{children}</div>

      <div className="flex flex-col items-end gap-1">
        {isConfirming ? (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={handleDelete}
                className="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setIsConfirming(false);
                  setError(null);
                }}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {linkedLineCount > 0 && (
              <p className="max-w-[16rem] text-right text-xs text-amber-300">
                {linkedLineCount} costed {linkedLineCount === 1 ? "line" : "lines"} priced from this
                entry will keep their numbers but stop feeding actuals back here.
              </p>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setIsConfirming(true)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-red-500 hover:text-red-400"
          >
            Delete
          </button>
        )}
        {error && <p className="max-w-[16rem] text-right text-xs text-rose-300">{error}</p>}
      </div>
    </li>
  );
}
