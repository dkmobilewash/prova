"use client";

import { useRef, useState, useTransition } from "react";
import { createDailyFieldReport } from "@/lib/actions";
import { localToday } from "@/components/localToday";
import {
  FieldReportFields,
  inputClass,
  labelClass,
} from "@/components/DailyFieldReports";

export type JobChoice = { id: string; name: string };

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
 */
export function FieldReportComposer({
  jobs,
  defaultJobId,
}: {
  jobs: JobChoice[];
  defaultJobId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [jobId, setJobId] = useState(defaultJobId ?? jobs[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (jobs.length === 0) {
    return (
      <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
        No jobs yet. A field report records what happened on a job, so there has to be one to
        file against.
      </p>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-blue-600 px-5 py-3 text-base font-medium text-white hover:bg-blue-500"
      >
        Log a day
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createDailyFieldReport(jobId, formData);
          if (result.ok) {
            formRef.current?.reset();
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Log a day</h2>

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
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
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
          <span className="text-xs text-slate-500">
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
          className="rounded-md bg-blue-600 px-5 py-3 text-base font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
          className="rounded-md border border-slate-700 px-5 py-3 text-base text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
