"use client";

import { useState, useTransition } from "react";
import { deleteSafetyIncident, updateSafetyIncident } from "@/lib/actions";
import {
  SafetyIncidentFields,
  type IncidentDefaults,
  type JobOption,
} from "@/components/SafetyIncidentFields";
import { classificationLabel, isRecordable, outcomeLabel } from "@/components/safetyLabels";

// Defined once so the row's controls can't drift back under 44px a button at
// a time. `inline-flex` + `items-center` is what makes min-h centre the label
// instead of pinning it to the top.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50";

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
              await updateSafetyIncident(incident.id, formData);
              setIsEditing(false);
            }, "Could not save changes");
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">Case {incident.caseLabel}</p>

          <SafetyIncidentFields jobs={jobs} defaults={incident} lockDate />

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

  const recordable = isRecordable(incident.outcome);

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-400">{incident.caseLabel}</span>
          <span className="text-slate-100">{incident.employeeName}</span>
          {incident.jobTitle && <span className="text-xs text-slate-400">{incident.jobTitle}</span>}
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              recordable ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-400"
            }`}
          >
            {recordable ? "Recordable" : "First aid"}
          </span>
        </div>

        <p className="mt-1 text-sm text-slate-300">{incident.description}</p>

        {/* slate-400, not slate-500 — measured 3.83:1 on the slate-900 card,
            under the 4.5 floor for text, and tailwind.config.ts calls this
            exact value "optional text only". The DATE of an incident and its
            classification are the two things an OSHA inspector reads. */}
        <p className="mt-1 text-xs text-slate-400">
          {incident.occurredAt} · {classificationLabel(incident.classification)} ·{" "}
          {outcomeLabel(incident.outcome)}
          {incident.daysAway != null && ` · ${incident.daysAway} days away`}
          {incident.daysRestricted != null && ` · ${incident.daysRestricted} days restricted`}
        </p>
        <p className="text-xs text-slate-400">
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
                onClick={() => run(() => deleteSafetyIncident(incident.id), "Could not remove the case")}
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
