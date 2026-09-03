"use client";

import { useState, useTransition } from "react";
import { deletePunchListItem, setPunchListItemDone, updatePunchListItem } from "@/lib/actions";
import type { JobOption } from "@/components/PunchListForm";

// `text-base` is load-bearing, not decoration: these inputs sit inside a
// `text-sm` label and INHERIT 14px, and iOS Safari zooms the page whenever
// a focused field is under 16px. On a phone that leaves the foreman zoomed
// in and scrolled sideways after every tap. `min-h-11` is 44px.
const inputClass =
  "min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 focus:border-blue-500 focus:outline-none";

// One definition for the row's controls, so they can't drift back under 44px
// a button at a time. `inline-flex` + `items-center` is what makes min-h
// actually centre the label instead of pinning it to the top.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50";

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
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(async () => {
              await updatePunchListItem(item.id, formData);
              setIsEditing(false);
            }, "Could not save changes");
          }}
          className="flex flex-col gap-3"
        >
          <select name="jobId" defaultValue={item.jobId} className={inputClass}>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
          <input type="text" name="description" required defaultValue={item.description} className={inputClass} />

          {error && <p className="text-sm text-red-400">{error}</p>}

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
            className="h-6 w-6 accent-blue-500"
            aria-label={item.isDone ? "Mark as not done" : "Mark as done"}
          />
        </label>

        <div className="min-w-0 flex-1">
          <p className={item.isDone ? "text-slate-500 line-through" : "text-slate-100"}>{item.description}</p>
          {/* slate-400, not slate-500: measured 3.83:1 against the slate-900
              card, under the 4.5 floor. tailwind.config.ts says as much of
              this exact value — "optional text only". The job and who raised
              it are not optional. */}
          <p className="text-xs text-slate-400">
            {showJob && <span className="text-blue-400">{item.jobName}</span>}
            {showJob && item.raisedByName && " · "}
            {item.raisedByName && `raised by ${item.raisedByName}`}
          </p>
          {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsEditing(true);
            setIsConfirmingDelete(false);
          }}
          className={rowBtn}
        >
          Edit
        </button>

        {canDelete &&
          (isConfirmingDelete ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => deletePunchListItem(item.id), "Could not delete item")}
                className={rowBtnConfirm}
              >
                {isPending ? "Removing…" : "Confirm remove"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsConfirmingDelete(false)}
                className={rowBtn}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsConfirmingDelete(true)}
              className={rowBtnDanger}
            >
              Remove
            </button>
          ))}
      </div>
    </li>
  );
}
