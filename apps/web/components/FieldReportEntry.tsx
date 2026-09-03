"use client";

import { useState, useTransition } from "react";
import { deleteDailyFieldReport, updateDailyFieldReport } from "@/lib/actions";
import {
  FieldReportFields,
  type FieldReport,
} from "@/components/DailyFieldReports";
import { type ReportData, dayLabel } from "@/components/fieldReportWeeks";

// Defined once so the row's controls can't drift back under 44px a button at
// a time. `inline-flex` + `items-center` is what makes min-h centre the label
// instead of pinning it to the top.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50";

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
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      <li className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await updateDailyFieldReport(report.id, formData);
              if (result.ok) setIsEditing(false);
              else setError(result.error);
            });
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-medium text-slate-100">
            {dayLabel(report.reportDate)} · {report.jobName}
          </p>
          <FieldReportFields report={asFields} />
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
    <li className="rounded-md border border-slate-800 bg-slate-900 p-4">
      {/* Stacks on a phone: the three confirm-delete buttons are ~266px wide
          and this row only has 293px of content box at 375px, which left the
          report itself nothing to render in. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-slate-100">{dayLabel(report.reportDate)}</span>
            <span className="text-sm text-blue-400">{report.jobName}</span>
          </p>
          {report.crewPresent && <p className="text-sm text-slate-400">{report.crewPresent}</p>}
          <p className="mt-1 text-sm text-slate-300">{report.workPerformed}</p>
          {/* slate-400, not slate-500 — measured 3.83:1 on this card, under
              the 4.5 floor for text. Weather is what a delay claim is argued
              from months later. */}
          {report.weather && (
            <p className="mt-1 text-sm text-slate-400">Weather: {report.weather}</p>
          )}
          {report.delays && <p className="text-sm text-amber-400">Delays: {report.delays}</p>}
          {report.filedByName && (
            <p className="mt-1 text-xs text-slate-400">filed by {report.filedByName}</p>
          )}
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
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const result = await deleteDailyFieldReport(report.id);
                      if (!result.ok) {
                        setError(result.error);
                        setIsConfirmingDelete(false);
                      }
                    });
                  }}
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
      </div>
    </li>
  );
}
