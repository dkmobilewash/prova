"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteDailyFieldReport, updateDailyFieldReport } from "@/lib/actions";
import {
  FieldReportFields,
  type FieldReport,
} from "@/components/DailyFieldReports";
import { type ReportData, dayLabel } from "@/components/fieldReportWeeks";
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

/** One day in the company-wide log. Reading, editing, or confirming a
 * delete — the same three states every row in this app has.
 *
 * The date is shown but never editable: it is the identity of the record,
 * and the one-per-job-per-day constraint is keyed on it. Filed against the
 * wrong day, delete it and file the right one. */
export function FieldReportEntry({
  report,
  canDelete,
}: {
  report: ReportData;
  canDelete: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the report id, so it also follows the record to the job
  // page's edit form for the same report — same identity, same draft.
  const draft = useFormDraft(`field-report:edit:${report.id}`);

  const asFields: FieldReport = {
    id: report.id,
    reportDate: report.reportDate,
    crewPresent: report.crewPresent,
    workPerformed: report.workPerformed,
    weather: report.weather,
    delays: report.delays,
    filedByName: report.filedByName,
  };

  if (isEditing) {
    return (
      <li className="rounded-md border border-line-card bg-surface p-4">
        <form
          ref={draft.formRef}
          onChange={draft.save}
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await updateDailyFieldReport(report.id, formData);
              if (result.ok) {
                draft.clear();
                setIsEditing(false);
              } else setError(result.error);
            });
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-medium text-ink">
            {dayLabel(report.reportDate)} · {report.jobName}
          </p>
          <FormDraftNotice draft={draft} />
          <FieldReportFields report={asFields} />
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

  return (
    <li className="rounded-md border border-line-card bg-surface p-4">
      {/* Stacks on a phone: the three confirm-delete buttons are ~266px wide
          and this row only has 293px of content box at 375px, which left the
          report itself nothing to render in. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-ink">{dayLabel(report.reportDate)}</span>
            {/* A report is evidence ABOUT a job, so the job is where you go
                next. This was already styled link-blue and wasn't a link,
                which is worse than plain text: it invites a click that does
                nothing. */}
            <Link
              href={`/jobs/${report.jobId}`}
              className="text-sm text-link hover:text-link-hover hover:underline"
            >
              {report.jobName}
            </Link>
          </p>
          {report.crewPresent && <p className="text-sm text-ink-body">{report.crewPresent}</p>}
          <p className="mt-1 text-sm text-ink-label">{report.workPerformed}</p>
          {/* ink-body, not ink-muted — the muted level is under
              the 4.5 floor for text. Weather is what a delay claim is argued
              from months later. */}
          {report.weather && (
            <p className="mt-1 text-sm text-ink-body">Weather: {report.weather}</p>
          )}
          {report.delays && <p className="text-sm text-amber-400">Delays: {report.delays}</p>}
          {report.filedByName && (
            <p className="mt-1 text-xs text-ink-body">filed by {report.filedByName}</p>
          )}
          {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
        </div>

        {/* Arming "Remove" empties this row: "Edit" is a child of RowActions
            and is not rendered while the confirm is up, so a stray second
            click cannot open the edit form for a report you were deleting.

            A FAILED delete deliberately leaves the row ARMED with its error
            shown — retrying is Cancel, then Remove again. #89's version
            disarmed on failure; that is the one behaviour of its here that
            RowActions deliberately overrides. Its CLASSES are all kept.

            `pinned="end"` measured against #89's stacking: 1100px 100% -> 0%.
            The phone was 86% either way until #184's armed column, which is
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
                onConfirm={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await deleteDailyFieldReport(report.id);
                    if (!result.ok) {
                      setError(result.error);
                    }
                  });
                }}
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
    </li>
  );
}
