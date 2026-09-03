"use client";

import { useRef, useState, useTransition } from "react";
import {
  createDailyFieldReport,
  deleteDailyFieldReport,
  updateDailyFieldReport,
} from "@/lib/actions";
import { localToday } from "@/components/localToday";
import type { ActionResult } from "@/lib/actions/shared";

// `text-base` is load-bearing, not decoration. These inputs sit inside a
// `text-sm` label and INHERIT 14px, and iOS Safari zooms the whole page
// whenever a focused field is under 16px — so a foreman filing a report on a
// phone ends up zoomed in and scrolled sideways after every single tap.
// `min-h-11` is 44px, the tap-target floor.
export const inputClass =
  "min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
export const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

// The row's controls, defined once so they can't drift back under 44px a
// button at a time. These were `py-1.5 text-xs` — 30px tall, the smallest
// buttons anywhere in the field screens.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50";

export type FieldReport = {
  id: string;
  reportDate: string;
  crewPresent: string | null;
  workPerformed: string;
  weather: string | null;
  delays: string | null;
  filedByName: string | null;
};

/** Date only, formatted from the stored UTC-midnight value. Using UTC here
 * on purpose: rendering in local time would show the previous day for
 * anyone west of UTC. */
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** One field set, shared by every surface that files a report — the job
 * page and the company-wide log — so the two can never drift into
 * accepting different things. */
export function FieldReportFields({ report }: { report?: FieldReport }) {
  return (
    <>
      <label className={labelClass}>
        Crew on site
        <input
          type="text"
          name="crewPresent"
          defaultValue={report?.crewPresent ?? ""}
          placeholder="e.g. 4 framers, 2 apprentices"
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Work performed
        <textarea
          name="workPerformed"
          required
          rows={2}
          defaultValue={report?.workPerformed ?? ""}
          placeholder="What actually got done today"
          className={inputClass}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Weather
          <input
            type="text"
            name="weather"
            defaultValue={report?.weather ?? ""}
            placeholder="e.g. Rain until noon"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Delays
          <input
            type="text"
            name="delays"
            defaultValue={report?.delays ?? ""}
            placeholder="Late delivery, trade in the way, inspection no-show"
            className={inputClass}
          />
        </label>
      </div>
    </>
  );
}

export function DailyFieldReports({
  jobId,
  reports,
  canDelete,
}: {
  jobId: string;
  reports: FieldReport[];
  canDelete: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /** These actions RETURN their failures — production redacts a thrown
   * Server Action message, and "a report already exists for that date" is
   * exactly the sentence a foreman needs to read. `onOk` only runs when the
   * write actually succeeded. */
  function run(fn: () => Promise<ActionResult>, fallback: string, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error || fallback);
    });
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Daily field reports</h2>
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Log a day
          </button>
        )}
      </div>

      {isOpen && (
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => createDailyFieldReport(jobId, formData), "Could not save the report", () => {
              formRef.current?.reset();
              setIsOpen(false);
            });
          }}
          className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
        >
          <label className={labelClass}>
            Date
            <input type="date" name="reportDate" required defaultValue={localToday()} className={inputClass} />
          </label>
          <FieldReportFields />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save report"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsOpen(false);
                setError(null);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {reports.length === 0 ? (
        <p className="text-sm text-slate-400">
          No reports yet. One entry a day — crew, what got done, weather, delays. The weather and delay
          fields are what a schedule dispute gets argued from later.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((report) =>
            editingId === report.id ? (
              <li key={report.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    run(() => updateDailyFieldReport(report.id, formData), "Could not save changes", () =>
                      setEditingId(null),
                    );
                  }}
                  className="flex flex-col gap-3"
                >
                  <p className="text-sm font-medium text-slate-100">{formatDate(report.reportDate)}</p>
                  <FieldReportFields report={report} />
                  {error && <p className="text-sm text-red-400">{error}</p>}
                  <div className="flex gap-2">
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
                        setEditingId(null);
                        setError(null);
                      }}
                      className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={report.id} className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-100">{formatDate(report.reportDate)}</p>
                    {report.crewPresent && <p className="text-slate-400">{report.crewPresent}</p>}
                    <p className="mt-1 text-slate-300">{report.workPerformed}</p>
                    {/* slate-400, not slate-500 — measured 3.83:1 on this card,
                        under the 4.5 floor for text. Weather is the field a
                        delay claim is argued from months later; it does not
                        get to be the faintest thing on the row. */}
                    {report.weather && <p className="mt-1 text-slate-400">Weather: {report.weather}</p>}
                    {report.delays && <p className="text-amber-400">Delays: {report.delays}</p>}
                    {report.filedByName && (
                      <p className="mt-1 text-xs text-slate-400">filed by {report.filedByName}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setEditingId(report.id);
                        setConfirmingDeleteId(null);
                        setError(null);
                      }}
                      className={rowBtn}
                    >
                      Edit
                    </button>
                    {canDelete &&
                      (confirmingDeleteId === report.id ? (
                        <>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () => deleteDailyFieldReport(report.id),
                                "Could not delete the report",
                              )
                            }
                            className={rowBtnConfirm}
                          >
                            Confirm remove
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => setConfirmingDeleteId(null)}
                            className={rowBtn}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => setConfirmingDeleteId(report.id)}
                          className={rowBtnDanger}
                        >
                          Remove
                        </button>
                      ))}
                  </div>
                </div>
                {error && confirmingDeleteId === report.id && (
                  <p className="mt-1 text-sm text-red-400">{error}</p>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
