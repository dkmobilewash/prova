"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * A delete that asks twice, for lists rendered by a server component.
 *
 * The third hand-written copy of this pattern was one too many. Browser
 * testing found /catalog deleting on a single click, that was fixed, and
 * the very next run found /settings doing the same thing on policies and
 * bonds — because the fix had been written into one row component rather
 * than into something reusable. This is that something.
 *
 * Takes an already-bound server action, so the page keeps deciding what
 * gets deleted and this only decides when.
 */
export function ConfirmDeleteButton({
  action,
  label = "Delete",
  confirmLabel = "Confirm delete",
  /** Names what is about to go, when the row's own text doesn't. */
  hint,
}: {
  action: () => Promise<void> | void;
  label?: string;
  confirmLabel?: string;
  hint?: string;
}) {
  const [isConfirming, setIsConfirming] = useState(false);

  if (!isConfirming) {
    return (
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        className="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-red-500 hover:text-red-400"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form action={action}>
          <SubmitButton
            type="submit"
            className="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
          >
            {confirmLabel}
          </SubmitButton>
        </form>
        <button
          type="button"
          onClick={() => setIsConfirming(false)}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
      {hint && <p className="max-w-[14rem] text-right text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
