"use client";

import type { ReactNode } from "react";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

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
 *
 * It used to hand-roll its own armed state, which meant it could not see
 * or hide any ordinary action sitting next to it — the failure issue #152
 * catalogued twenty times over. It is now a `<RowActions>` with nothing in
 * it, so the three /settings lists that use it get the same guarantee as
 * every other row. If a list ever needs an Edit button beside the delete,
 * do NOT add it around this component: use `<RowActions>` directly and put
 * the button in its children, where the armed state covers it.
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
  hint?: ReactNode;
}) {
  return (
    <RowActions
      className="flex shrink-0 flex-col items-end gap-1"
      destructive={
        <ConfirmDelete
          action={action}
          label={label}
          confirmLabel={confirmLabel}
          hint={hint}
          armedClassName="flex flex-wrap items-center justify-end gap-2"
          deleteClassName="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-red-500 hover:text-red-400"
        />
      }
    />
  );
}
