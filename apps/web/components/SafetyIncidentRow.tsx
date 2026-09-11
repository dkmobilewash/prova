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
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

// Defined once so the row's controls can't drift back under 44px a button at
// a time. `inline-flex` + `items-center` is what makes min-h centre the label
// instead of pinning it to the top.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50";

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
  // Keyed by the incident id so two rows' edit forms can never share a draft.
  const draft = useFormDraft(`safety-incident:edit:${incident.id}`);

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
              await updateSafetyIncident(incident.id, formData);
              draft.clear();
              setIsEditing(false);
            }, "Could not save changes");
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-ink-label">Case {incident.caseLabel}</p>
          <FormDraftNotice draft={draft} />

          <SafetyIncidentFields jobs={jobs} defaults={incident} lockDate />

          {error && <p className="text-sm text-red-400">{error}</p>}

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
      </li>
    );
  }

  const recordable = isRecordable(incident.outcome);

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-body">{incident.caseLabel}</span>
          <span className="text-ink">{incident.employeeName}</span>
          {incident.jobTitle && <span className="text-xs text-ink-body">{incident.jobTitle}</span>}
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              recordable ? "bg-tag-amber text-tag-amber-ink" : "bg-neutral-800 text-ink-body"
            }`}
          >
            {recordable ? "Recordable" : "First aid"}
          </span>
        </div>

        <p className="mt-1 text-sm text-ink-label">{incident.description}</p>

        {/* ink-body, not ink-muted: the muted level is under the 4.5 text floor. */}
        <p className="mt-1 text-xs text-ink-body">
          {incident.occurredAt} · {classificationLabel(incident.classification)} ·{" "}
          {outcomeLabel(incident.outcome)}
          {incident.daysAway != null && ` · ${incident.daysAway} days away`}
          {incident.daysRestricted != null && ` · ${incident.daysRestricted} days restricted`}
        </p>
        <p className="text-xs text-ink-body">
          {incident.jobName ? (
            <span className="text-link">{incident.jobName}</span>
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
          were trying to leave alone. It is a child of RowActions now.

          `pinned="end"` is NEW here (#184) and it is a desktop bug fix, not
          a tidy-up. This row sat in PINNED_EXCEPTIONS at the default because
          neither value was right at both widths, which left 100% overlap at
          1100px — the exact defect #176 shipped to fix, on the one row it
          could not settle. #184's armed column makes the phone safe whatever
          `pinned` says, so the prop only has to be right about the desktop
          and there is one answer: `end`, measured 100% -> 0% at 1100px, and
          0% at 639 and 375. Numbers in `rowActionsCensus.test.ts`. */}
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
              onConfirm={() =>
                run(async () => {
                  // Returns rather than throws: production redacts a
                  // thrown message, and the reason a recordable case
                  // cannot be deleted is the whole point of saying it.
                  const result = await deleteSafetyIncident(incident.id);
                  if (!result.ok) throw new Error(result.error);
                }, "Could not remove the case")
              }
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
