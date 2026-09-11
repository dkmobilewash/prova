"use client";

import { useState, useTransition } from "react";
import { deleteEquipment, updateEquipment } from "@/lib/actions";
import { EquipmentFields, type EquipmentFieldValues } from "@/components/EquipmentFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

// One definition for the row's controls so they can't drift back under 44px a
// button at a time. `inline-flex` + `items-center` is what makes min-h centre
// the label rather than pin it to the top.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-neutral-100 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:border-red-500 hover:text-red-600 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-600 hover:bg-tag-rose disabled:opacity-50";

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

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await updateEquipment(item.id, formData);
        draft.clear();
        setIsEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save changes");
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteEquipment(item.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete equipment");
      }
    });
  }

  if (isEditing) {
    return (
      <div>
        <form ref={draft.formRef} onSubmit={handleSave} onChange={draft.save} className="flex flex-col gap-3">
          <FormDraftNotice draft={draft} />
          <EquipmentFields defaults={item} />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-label hover:bg-yellow-500 disabled:opacity-50"
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
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-100 disabled:opacity-50"
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
        <p className="font-medium text-ink">{item.name}</p>
        {detail && <p className="text-sm text-ink-body">{detail}</p>}
        {/* ink-body rather than ink-muted: the muted level is under the 4.5 text floor. */}
        {item.notes && <p className="mt-1 text-sm text-ink-body">{item.notes}</p>}
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
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
