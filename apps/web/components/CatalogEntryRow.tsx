"use client";

import { useState, useTransition } from "react";
import { deleteLineItemCatalogEntry } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

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
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteLineItemCatalogEntry(entryId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div className="min-w-0">{children}</div>

      <div className="flex flex-col items-end gap-1">
        <RowActions
          className="flex flex-col items-end gap-1"
          destructive={
            <ConfirmDelete
              armedClassName="flex items-center gap-2"
              pendingLabel="Deleting…"
              pending={isPending}
              onConfirm={handleDelete}
              hint={
                linkedLineCount > 0 ? (
                  <span className="max-w-[16rem] text-right text-amber-300">
                    {linkedLineCount} costed {linkedLineCount === 1 ? "line" : "lines"} priced from
                    this entry will keep their numbers but stop feeding actuals back here.
                  </span>
                ) : undefined
              }
            />
          }
        />
        {error && <p className="max-w-[16rem] text-right text-xs text-rose-300">{error}</p>}
      </div>
    </li>
  );
}
