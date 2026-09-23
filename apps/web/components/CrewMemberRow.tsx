"use client";

import { useState, useTransition } from "react";
import { archiveCrewMember, updateCrewMember } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { CrewMemberFields, type CrewCraftOption } from "@/components/CrewMemberFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

export type CrewRosterMember = {
  id: string;
  /** The name as a filing prints it — never an email, never blank. */
  nameLabel: string;
  employeeNumber: string | null;
  craftClassificationId: string | null;
  craftLabel: string | null;
};

/**
 * One line of the crew list, with its own edit form and its own two-step
 * archive.
 *
 * Renders a DIV, not an LI: the roster owns the `<li>`. A second `<li>`
 * inside one closes the outer element early in the HTML parser, so the DOM
 * the browser builds is not the tree React expects and hydration breaks
 * silently with the whole suite green — issue #149, learned on EquipmentRow.
 *
 * Archive is the destructive slot of `<RowActions>` rather than a sibling
 * button, so arming it removes Edit from the row automatically. That is
 * issue #152's rule 1 enforced by structure instead of by memory, and
 * `pinned="end"` is rule 2 for this cluster: the row is `justify-between`
 * and right-pinned, so the LAST control keeps its position and Cancel goes
 * last.
 */
export function CrewMemberRow({
  member,
  craftOptions,
  canSetCraft,
  canEdit,
  canArchive,
}: {
  member: CrewRosterMember;
  craftOptions: CrewCraftOption[];
  canSetCraft: boolean;
  canEdit: boolean;
  canArchive: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by id, so two rows' edit forms can never share a draft.
  const draft = useFormDraft(`crew:edit:${member.id}`);

  /** Runs an action and renders the sentence it refuses with. These actions
   *  return their refusals — a thrown one is a digest in production. */
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
    // Closed and cleared on the ok branch only, so a refused save leaves
    // every field exactly as typed.
    run(
      () => updateCrewMember(member.id, formData),
      () => {
        draft.clear();
        setIsEditing(false);
      },
    );
  }

  if (isEditing) {
    return (
      <div>
        <form ref={draft.formRef} onSubmit={handleSave} onChange={draft.save} className="flex flex-col gap-3">
          <FormDraftNotice draft={draft} />
          <CrewMemberFields
            defaults={member}
            craftOptions={craftOptions}
            canSetCraft={canSetCraft}
            locked={{ nameLabel: member.nameLabel }}
          />

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
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
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  const detail = [member.craftLabel, member.employeeNumber ? `No. ${member.employeeNumber}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm text-ink">{member.nameLabel}</p>
        {detail && <p className="text-xs text-ink-muted">{detail}</p>}
      </div>

      <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
        <RowActions
          className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end"
          destructive={
            canArchive ? (
              <ConfirmDelete
                pinned="end"
                describe="Takes them off the crew: they stop appearing when hours are logged. Every hour already logged for them, and their name on past payrolls, stays exactly as it is."
                label="Archive"
                confirmLabel="Confirm archive"
                pendingLabel="Archiving…"
                cancelLabel="Keep"
                pending={isPending}
                onConfirm={() => run(() => archiveCrewMember(member.id))}
                deleteClassName="text-sm text-red-400 hover:underline disabled:opacity-50"
              />
            ) : undefined
          }
        >
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setIsEditing(true);
                setError(null);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-neutral-800"
            >
              Edit
            </button>
          )}
        </RowActions>
        {error && <p className="max-w-[16rem] text-xs text-rose-300 sm:text-right">{error}</p>}
      </div>
    </div>
  );
}
