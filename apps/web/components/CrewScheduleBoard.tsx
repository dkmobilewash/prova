"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { jobPickerLabel, type JobOption } from "@/components/jobLabels";
import { localToday } from "@/components/localToday";
import { primaryActionClass } from "@/components/emptyStateStyles";
import { dayLabel } from "@/components/fieldReportWeeks";
import { blocksImplicitSubmit } from "@/lib/crew-schedule";
import { scheduleCrewDay, unscheduleCrewDay } from "@/lib/actions";
import { CrewPicker, ManageCrews, SaveCrew, type SavedCrew } from "@/components/SavedCrews";

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
}: {
  date: string;
  days: ScheduleDay[];
  canWrite: boolean;
}) {
  return (
    <li className="px-4 py-3">
      <p className="text-sm font-semibold text-ink-label">{dayLabel(date)}</p>
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
                    describe={`Takes ${day.worker} off ${day.jobName} on ${dayLabel(date)}. It does not touch any hours already logged.`}
                    pinned="end"
                    // The revalidate inside the action is what removes the
                    // row from the screen. Nothing here filters a local copy.
                    action={async () => {
                      await unscheduleCrewDay(day.id);
                    }}
                    armedClassName="flex flex-wrap items-center justify-end gap-2"
                    deleteClassName="shrink-0 rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:border-red-500 hover:text-danger"
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
  week,
  initialJobId,
  startOpen = false,
  crews = [],
  canArchiveCrews = false,
}: {
  upcoming: ScheduleDay[];
  missingHours: ScheduleDay[];
  /** Jobs the form offers — already without COMPLETE ones (schedulableJobs). */
  jobs: JobOption[];
  workers: WorkerOption[];
  crafts: CraftOption[];
  canWrite: boolean;
  /** The week board, rendered under the form and above the two-week list. */
  week?: ReactNode;
  /** `?job=` — the Crew tab's "Schedule crew" link preselects its job. */
  initialJobId?: string;
  /** `?add=1` — open the form on arrival. */
  startOpen?: boolean;
  /** Saved crews, for the picker that ticks their people. */
  crews?: SavedCrew[];
  /** Archiving a crew is owner-only (the action refuses anyone else too). */
  canArchiveCrews?: boolean;
}) {
  const [adding, setAdding] = useState(startOpen);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // The job the form opens on: the one asked for, else the last one saved
  // to, else the only one there is, else nothing — never "the first job",
  // which was a COMPLETE one (ux medium-B #10).
  const [lastJob, setLastJob] = useState(
    initialJobId && jobs.some((job) => job.id === initialJobId)
      ? initialJobId
      : jobs.length === 1
        ? jobs[0].id
        : "",
  );
  const [pending, startTransition] = useTransition();
  // The crew picker and "save as a crew" read and tick this form's boxes.
  const formRef = useRef<HTMLFormElement>(null);

  // RENDERED FROM PROPS, NEVER FROM STATE, and this cost a click test.
  //
  // It was `useState(upcoming)`, held so a removal could filter the row out
  // optimistically. `useState` takes its argument as an INITIAL value and
  // ignores it on every later render — so after a successful create the
  // action revalidated, the server sent fresh props, and the list went on
  // rendering the empty array it was born with. The row was in the database
  // and the screen said "Nobody is on the schedule for the next two weeks".
  //
  // That is this repo's "successful write, empty list" shape (issue #61),
  // and unlike #61 the cause here is known and was mine. Both actions call
  // revalidatePath, and CLAUDE.md's own reading of the Next source says an
  // action that revalidates and RETURNS a value re-renders the client with
  // no router.refresh() at all — so the optimistic copy was not buying
  // anything it was not also breaking.
  const byDate = upcoming.reduce<Record<string, ScheduleDay[]>>((acc, day) => {
    (acc[day.workDate] ??= []).push(day);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort();

  return (
    <>
      <section className="mb-10" data-tour="schedule-crew-board">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Who is on where</h2>
          {canWrite && (
            // Collapsed behind a button, like every other list page in this
            // app — a form open by default on a page you came to READ is
            // noise on every visit.
            <button
              type="button"
              data-tour="schedule-put-on"
              onClick={() => {
                setAdding((open) => !open);
                setError(null);
                setSaved(null);
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
            ref={formRef}
            // onSubmit, NOT `action={...}`. In React 19 a form `action`
            // resets the form before the action runs, whatever it returns
            // (`startHostTransition` -> `requestFormReset`), so a refused
            // save showed "already on that job that day" next to a form
            // that had snapped back to the first job, the first worker and
            // today. Reset only on success. formActionCensus.test.ts keeps
            // this from coming back.
            // Enter in a select (or any field) does not save: only the
            // button does. Enter-after-picking-a-job saved a default person
            // on today, twice, with nothing on screen (ux medium-B #8).
            onKeyDown={(event) => {
              if (blocksImplicitSubmit(event.key, (event.target as HTMLElement).tagName)) {
                event.preventDefault();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const formData = new FormData(form);
              startTransition(async () => {
                const result = await scheduleCrewDay(formData);
                if (result.ok) {
                  // No form.reset(): the form unmounts on close, and the
                  // next open starts on this job rather than the first.
                  setLastJob(String(formData.get("jobId") ?? ""));
                  setSaved(result.value.message);
                  setError(null);
                  setAdding(false);
                  // The row list is refreshed by the action's revalidate;
                  // closing the form is what tells the person it worked.
                } else {
                  setError(result.error);
                }
              });
            }}
            className="mb-4 space-y-3 rounded-lg border border-line-card bg-surface p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-ink-label">Job</span>
                <select
                  name="jobId"
                  required
                  defaultValue={lastJob}
                  className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink"
                >
                  <option value="" disabled>
                    Pick a job
                  </option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {jobPickerLabel(job)}
                    </option>
                  ))}
                </select>
              </label>
              {/* Checkboxes, not a <select multiple>: ctrl-click is not a
                  thing anyone does on a phone, and a crew is several people. */}
              <fieldset className="text-sm sm:row-span-3">
                <legend className="text-ink-label">Who (pick one or more)</legend>
                <CrewPicker crews={crews} formRef={formRef} />
                <div className="mt-1 max-h-64 overflow-y-auto rounded-md border border-line-card">
                  {workers.map((worker) => (
                    <label key={worker.value} className="flex min-h-11 items-center gap-2 px-3 text-ink">
                      <input type="checkbox" name="worker" value={worker.value} className="size-4" />
                      {worker.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm">
                <span className="text-ink-label">From</span>
                <input
                  type="date"
                  name="workDate"
                  required
                  // THE USER'S calendar date, not the server's — and the
                  // difference is a whole day, not a nicety. The first
                  // click test of this ran at 18:04 Mountain, where UTC is
                  // already tomorrow, and the form pre-filled 09-18 for a
                  // foreman whose day was the 17th. localToday.ts's own
                  // comment describes exactly that case.
                  //
                  // Safe to call during render here for the reason that
                  // file gives: this form only exists once somebody has
                  // clicked "Put someone on", so it is never in
                  // server-rendered markup and cannot break hydration.
                  defaultValue={localToday()}
                  className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-label">To (optional — blank for one day)</span>
                <input
                  type="date"
                  name="endDate"
                  className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="skipWeekends" defaultChecked className="size-4" />
                Skip Saturdays and Sundays in a range
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
            <SaveCrew formRef={formRef} />
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
        {adding && <ManageCrews crews={crews} canArchive={canArchiveCrews} />}

        {saved && (
          <p className="mb-4 text-sm text-ink" role="status">
            {saved}
          </p>
        )}

        {week}

        <h3 className="mb-2 text-base font-semibold text-ink">Next two weeks, as a list</h3>
        {dates.length === 0 ? (
          <div className="rounded-lg border border-line-card bg-surface p-6">
            <p className="text-ink-label">Nobody is on the schedule for the next two weeks.</p>
            <p className="mt-2 max-w-xl text-sm text-ink-body">
              This is who is planned to be where, by day — which is a different thing from the crew
              attached to a job. Nothing fills it in for you, and a day nobody planned is not a day
              nobody worked.
            </p>
            {/* THE WAY OUT, when there is nobody to put on. The page hides
                "Put someone on" while the company has no people
                (schedule/page.tsx passes canWrite false), so without this the
                box was a wall: getting-started step 5 sent a new owner here to
                "put someone on the schedule" and there was nothing to press. */}
            {workers.length === 0 && (
              <div className="mt-4">
                <p className="mb-3 max-w-xl text-sm text-ink-body">
                  There is nobody to put on yet. Add your crew on the Team page — foremen, journeymen and
                  apprentices, no login needed — and they show up here to schedule.
                </p>
                <Link href="/team" className={primaryActionClass}>
                  Add your crew on Team
                </Link>
              </div>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {dates.map((date) => (
              <DayGroup
                key={date}
                date={date}
                days={byDate[date]}
                canWrite={canWrite}
              />
            ))}
          </ul>
        )}
      </section>

      {/* The second question the model answers, and the one worth the most.
          Deliberately worded as a claim about PAPERWORK and never about a
          person: "nobody logged" rather than "did not work". */}
      <section className="mb-10" data-tour="schedule-missing-hours">
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
              <li key={day.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    {day.worker}
                    <span className="text-ink-muted"> · {dayLabel(day.workDate)}</span>
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
                </div>
                {/* A day that has already gone by can be taken off the
                    schedule HERE, and nowhere else in the product — which
                    is the whole reason this control exists. Removal lived
                    only on the two-week list above, so a plan entered by
                    mistake, or one for a job that was called off, could be
                    made and never unmade: the day aged out of the top list
                    and stayed on the record with nothing anywhere able to
                    correct it.

                    The objection to putting it here is real, and it is
                    answered in the sentence rather than by leaving people
                    stuck: this is a gap report, so a Remove on it could be
                    used to make a gap disappear. `describe` therefore says
                    exactly what removal does and does not do — it unmakes
                    the PLAN, it does not record the HOURS, and the row
                    leaves this list because nobody is planned on that day
                    any more. Same capability as every other change on this
                    page (MANAGE_FIELD, asserted in the action itself),
                    same two-step confirm, and no logged hours are touched
                    because by definition there are none. */}
                {canWrite && (
                  <RowActions
                    className="flex shrink-0 flex-col items-end gap-1"
                    destructive={
                      <ConfirmDelete
                        label="Remove"
                        confirmLabel="Remove it"
                        describe={`Takes ${day.worker} off ${day.jobName} on ${dayLabel(day.workDate)}, a day that has already gone by. It records no hours: the row leaves this list because nobody is planned on that day any more, not because the hours were logged.`}
                        pinned="end"
                        action={async () => {
                          await unscheduleCrewDay(day.id);
                        }}
                        armedClassName="flex flex-wrap items-center justify-end gap-2"
                        deleteClassName="shrink-0 rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:border-red-500 hover:text-danger"
                      />
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
