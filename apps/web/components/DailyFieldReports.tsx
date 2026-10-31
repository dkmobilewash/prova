"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  createDailyFieldReport,
  deleteDailyFieldReport,
  updateDailyFieldReport,
} from "@/lib/actions";
import { localToday } from "@/components/localToday";
import type { ActionResult } from "@/lib/actions/shared";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";
import { Spinner } from "@/components/Spinner";
import { Disclosure } from "@/components/Disclosure";
import { FieldReportFacts } from "@/components/FieldReportFacts";
import { installedFieldName, installedToDateText, type InstallLine } from "@/lib/installed-quantities";

// `text-base` is load-bearing, not decoration. These inputs sit inside a
// `text-sm` label and INHERIT 14px, and iOS Safari zooms the whole page
// whenever a focused field is under 16px — so a foreman filing a report on a
// phone ends up zoomed in and scrolled sideways after every single tap.
// `min-h-11` is 44px, the tap-target floor.
export const inputClass =
  "min-h-11 rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
export const labelClass = "flex flex-col gap-1 text-sm text-ink-label";

// The row's controls, defined once so they can't drift back under 44px a
// button at a time. These were `py-1.5 text-xs` — 30px tall, the smallest
// buttons anywhere in the field screens.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:border-red-500 hover:text-danger disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-xs text-danger hover:bg-tag-rose disabled:opacity-50";

