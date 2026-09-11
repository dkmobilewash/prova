"use client";

import { useState, useTransition } from "react";
import {
  deleteDrawingRevision,
  deleteDrawingSet,
  recordDrawingRevision,
  updateDrawingRevision,
  updateDrawingSet,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { inputClass, labelClass } from "@/components/RfiFields";
import { DrawingSetFields, type DrawingSetDefaults } from "@/components/DrawingSetFields";
import {
  type RevisionData,
  byNewestFirst,
  currentRevision,
  daysToReachUs,
  setState,
  stateLabel,
} from "@/components/drawingLabels";
import { localToday } from "@/components/localToday";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

export type DrawingSetRowData = DrawingSetDefaults & {
  id: string;
  jobName: string;
  revisions: RevisionData[];
};

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50";

/** The received-date and link fields, shared by "record an issue" and the
 * per-revision edit so the two can't drift. */
function ReceiptFields({ defaults }: { defaults?: Partial<RevisionData> }) {
  return (
    <>
      <label className={labelClass}>
        Date it reached us
        <input
          type="date"
          name="receivedOn"
          defaultValue={defaults?.receivedOn ?? ""}
          className={inputClass}
        />
        <span className="text-xs text-ink-muted">
          Leave blank if it hasn&apos;t. That&apos;s the state worth seeing — it means the crew is
          building from paper that&apos;s already superseded.
        </span>
      </label>

      <label className={labelClass}>
        What changed
        <textarea
          name="description"
          rows={2}
          defaultValue={defaults?.description ?? ""}
          placeholder="The reason someone opens this revision later."
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Link to the set
          <input
            type="url"
            name="fileUrl"
            defaultValue={defaults?.fileUrl ?? ""}
            placeholder="https://…"
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">
            Wherever it actually lives — Procore, Box, the GC&apos;s portal.
          </span>
        </label>
        <label className={labelClass}>
          Link label
          <input
            type="text"
            name="fileName"
            defaultValue={defaults?.fileName ?? ""}
            placeholder="e.g. A-series full set"
            className={inputClass}
          />
        </label>
      </div>
    </>
  );
}

/** The edit form for one revision, extracted from the list's map so it can
 * hold its own draft hook (hooks can't live in a loop). Keyed by the
 * revision id, so two revisions' edits can never share a draft. `onSave`
 * receives the form's data plus a callback to run only when the update
 * actually succeeded, which clears the draft. */
function RevisionEditForm({
  revision,
  isPending,
  error,
  onSave,
  onCancel,
}: {
  revision: RevisionData;
  isPending: boolean;
  error: string | null;
  onSave: (formData: FormData, onSaved: () => void) => void;
  onCancel: () => void;
}) {
  const draft = useFormDraft(`drawing-revision:edit:${revision.id}`);
  return (
    <form
      ref={draft.formRef}
      onChange={draft.save}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        onSave(formData, draft.clear);
      }}
      className="my-2 flex flex-col gap-3 rounded-md border border-line-card p-3"
    >
      <p className="text-sm font-semibold text-ink-label">
        {revision.label} · issued {revision.issuedOn}
      </p>
      <FormDraftNotice draft={draft} />
      <ReceiptFields defaults={revision} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={isPending} className={primaryBtn}>
          {isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={isPending} onClick={onCancel} className={btn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function DrawingSetRow({
  set,
  today,
  canDelete,
  showJob,
}: {
  set: DrawingSetRowData;
  today: string;
  canDelete: boolean;
  showJob: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "issue">("view");
  const [editingRevisionId, setEditingRevisionId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the set id so two rows can never share a draft; edit and
  // issue are different forms with different fields, so different keys.
  // The per-revision edit form has its own hook in RevisionEditForm below.
  const editDraft = useFormDraft(`drawing-set:edit:${set.id}`);
  const issueDraft = useFormDraft(`drawing-set:issue:${set.id}`);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  const ordered = byNewestFirst(set.revisions);
  const current = currentRevision(set.revisions);
  const state = setState(set.revisions);

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          ref={editDraft.formRef}
          onChange={editDraft.save}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => updateDrawingSet(set.id, formData),
              () => {
                editDraft.clear();
                setMode("view");
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-ink-label">{set.jobName}</p>
          <FormDraftNotice draft={editDraft} />
          <DrawingSetFields defaults={set} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === "issue") {
    return (
      <li className="p-4">
        <form
          ref={issueDraft.formRef}
          onChange={issueDraft.save}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => recordDrawingRevision(set.id, formData),
              () => {
                issueDraft.clear();
                setMode("view");
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-ink-label">Record an issue of {set.name}</p>
          <FormDraftNotice draft={issueDraft} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Revision label
              <input
                type="text"
                name="label"
                required
                placeholder="e.g. Rev 3, ASI-12, Bulletin 5"
                className={inputClass}
              />
              <span className="text-xs text-ink-muted">
                Exactly as printed on the title block. It&apos;s the architect&apos;s label, not ours.
              </span>
            </label>
            <label className={labelClass}>
              Date issued
              <input
                type="date"
                name="issuedOn"
                required
                defaultValue={localToday()}
                className={inputClass}
              />
              <span className="text-xs text-ink-muted">
                The date on the drawing itself, not today. This is what decides which one is current.
              </span>
            </label>
          </div>

          <ReceiptFields />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Record issue"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const stateChip =
    state === "BEHIND"
      ? "bg-tag-rose text-tag-rose-ink"
      : state === "CURRENT_IN_HAND"
        ? "bg-tag-green text-tag-green-ink"
        : "bg-neutral-800 text-ink-body";

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink">{set.name}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${stateChip}`}>{stateLabel(state)}</span>
          {current && (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-ink-body">
              Build from {current.label}
            </span>
          )}
        </div>

        {set.description && <p className="mt-1 text-sm text-ink-label">{set.description}</p>}

        {ordered.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-l-2 border-line-card pl-3">
            {ordered.map((rev) => {
              const days = daysToReachUs(rev, today);
              const isCurrent = current?.id === rev.id;
              return (
                <li key={rev.id} className="text-xs text-ink-body">
                  {editingRevisionId === rev.id ? (
                    <RevisionEditForm
                      revision={rev}
                      isPending={isPending}
                      error={error}
                      onSave={(formData, onSaved) => {
                        run(
                          () => updateDrawingRevision(rev.id, formData),
                          () => {
                            onSaved();
                            setEditingRevisionId(null);
                          },
                        );
                      }}
                      onCancel={() => setEditingRevisionId(null)}
                    />
                  ) : (
                    <>
                      <span className={isCurrent ? "font-mono text-ink-label" : "font-mono text-ink-muted"}>
                        {rev.label}
                      </span>
                      {` · issued ${rev.issuedOn}`}
                      {rev.receivedOn
                        ? ` · received ${rev.receivedOn}${days !== null ? ` · ${days} day${days === 1 ? "" : "s"} to reach us` : ""}`
                        : ` · NOT RECEIVED${days !== null ? ` · waiting ${days} day${days === 1 ? "" : "s"}` : ""}`}
                      {!isCurrent && " · superseded"}
                      {rev.description && <span className="text-ink-muted"> — {rev.description}</span>}
                      {/* Only the actions go inside RowActions — the
                          revision's own text above stays visible while a
                          delete is armed. The file link and "Mark received"
                          used to stay live next to the armed confirm (issue
                          #152), so a click meant to cancel a remove marked
                          the revision received instead. */}
                      <RowActions
                        as="span"
                        destructive={
                          canDelete ? (
                            <ConfirmDelete
                              label="Remove"
                              confirmLabel="Confirm remove"
                              pendingLabel="Removing…"
                              pending={isPending}
                              onConfirm={() => run(() => deleteDrawingRevision(rev.id))}
                              deleteClassName="ml-2 text-ink-muted underline disabled:opacity-50"
                              cancelClassName="ml-2 text-ink-body underline disabled:opacity-50"
                              confirmClassName="ml-2 text-red-400 underline disabled:opacity-50"
                            />
                          ) : null
                        }
                      >
                        {rev.fileUrl && (
                          <a
                            href={rev.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-link underline"
                          >
                            {rev.fileName || "open"}
                          </a>
                        )}
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => setEditingRevisionId(rev.id)}
                          className="ml-2 text-ink-muted underline disabled:opacity-50"
                        >
                          {rev.receivedOn ? "Edit" : "Mark received"}
                        </button>
                      </RowActions>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {showJob && <p className="mt-1 text-xs text-link">{set.jobName}</p>}

        {error && !editingRevisionId && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {/* Arming the delete empties this cluster. "Record an issue" and
          "Edit" both stayed live beside the armed confirm — issue #152 —
          and recording an issue on a set you were about to delete is the
          one action that then makes the delete impossible, since it only
          offers itself while the set has no revisions. */}
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-2"
        destructive={
          canDelete && set.revisions.length === 0 ? (
            <ConfirmDelete
              pinned="end"
              confirmLabel="Confirm delete"
              pendingLabel="Deleting…"
              pending={isPending}
              onConfirm={() => run(() => deleteDrawingSet(set.id))}
              deleteClassName={btn}
              cancelClassName={btn}
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
            />
          ) : null
        }
      >
        <button
          type="button"
          disabled={isPending}
          onClick={() => setMode("issue")}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          Record an issue
        </button>

        <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
          Edit
        </button>
      </RowActions>
    </li>
  );
}
