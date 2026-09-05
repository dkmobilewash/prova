"use client";

import { useState, useTransition } from "react";
import { deletePunchListItem, setPunchListItemDone, updatePunchListItem } from "@/lib/actions";
import type { JobOption } from "@/components/PunchListForm";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none";

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

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3 p-4">
      <input
        type="checkbox"
        checked={item.isDone}
        disabled={isPending}
        onChange={(event) =>
          run(() => setPunchListItemDone(item.id, event.target.checked), "Could not update item")
        }
        className="mt-1 h-4 w-4 shrink-0 accent-blue-500"
        aria-label={item.isDone ? "Mark as not done" : "Mark as done"}
      />

      <div className="min-w-0 flex-1">
        <p className={item.isDone ? "text-slate-500 line-through" : "text-slate-100"}>{item.description}</p>
        <p className="text-xs text-slate-500">
          {showJob && <span className="text-blue-400">{item.jobName}</span>}
          {showJob && item.raisedByName && " · "}
          {item.raisedByName && `raised by ${item.raisedByName}`}
        </p>
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {/* Arming "Remove" empties this cluster: "Edit" used to stay live
          beside the armed "Confirm remove", so one click past where you
          meant to stop opened the edit form instead of cancelling. It is a
          child of RowActions now, and so is whatever gets added here next.
          The done/not-done checkbox is deliberately NOT in here — it lives
          in the row body above, not the action cluster. */}
      <RowActions
        className="flex shrink-0 items-center gap-2"
        destructive={
          canDelete ? (
            <ConfirmDelete
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={() => run(() => deletePunchListItem(item.id), "Could not delete item")}
              deleteClassName="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
              cancelClassName="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            />
          ) : null
        }
      >
        <button
          type="button"
          disabled={isPending}
          onClick={() => setIsEditing(true)}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Edit
        </button>
      </RowActions>
    </li>
  );
}
