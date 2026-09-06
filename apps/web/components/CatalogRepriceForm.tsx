"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCatalogDefaultsFromActuals } from "@/lib/actions";

/**
 * "Update default from actuals", as a control that can say no.
 *
 * There is no hidden input carrying the new cost any more. It used to send
 * `actualUnitCost` from the page and the action wrote whatever arrived,
 * checking only that it parsed — for the one control in the app that edits
 * a number every future bid and every AI draft reads. The action recomputes
 * it from the line items now, so this form sends nothing but the intent and
 * the margin checkbox, and the figure below is only ever a preview of what
 * the server will work out for itself.
 *
 * Which means it can legitimately refuse: a costed line may have landed
 * since this page rendered, and the variance that made this button appear
 * may no longer be there. That answer is rendered rather than thrown.
 */
export function CatalogRepriceForm({
  entryId,
  previewUnitCost,
}: {
  entryId: string;
  /** What the page believes the actual unit cost is, for the button label
   * only. The server does not take it. */
  previewUnitCost: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const result = await updateCatalogDefaultsFromActuals(entryId, formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          } catch {
            setError("Could not update this entry");
          }
        });
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <label className="flex items-center gap-1 text-xs text-slate-400">
        <input type="checkbox" name="alsoUpdatePrice" className="accent-blue-500" />
        also move the sale price, holding margin
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950 disabled:opacity-50"
      >
        {isPending ? "Updating…" : `Set default to ${previewUnitCost}`}
      </button>
      {error && <p className="w-full text-xs text-rose-300">{error}</p>}
    </form>
  );
}