export type FieldReport = {
  id: string;
  reportDate: string;
  crewPresent: string | null;
  workPerformed: string;
  weather: string | null;
  delays: string | null;
  filedByName: string | null;
  /** The automatic site weather as one line, and whether it is still a
   *  forecast. Null when the job has no site address found on a map. */
  weatherAutoLine?: string | null;
  weatherAutoKind?: "forecast" | "observed" | null;
  /** The day's crew from its time entries ("3 people · 24h — …"). */
  manpowerLine?: string | null;
  /** "Signed" / "Approved" when the day is signed and so locked. */
  lockedLabel?: string | null;
  /** Photos taken on the phone with "Attach to today's report" on. */
  photoCount?: number;
  /** The day's crew from its time entries, for the closed row. */
  manpower?: { headcount: number; hours: number } | null;
  /** A delay was logged for this day in the delay log. */
  hasDelayEvent?: boolean;
  /** This report's quantities by line id, for the edit form. */
  installed?: Record<string, number>;
  /** The same quantities as a sentence, for the row. */
  installedLine?: string | null;
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
export function FieldReportFields({ report, lines = [] }: { report?: FieldReport; lines?: InstallLine[] }) {
  return (
    <>
      {/* The crew itself comes from the day's time entries — nobody retypes
          who worked. This box is for everyone else on site. */}
      <label className={labelClass}>
        Other trades / visitors on site
        <input
          type="text"
          name="crewPresent"
          defaultValue={report?.crewPresent ?? ""}
          placeholder="e.g. Electricians on L3, inspector at 10"
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
      {/* Weather is filled in automatically from the job's site address;
          this is only for what the numbers don't say. Delays are logged
          one by one under "Delays" below, with cause and crew-hours. */}
      <label className={labelClass}>
        Site conditions (optional)
        <input
          type="text"
          name="weather"
          defaultValue={report?.weather ?? ""}
          placeholder="e.g. Mud at the east gate, deck still wet at 7"
          className={inputClass}
        />
      </label>
      {lines.length > 0 && (
        <Disclosure variant="plain" summary="Installed today (optional)">
          <div className="flex flex-col gap-2">
            {lines.map((line) => (
              <label key={line.id} className={labelClass}>
                {line.description} ({line.unit})
                <input
                  type="text"
                  inputMode="decimal"
                  name={installedFieldName(line.id)}
                  defaultValue={report?.installed?.[line.id] ?? ""}
                  className={inputClass}
                />
                <span className="text-xs text-ink-muted">{installedToDateText(line)}</span>
              </label>
            ))}
          </div>
        </Disclosure>
      )}
    </>
  );
}

/** The edit form for one report, extracted from the list's map so it can
 * hold its own draft hook (hooks can't live in a loop). The draft is keyed
 * by the report id — the same key FieldReportEntry uses on the company-wide
 * log, since both edit the same record. `onSave` receives the form's data
 * plus a callback to run only when the update actually succeeded, which
 * clears the draft. */
function FieldReportEditForm({
  report,
  lines,
  isPending,
  error,
  onSave,
  onCancel,
}: {
  report: FieldReport;
  lines: InstallLine[];
  isPending: boolean;
  error: string | null;
  onSave: (formData: FormData, onSaved: () => void) => void;
  onCancel: () => void;
}) {
  const draft = useFormDraft(`field-report:edit:${report.id}`);
  return (
    <form
      ref={draft.formRef}
      onChange={draft.save}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        onSave(formData, draft.clear);
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-sm font-medium text-ink">{formatDate(report.reportDate)}</p>
      <FormDraftNotice draft={draft} />
      <FieldReportFields report={report} lines={lines} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Saving…
            </span>
          ) : (
            "Save changes"
          )}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={onCancel}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-rail-hover disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function DailyFieldReports({
  jobId,
  lines = [],
  reports,
  canDelete,
  siteNote,
  children,
  seeAll,
}: {
  jobId: string;
  /** Lines that can take an installed quantity. */
  lines?: InstallLine[];
  reports: FieldReport[];
  canDelete: boolean;
  /** Shown when the job has no site address found on a map, so reports
   *  can't fill in the weather — says where to fix it. */
  siteNote?: string | null;
  /** The delay log, rendered inside this section, above the reports. */
  children?: ReactNode;
  /** The SeeAll line under a capped list of reports. */
  seeAll?: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /* NOT the armed-delete state — each row's <RowActions> owns its own arming
     now. This only says which row's delete produced the `error` below, so a
     failure prints under the report it belongs to instead of under all of
     them. */
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the job: this section renders on every job page, and a report
  // half-typed for one job must not surface on another's.
  const draft = useFormDraft(`field-report:create:${jobId}`);

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
    <section data-tour="job-field-reports">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Daily field reports</h2>
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
          >
            Log a day
          </button>
        )}
      </div>

      {isOpen && (
        <form
          ref={draft.formRef}
          onChange={draft.save}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => createDailyFieldReport(jobId, formData), "Could not save the report", () => {
              draft.clear();
              draft.resetForm();
              setIsOpen(false);
            });
          }}
          className="mb-4 flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
        >
          <FormDraftNotice draft={draft} />
          <label className={labelClass}>
            Date
            <input type="date" name="reportDate" required defaultValue={localToday()} className={inputClass} />
          </label>
          <FieldReportFields lines={lines} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner />
                  Saving…
                </span>
              ) : (
                "Save report"
              )}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsOpen(false);
                setError(null);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-rail-hover disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {siteNote && <p className="mb-3 text-sm text-warn">{siteNote}</p>}

      {/* The delay log ABOVE the reports (declutter, density audit #8): it
          sat under the whole uncapped report history, unreachable without
          scrolling every report. */}
      {children}
      {children && <h3 className="mb-2 mt-6 text-base font-semibold text-ink">Reports</h3>}

      {reports.length === 0 ? (
        <p className="text-sm text-ink-body">
          No reports yet. One entry a day — what got done and who else was on site. The crew comes from the
          day&rsquo;s time entries and the weather from the site address, so neither is typed.
        </p>
      ) : (
        <ul aria-label="Daily reports" className="divide-y divide-line-row rounded-md border border-line-card bg-surface px-3">
          {reports.map((report) =>
            editingId === report.id ? (
              <li key={report.id} className="py-3">
                <FieldReportEditForm
                  report={report}
                  lines={lines}
                  isPending={isPending}
                  error={error}
                  onSave={(formData, onSaved) => {
                    run(() => updateDailyFieldReport(report.id, formData), "Could not save changes", () => {
                      onSaved();
                      setEditingId(null);
                    });
                  }}
                  onCancel={() => {
                    setEditingId(null);
                    setError(null);
                  }}
                />
              </li>
            ) : (
              <li key={report.id}>
                {/* One line until opened — the same row as the company-wide
                    log (FieldReportFacts), one report open at a time. */}
                <Disclosure
                  variant="row"
                  name="field-report"
                  summary={
                    <FieldReportFacts
                      dateLabel={formatDate(report.reportDate)}
                      manpower={report.manpower}
                      hasDelays={Boolean(report.delays) || Boolean(report.hasDelayEvent)}
                      filedByName={report.filedByName}
                      lockedLabel={report.lockedLabel}
                    />
                  }
                >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    {report.manpowerLine && <p className="text-ink-body">Crew: {report.manpowerLine}</p>}
                    {report.crewPresent && <p className="text-ink-body">Also on site: {report.crewPresent}</p>}
                    <p className="mt-1 text-ink-label">{report.workPerformed}</p>
                    {report.installedLine && <p className="mt-1 text-xs text-ink-body">Installed: {report.installedLine}</p>}
                    {report.weatherAutoLine && (
                      <p className="mt-1 text-ink-body">
                        Weather{report.weatherAutoKind === "forecast" ? " (forecast — replaced by the actual day once it's over)" : ""}:{" "}
                        {report.weatherAutoLine}
                      </p>
                    )}
                    {/* ink-body, not ink-muted — the muted level is under the
                        4.5 floor for text. Weather is the field a delay claim
                        is argued from months later; it does not get to be the
                        faintest thing on the row. */}
                    {report.weather && (
                      <p className="mt-1 text-ink-body">
                        {report.weatherAutoLine ? "Site conditions" : "Weather"}: {report.weather}
                      </p>
                    )}
                    {report.delays && <p className="text-warn">Delays: {report.delays}</p>}
                    {report.photoCount ? (
                      <p className="mt-1 text-ink-body">
                        {report.photoCount} {report.photoCount === 1 ? "photo" : "photos"} attached — see Site photos below
                      </p>
                    ) : null}
                    {report.filedByName && (
                      <p className="mt-1 text-xs text-ink-body">filed by {report.filedByName}</p>
                    )}
                  </div>
                  {/* Each report row arms its own remove — the arming used to
                      be one id on the whole list, which is fine, but "Edit"
                      stayed live beside the armed confirm, so a click meant
                      for Cancel opened the edit form on the report you were
                      trying to leave alone. Ordinary actions are children of
                      RowActions and are gone while armed.

                      `pinned="end"` measured against #89's stacking: 1100px
                      100% -> 0%. The phone was 79% either way until #184's
                      armed column, which is 0% at 639 and 375. Numbers in
                      `rowActionsCensus.test.ts`. */}
                  {report.lockedLabel ? (
                    <span
                      className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-ok"
                      title="This day is signed, so its report is locked. Reopen the day under Timesheet sign-off to change it."
                    >
                      {report.lockedLabel} · locked
                    </span>
                  ) : (
                  <RowActions
                    className="flex shrink-0 flex-wrap items-center gap-3"
                    destructive={
                      canDelete ? (
                        <ConfirmDelete
                          describe="Deletes the day's field report and everything entered on it — crew, hours, weather and notes for that date."
                          pinned="end"
                          label="Remove"
                          confirmLabel="Confirm remove"
                          pending={isPending}
                          onConfirm={() => {
                            setDeleteErrorId(report.id);
                            run(() => deleteDailyFieldReport(report.id), "Could not delete the report");
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
                      onClick={() => {
                        setEditingId(report.id);
                        setError(null);
                      }}
                      className={rowBtn}
                    >
                      Edit
                    </button>
                  </RowActions>
                  )}
                </div>
                {error && deleteErrorId === report.id && (
                  <p className="mt-1 text-sm text-danger">{error}</p>
                )}
                </Disclosure>
              </li>
            ),
          )}
        </ul>
      )}
      {seeAll}
    </section>
  );
}
