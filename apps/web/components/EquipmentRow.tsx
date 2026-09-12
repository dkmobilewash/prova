"use client";

import { useState, useTransition } from "react";
import { deleteEquipment, updateEquipment } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { EquipmentFields, type EquipmentFieldValues } from "@/components/EquipmentFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

// One definition for the row's controls so they can't drift back under 44px a
// button at a time. `inline-flex` + `items-center` is what makes min-h centre
// the label rather than pin it to the top.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50";

type EquipmentRowProps = {
  canDelete: boolean;
  item: EquipmentFieldValues & { id: string };
};

/** The name, the detail line, and the row's own buttons.
 *
 * Renders a DIV, not an LI. The page already wraps each piece in an `<li>`,
 * and this component used to open a second one inside it. The HTML parser
 * resolves that by closing the outer `<li>` early, so the DOM the browser
 * builds is not the tree React expects and hydration breaks — silently, and
 * with typecheck, lint and the whole test suite green. See issue #149.
 *
 * Where the piece is deliberately is NOT printed here. The page prints it
 * once, alongside the utilisation figure and from the same derived value;
 * two lines derived from one fact read as two separate facts. */
export function EquipmentRow({ canDelete, item }: EquipmentRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the item id so two rows' edit forms can never share a draft.
  const draft = useFormDraft(`equipment:edit:${item.id}`);

  /** Runs an action and renders the sentence it refuses with.
   *
   * Was two try/catch blocks over `err.message`, which in production is
   * React's "the specific message is omitted in production builds"
   * paragraph rather than anything this app wrote — so the local fallback
   * strings were the only text ever shown. These actions return their
   * refusals now. Same shape as `SubmittalRow`. */
  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // Draft cleared and form closed on the OK branch only, so a refused
    // save leaves every field exactly as typed.
    run(
      () => updateEquipment(item.id, formData),
      () => {
        draft.clear();
        setIsEditing(false);
      },
    );
  }

  function handleDelete() {
    run(() => deleteEquipment(item.id));
  }

  if (isEditing) {
    return (
      <div>
        <form ref={draft.formRef} onSubmit={handleSave} onChange={draft.save} className="flex flex-col gap-3">
          <FormDraftNotice draft={draft} />
          <EquipmentFields defaults={item} />

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  const detail = [item.type, item.assetTag].filter(Boolean).join(" · ");

  return (
    // A DIV, never an LI — see the note on the component above. The page owns
    // the <li> and its p-4; this element only lays the row out inside it.
    //
    // Stacks on a phone. Measured at 375px, the single-row layout gave the
    // equipment NAME a 14.6px column once the three confirm-delete buttons
    // appeared — you could not read what you were about to delete. It stays
    // right-pinned from sm up, which is where justify-between still applies.
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-slate-100">{item.name}</p>
        {detail && <p className="text-sm text-slate-400">{detail}</p>}
        {/* slate-400 rather than slate-500: slate-500 measures 3.83:1 on the
            slate-900 card, under the 4.5 text floor. */}
        {item.notes && <p className="mt-1 text-sm text-slate-400">{item.notes}</p>}
        {error && (
          <p role="alert" className="mt-1 text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      {/* Arming "Remove" empties this row: "Edit" is a child of RowActions
          and is not rendered while the confirm is up, so the click meant to
          cancel cannot open the edit form instead.

          Classes are #89's touch targets (min-h-11, py-2, gap-3). #89 also
          made this row stack below sm, and `pinned="end"` is measured against
          the merged layout: 1100px 100% -> 0%. At 375px the prop reached
          nothing — 86% overlap either way — until #184 gave the armed pair a
          full-width column below sm, which takes this row to 0% at 375 and
          639 with Cancel covering the whole vacated box. See the rule-2 block
          in `rowActionsCensus.test.ts`. */}
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-3"
        destructive={
          canDelete ? (
            <ConfirmDelete
              pinned="end"
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={handleDelete}
              deleteClassName={rowBtnDanger}
              cancelClassName={rowBtn}
              confirmClassName={rowBtnConfirm}
            />
          ) : null
        }
      >
        <button
          type="button"
          disabled={isPending}
          onClick={() => setIsEditing(true)}
          className={rowBtn}
        >
          Edit
        </button>
      </RowActions>
    </div>
  );
}
