"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createDailyFieldReport } from "@/lib/actions";
import { localToday } from "@/components/localToday";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";
import {
  FieldReportFields,
  inputClass,
  labelClass,
} from "@/components/DailyFieldReports";
import { jobPickerLabel, type JobOption } from "@/components/jobLabels";
import { defaultFieldReportJobId } from "@/lib/field-report-jobs";

/** Was its own `{ id, name }` declaration — the fourth in the app, and the
 * reason issue #65's bare-name picker kept getting copied. The shared type
 * requires the GC name and the status. */
export type JobChoice = JobOption;

/** Filing a day from the company-wide log, where the job has to be chosen
 * rather than inherited from the page.
 *
 * This is the field-first entry point: the whole reason this page exists is
 * that the only other way to file was four screens down a job page, past
 * prevailing wage determinations and union dispatch slips. A foreman
 * opening the app to record what happened today should not have to walk
 * through the office's paperwork to get there.
 *
 * `localToday()` runs during this component's render, which is safe ONLY
 * because nothing renders until the button is clicked. A server-rendered
 * default would be the server's UTC date — already tomorrow after 5pm in
 * California, which is exactly when a foreman files.
 *
 * THE JOB IS NO LONGER `jobs[0]`. It was, and the page hands its jobs over
 * `orderBy: { name: "asc" }` with every status in the list, so the default
 * was the alphabetically first job the company has ever had — an estimate,
 * a job closed out last spring, whatever sorts first. Work performed is the
 * only field a foreman types; the rest of this form arrives filled in. So
 * the one thing he wrote got filed against the wrong job on any day the
 * alphabet disagreed with the schedule, and nothing on screen said so.
 * `defaultFieldReportJobId` picks only when there is exactly one active job
 * and otherwise leaves the select on "Choose a job", which stops the submit.
 */
export function FieldReportComposer({
  jobs,
  defaultJobId,
}: {
  jobs: JobChoice[];
  defaultJobId?: string;
}) {
  const initialJobId = defaultFieldReportJobId(jobs, defaultJobId);
  /** No job could be picked for him, so the select carries a placeholder and
   * the form refuses to submit until he says which. */
  const mustChoose = initialJobId === "";
  const [isOpen, setIsOpen] = useState(false);
  const [jobId, setJobId] = useState(initialJobId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The job select is controlled, so the hook alone can't restore it —
  // onRestore/onDiscard keep the state in step with the DOM.
  const draft = useFormDraft("field-report:create", {
    onRestore: (values) => {
      const restoredJob = values.jobId;
      if (typeof restoredJob === "string" && jobs.some((job) => job.id === restoredJob)) {
        setJobId(restoredJob);
      }
    },
    onDiscard: () => setJobId(initialJobId),
  });

  // The same case /photos handles with a real link — refusing with a bare
  // sentence leaves the one thing to do next as something you have to go
  // and find.
  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-line-card bg-surface p-4" data-tour="field-reports-no-jobs">
        <p className="text-sm text-ink-body">
          No jobs yet. A field report records what happened on a job, so there has to be one to
          file against.
        </p>
        <Link
          href="/jobs/new"
          className="mt-3 inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-medium text-neutral-900 hover:bg-yellow-500"
        >
          Create a job
        </Link>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        data-tour="field-reports-log-day"
        className="rounded-md bg-brand px-5 py-3 text-base font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Log a day
      </button>
    );
  }

  return (
    <form
      ref={draft.formRef}
      onChange={draft.save}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        // `required` on the select already stops this in a browser; the
        // guard is for the case where it does not, because the failure it
        // prevents is a report filed against "" rather than a report not
        // filed — the action would answer "Job not found" and the day's
        // work would be gone with it.
        if (!jobId) {
          setError("Choose which job this report is for.");
          return;
        }
        startTransition(async () => {
          const result = await createDailyFieldReport(jobId, formData);
          if (result.ok) {
            draft.clear();
            draft.resetForm();
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
      data-tour="field-reports-form"
    >
      <h2 className="text-sm font-semibold text-ink-label">Log a day</h2>
      <FormDraftNotice draft={draft} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Job
          <select
            name="jobId"
            required
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className={inputClass}
          >
            {mustChoose && <option value="">Choose a job…</option>}
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {jobPickerLabel(job)}
              </option>
            ))}
          </select>
          {mustChoose && (
            // ink-body, matching the date hint below and for the same
            // reason: this sentence is the difference between a report on
            // the right job and one on the wrong job.
            <span className="text-xs text-ink-body">
              Nothing is preselected — more than one job could be the right one, and a day
              filed against the wrong one looks exactly like a day filed against the right
              one.
            </span>
          )}
        </label>
        <label className={labelClass}>
          Date
          <input
            type="date"
            name="reportDate"
            required
            defaultValue={localToday()}
            className={inputClass}
          />
          {/* ink-body, not ink-muted — the muted level is under the 4.5 floor,
              under the 4.5 floor. This sentence is the difference between a
              report filed against the right day and the wrong one; it cannot
              be the first thing sunlight takes away. */}
          <span className="text-xs text-ink-body">
            The day the work happened, not the day you typed it in.
          </span>
        </label>
      </div>

      <FieldReportFields />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        {/* Disabled in flight: this create is not idempotent, and a second
            click would hit the one-per-job-per-day constraint rather than
            doing nothing. */}
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-5 py-3 text-base font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
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
          className="rounded-md border border-line-card px-5 py-3 text-base text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
