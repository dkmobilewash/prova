"use client";

import { useState, useTransition } from "react";
import { deletePunchListItem, setPunchListItemDone, updatePunchListItem } from "@/lib/actions";
import type { JobOption } from "@/components/PunchListForm";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

// `text-base` is load-bearing, not decoration: these inputs sit inside a
// `text-sm` label and INHERIT 14px, and iOS Safari zooms the page whenever
// a focused field is under 16px. On a phone that leaves the foreman zoomed
// in and scrolled sideways after every tap. `min-h-11` is 44px.
const inputClass =
  "min-h-11 rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink focus:border-link focus:outline-none";

// One definition for the row's controls, so they can't drift back under 44px
// a button at a time. `inline-flex` + `items-center` is what makes min-h
// actually centre the label instead of pinning it to the top.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-neutral-100 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:border-red-500 hover:text-red-600 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-600 hover:bg-tag-rose disabled:opacity-50";

type PunchListRowProps = {
  canDelete: boolean;
  jobs: JobOption[];
  item: {
    id: string;
    description: string;
    jobId: string;
    jobName: string;
    isDone: boolean;
    raisedByName: string | null;
  };
  showJob: boolean;
};

export function PunchListRow({ canDelete, jobs, item, showJob }: PunchListRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the item id so two rows' edit forms can never share a draft.
  const draft = useFormDraft(`punch-list:edit:${item.id}`);

  function run(fn: () => Promise<void>, fallback: string) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : fallback);
      }
    });
  }

  if (isEditing) {
    return (
      <li className="p-4">
        <form
          ref={draft.formRef}
          onChange={draft.save}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(async () => {
              await updatePunchListItem(item.id, formData);
              draft.clear();
              setIsEditing(false);
            }, "Could not save changes");
          }}
          className="flex flex-col gap-3"
        >
          <FormDraftNotice draft={draft} />
          <select name="jobId" defaultValue={item.jobId} className={inputClass}>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
          <input type="text" name="description" required defaultValue={item.description} className={inputClass} />

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
      </li>
    );
  }

  return (
    // Stacks on a phone, side by side from sm up — the same shape
    // SafetyIncidentRow and RfiRow already use. Measured at 375px, the old
    // single-row layout gave the description column 116px, and 0px once the
    // three confirm-delete buttons appeared: the item you were about to
    // delete was squeezed out of its own row entirely.
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {/* The most-tapped control on this page — ticking items off during a
            walkthrough — was a 16px box. The box now draws at 24px and the
            label pads the hit area to 44. Negative margins keep it sitting
            where it always did inside the row's own padding. */}
        <label className="-my-2 -ml-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={item.isDone}
            disabled={isPending}
            onChange={(event) =>
              run(() => setPunchListItemDone(item.id, event.target.checked), "Could not update item")
            }
            className="h-6 w-6 accent-yellow-500"
            aria-label={item.isDone ? "Mark as not done" : "Mark as done"}
          />
        </label>

        <div className="min-w-0 flex-1">
          <p className={item.isDone ? "text-ink-muted line-through" : "text-ink"}>{item.description}</p>
          {/* ink-body, not ink-muted: the muted level is under the 4.5 text floor. */}
          <p className="text-xs text-ink-body">
            {showJob && <span className="text-link">{item.jobName}</span>}
            {showJob && item.raisedByName && " · "}
            {item.raisedByName && `raised by ${item.raisedByName}`}
          </p>
          {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        </div>
      </div>

      {/* Arming "Remove" empties this cluster: "Edit" used to stay live
          beside the armed "Confirm remove", so one click past where you
          meant to stop opened the edit form instead of cancelling. It is a
          child of RowActions now, and so is whatever gets added here next.
          The done/not-done checkbox is deliberately NOT in here — it lives
          in the row body above, not the action cluster.

          `pinned="end"` measured against #89's stacking: 1100px 100% -> 0%.
          The phone was 86% either way until #184's armed column, which is 0%
          at 639 and 375. Numbers in `rowActionsCensus.test.ts`. */}
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
              onConfirm={() => run(() => deletePunchListItem(item.id), "Could not delete item")}
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
    </li>
  );
}
