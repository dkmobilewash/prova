"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { jobPickerLabel, type JobOption } from "@/components/jobLabels";
import { scheduleCrewDay, unscheduleCrewDay } from "@/lib/actions";

/**
 * Who is planned on which job, which day — and which past days nobody
 * logged hours against.
 *
 * A client component rather than a server one with bound actions, for the
 * reason `lib/actions/shared.ts` exists: these actions RETURN their
 * failures, and the two sentences this screen most needs to say — "they are
 * already on that job that day" and "only someone with field access can
 * change the crew schedule" — are useless if nothing renders them.
 * Production redacts a thrown message to a digest.
 */

export type ScheduleDay = {
  id: string;
  workDate: string;
  jobId: string;
  jobName: string;
  worker: string;
  craft: string | null;
  note: string | null;
};

export type WorkerOption = { value: string; label: string };
export type CraftOption = { id: string; name: string };

function DayGroup({
  date,
  days,
  canWrite,
  onRemoved,
}: {
  date: string;
  days: ScheduleDay[];
  canWrite: boolean;
  onRemoved: (id: string) => void;
}) {
  return (
    <li className="px-4 py-3">
      <p className="text-sm font-semibold text-ink-label">{date}</p>
      <ul className="mt-2 space-y-2">
        {days.map((day) => (
          <li key={day.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-ink">
                {day.worker}
                {day.craft && <span className="text-ink-muted"> · {day.craft}</span>}
              </p>
              <p className="text-xs text-ink-body">
                <Link href={`/jobs/${day.jobId}`} className="underline hover:text-link">
                  {day.jobName}
                </Link>
                {day.note && <span className="text-ink-muted"> — {day.note}</span>}
              </p>
            </div>
            {canWrite && (
              <RowActions
                className="flex shrink-0 flex-col items-end gap-1"
                destructive={
                  <ConfirmDelete
                    // Short on purpose: rowActionsCensus caps a delete label
                    // at 12 characters, standing in for the pixel width that
                    // decides whether Cancel covers the delete's position.
                    label="Remove"
                    confirmLabel="Remove it"
                    describe={`Takes ${day.worker} off ${day.jobName} on ${date}. It does not touch any hours already logged.`}
                    pinned="end"
                    action={async () => {
                      const result = await unscheduleCrewDay(day.id);
                      if (result.ok) onRemoved(day.id);
                    }}
                    armedClassName="flex flex-wrap items-center justify-end gap-2"
                    deleteClassName="shrink-0 rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:border-red-500 hover:text-red-400"
                  />
                }
              />
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function CrewScheduleBoard({
  upcoming,
  missingHours,
  jobs,
  workers,
  crafts,
  canWrite,
  today,
}: {
  upcoming: ScheduleDay[];
  missingHours: ScheduleDay[];
  jobs: JobOption[];
  workers: WorkerOption[];
  crafts: CraftOption[];
  canWrite: boolean;
  today: string;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState(upcoming);
  const [pending, startTransition] = useTransition();

  const byDate = rows.reduce<Record<string, ScheduleDay[]>>((acc, day) => {
    (acc[day.workDate] ??= []).push(day);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort();

  return (
    <>
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-label">Who is on, next two weeks</h2>
          {canWrite && (
            // Collapsed behind a button, like every other list page in this
            // app — a form open by default on a page you came to READ is
            // noise on every visit.
            <button
              type="button"
              onClick={() => {
                setAdding((open) => !open);
                setError(null);
              }}
              className="min-h-11 rounded-md border border-line-card px-3 text-sm text-ink-label hover:border-link hover:text-link"
            >
              {adding ? "Cancel" : "Put someone on"}
            </button>
          )}
        </div>

        {adding && (
          <form
            data-testid="crew-schedule-form"
            action={(formData) =>
              startTransition(async () => {
                const result = await scheduleCrewDay(formData);
                if (result.ok) {
                  setError(null);
                  setAdding(false);
                  // The row list is refreshed by the action's revalidate;
                  // closing the form is what tells the person it worked.
                } else {
                  setError(result.error);
                }
              })
            }
            className="mb-4 space-y-3 rounded-lg border border-line-card bg-surface p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-ink-label">Job</span>
                <select
                  name="jobId"
                  required
                  className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink"
                >
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {jobPickerLabel(job)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-ink-label">Who</span>
                <select
                  name="worker"
                  required
                  className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink"
                >
                  {workers.map((worker) => (
                    <option key={worker.value} value={worker.value}>
                      {worker.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-ink-label">Day</span>
                <input
                  type="date"
                  name="workDate"
                  required
                  defaultValue={today}
                  className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-label">As (optional)</span>
                <select
                  name="craftClassificationId"
                  className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink"
                >
                  <option value="">Not said</option>
                  {crafts.map((craft) => (
                    <option key={craft.id} value={craft.id}>
                      {craft.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-ink-label">Note (optional)</span>
              <input
                name="note"
                maxLength={200}
                placeholder="Half day, starts at the hoist…"
                className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
              />
            </label>
            {error && (
              <p className="text-sm text-tag-rose-ink" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {pending ? "Putting them on…" : "Put them on"}
            </button>
          </form>
        )}

        {dates.length === 0 ? (
          <div className="rounded-lg border border-line-card bg-surface p-6">
            <p className="text-ink-label">Nobody is on the schedule for the next two weeks.</p>
            <p className="mt-2 max-w-xl text-sm text-ink-body">
              This is who is planned to be where, by day — which is a different thing from the crew
              attached to a job. Nothing fills it in for you, and a day nobody planned is not a day
              nobody worked.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {dates.map((date) => (
              <DayGroup
                key={date}
                date={date}
                days={byDate[date]}
                canWrite={canWrite}
                onRemoved={(id) => setRows((current) => current.filter((row) => row.id !== id))}
              />
            ))}
          </ul>
        )}
      </section>

      {/* The second question the model answers, and the one worth the most.
          Deliberately worded as a claim about PAPERWORK and never about a
          person: "nobody logged" rather than "did not work". */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Planned days with no hours logged</h2>
        {missingHours.length === 0 ? (
          <div className="rounded-lg border border-line-card bg-surface p-6">
            <p className="text-ink-label">
              Every planned day in the last eight weeks has hours against it.
            </p>
            <p className="mt-2 max-w-xl text-sm text-ink-body">
              This only sees days somebody put on the schedule. A day nobody planned cannot show up
              here, so an empty list is not proof that every hour was logged.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {missingHours.map((day) => (
              <li key={day.id} className="px-4 py-3">
                <p className="text-sm text-ink">
                  {day.worker}
                  <span className="text-ink-muted"> · {day.workDate}</span>
                </p>
                <p className="text-xs text-ink-body">
                  <Link href={`/jobs/${day.jobId}`} className="underline hover:text-link">
                    {day.jobName}
                  </Link>
                  <span className="text-ink-muted">
                    {" "}
                    — planned, and nobody logged hours. That is a gap in the paperwork, not a claim
                    that they did not work.
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
