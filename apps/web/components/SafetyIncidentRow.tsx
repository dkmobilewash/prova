"use client";

import { useState, useTransition } from "react";
import { deleteSafetyIncident, updateSafetyIncident } from "@/lib/actions";
import {
  SafetyIncidentFields,
  type IncidentDefaults,
  type JobOption,
} from "@/components/SafetyIncidentFields";
import { classificationLabel, isRecordable, outcomeLabel } from "@/components/safetyLabels";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

export type IncidentRowData = IncidentDefaults & {
  id: string;
  caseLabel: string;
  jobName: string | null;
  reportedByName: string | null;
};

export function SafetyIncidentRow({
  incident,
  jobs,
  canDelete,
}: {
  incident: IncidentRowData;
  jobs: JobOption[];
  canDelete: boolean;
}) {
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
              await updateSafetyIncident(incident.id, formData);
              setIsEditing(false);
            }, "Could not save changes");
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">Case {incident.caseLabel}</p>

          <SafetyIncidentFields jobs={jobs} defaults={incident} lockDate />

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

  const recordable = isRecordable(incident.outcome);

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-500">{incident.caseLabel}</span>
          <span className="text-slate-100">{incident.employeeName}</span>
          {incident.jobTitle && <span className="text-xs text-slate-500">{incident.jobTitle}</span>}
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              recordable ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-400"
            }`}
          >
            {recordable ? "Recordable" : "First aid"}
          </span>
        </div>

        <p className="mt-1 text-sm text-slate-300">{incident.description}</p>

        <p className="mt-1 text-xs text-slate-500">
          {incident.occurredAt} · {classificationLabel(incident.classification)} ·{" "}
          {outcomeLabel(incident.outcome)}
          {incident.daysAway != null && ` · ${incident.daysAway} days away`}
          {incident.daysRestricted != null && ` · ${incident.daysRestricted} days restricted`}
        </p>
        <p className="text-xs text-slate-500">
          {incident.jobName ? (
            <span className="text-blue-400">{incident.jobName}</span>
          ) : (
            <span>Not job-related</span>
          )}
          {incident.location && ` · ${incident.location}`}
          {incident.reportedByName && ` · logged by ${incident.reportedByName}`}
        </p>

        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {/* Arming "Remove" empties this cluster. A safety case is evidence,
          and "Edit" used to sit live beside the armed "Confirm remove" —
          one click past a cancel opened the edit form on the record you
          were trying to leave alone. It is a child of RowActions now. */}
      <RowActions
        className="flex shrink-0 items-center gap-2"
        destructive={
          canDelete ? (
            <ConfirmDelete
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={() =>
                run(async () => {
                  // Returns rather than throws: production redacts a
                  // thrown message, and the reason a recordable case
                  // cannot be deleted is the whole point of saying it.
                  const result = await deleteSafetyIncident(incident.id);
                  if (!result.ok) throw new Error(result.error);
                }, "Could not remove the case")
              }
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
