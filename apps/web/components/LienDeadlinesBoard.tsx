"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { jobPickerLabel, type JobOption } from "@/components/jobLabels";
import { localToday } from "@/components/localToday";
import {
  clearLienDeadlineServed,
  createLienDeadline,
  deleteLienDeadline,
  markLienDeadlineServed,
  updateLienDeadline,
} from "@/lib/actions";
import { LIEN_DEADLINE_KINDS, lienKindLabel, type LienDeadlineState } from "@/lib/lien-deadlines";
import type { ActionResult } from "@/lib/actions/shared";

/**
 * The lien-deadline list: record one, correct it, mark it served.
 *
 * A client component because every action here RETURNS its failure, and
 * the sentences this screen most needs to say — "that date is not valid",
 * "that date is in the future" — are useless if nothing renders them.
 *
 * THE APP NEVER COMPUTES THE DEADLINE. Every date field on this screen is
 * typed by a person and none of them has a computed default. The served
 * date defaults to the person's own today (localToday), which is a
 * convenience for the common case of marking it the day it went out, and
 * is a date input they can change before saving.
 *
 * Rendered from props, never from a useState copy of them: the crew
 * schedule shipped `useState(upcoming)` and showed an empty list after a
 * successful create, because useState ignores its argument after the first
 * render. The actions revalidate; the props are the list.
 *
 * EVERY FORM SUBMITS THROUGH onSubmit, NEVER `<form action>`. React resets
 * a form handed to `action` BEFORE the action runs (react-dom's
 * startHostTransition calls requestFormReset unconditionally), so a
 * returned refusal — "that date is in the future" — used to arrive over a
 * form it had already emptied. `submitForm` below prevents the browser
 * submit, runs the action in a transition, and resets only on success;
 * LogTimeEntryForm is the reference.
 */

/** The one submit path every form here uses. A failed save leaves every
 * field exactly as typed; only a successful one clears the form. */
function submitForm(
  event: FormEvent<HTMLFormElement>,
  startTransition: (callback: () => Promise<void>) => void,
  call: (formData: FormData) => Promise<ActionResult>,
  onResult: (result: ActionResult) => void,
) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  startTransition(async () => {
    const result = await call(formData);
    if (result.ok) {
      form.reset();
    }
    onResult(result);
  });
}

export type LienDeadlineRow = {
  id: string;
  jobId: string;
  jobName: string;
  kind: string;
  otherLabel: string | null;
  dueOn: string;
  servedOn: string | null;
  recipient: string | null;
  note: string | null;
  state: LienDeadlineState;
  /** Positive = days left, negative = days overdue. Null once served. */
  daysUntilDue: number | null;
  servedAfterDueDate: boolean;
};

const inputClass =
  "mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted";
const smallButton =
  "min-h-9 rounded-md border border-line-card px-3 text-xs text-ink-label hover:border-link hover:text-link disabled:opacity-50";
const primaryButton =
  "min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50";

/** The fields a deadline is made of, shared by create and edit so the two
 * cannot drift. Job and kind are only offered on create: they are what the
 * row IS, and the edit action refuses to change them. */
function LienDeadlineFields({
  jobs,
  editing,
}: {
  jobs: JobOption[];
  editing?: LienDeadlineRow;
}) {
  const [kind, setKind] = useState(editing?.kind ?? "PRELIMINARY_NOTICE");

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {!editing && (
        <>
          <label className="block text-sm">
            <span className="text-ink-label">Job</span>
            {/* Starts on a placeholder, as every other picker does: without
                one the browser preselects the first (newest) job, and a
                deadline saved without touching this is filed against it —
                with no way to move it, since job is not editable. */}
            <select name="jobId" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Choose a job
              </option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {jobPickerLabel(job)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-ink-label">What it is</span>
            <select
              name="kind"
              required
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              className={inputClass}
            >
              {LIEN_DEADLINE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {value === "OTHER" ? "Something else" : lienKindLabel(value, null)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {kind === "OTHER" && (
        <label className="block text-sm">
          <span className="text-ink-label">Called</span>
          <input
            name="otherLabel"
            required
            maxLength={120}
            defaultValue={editing?.otherLabel ?? ""}
            placeholder="Notice of intent to lien, Miller Act 90-day notice…"
            className={inputClass}
          />
        </label>
      )}
      <label className="block text-sm">
        <span className="text-ink-label">Deadline — from your counsel or the statute</span>
        {/* NO DEFAULT, deliberately. Every other date form in this app
            pre-fills today; this one must not, because a deadline the app
            filled in is a deadline the app computed. */}
        <input name="dueOn" type="date" required defaultValue={editing?.dueOn ?? ""} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-ink-label">Who it goes to (optional)</span>
        <input
          name="recipient"
          maxLength={200}
          defaultValue={editing?.recipient ?? ""}
          placeholder="Owner, GC, lender, bonding company…"
          className={inputClass}
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="text-ink-label">Note (optional)</span>
        <input
          name="note"
          maxLength={500}
          defaultValue={editing?.note ?? ""}
          placeholder="First furnished 9/2 per delivery ticket; counsel confirmed the date"
          className={inputClass}
        />
      </label>
    </div>
  );
}

function stateLine(row: LienDeadlineRow): { text: string; className: string } {
  if (row.state === "served") {
    return {
      text: row.servedAfterDueDate
        ? `Served ${row.servedOn} — after the ${row.dueOn} deadline you entered. Whether that still counts is a question for counsel.`
        : `Served ${row.servedOn}`,
      className: "text-ink-muted",
    };
  }
  const days = row.daysUntilDue ?? 0;
  if (row.state === "overdue") {
    return {
      text: `OVERDUE — due ${row.dueOn}, ${-days} day${days === -1 ? "" : "s"} ago, and not marked served`,
      className: "font-semibold text-tag-rose-ink",
    };
  }
  if (days === 0) return { text: `Due TODAY (${row.dueOn})`, className: "font-semibold text-tag-rose-ink" };
  return {
    text: `Due ${row.dueOn} — ${days} day${days === 1 ? "" : "s"} left`,
    className: row.state === "due_soon" ? "font-semibold text-ink" : "text-ink-body",
  };
}

function DeadlineRow({
  row,
  jobs,
  canRemove,
}: {
  row: LienDeadlineRow;
  jobs: JobOption[];
  canRemove: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "serve">("view");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const status = stateLine(row);
  const title = lienKindLabel(row.kind, row.otherLabel);

  const submit = (event: FormEvent<HTMLFormElement>, call: (formData: FormData) => Promise<ActionResult>) =>
    submitForm(event, startTransition, call, (result) => {
      if (result.ok) {
        setError(null);
        setMode("view");
      } else {
        setError(result.error);
      }
    });

  return (
    <li
      className={`px-4 py-3 ${row.state === "overdue" ? "border-l-4 border-bar-rose bg-tag-rose" : ""}`}
      data-state={row.state}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-ink">
            {title}
            {row.recipient && <span className="text-ink-muted"> · to {row.recipient}</span>}
          </p>
          <p className="text-xs text-ink-body">
            <Link href={`/jobs/${row.jobId}`} className="underline hover:text-link">
              {row.jobName}
            </Link>
            {row.note && <span className="text-ink-muted"> — {row.note}</span>}
          </p>
          <p className={`mt-1 text-sm ${status.className}`}>{status.text}</p>
        </div>
        {/* Two RowActions rather than one with a ternary inside
            `destructive`: each ConfirmDelete then sits directly in its own
            `destructive={…}`, which is the shape rowActionsCensus reads. */}
        {mode === "view" && row.servedOn && (
          <RowActions
            className="flex shrink-0 flex-wrap items-center gap-2"
            destructive={
              canRemove ? (
                <ConfirmDelete
                  // Twelve characters at most (rowActionsCensus): what is
                  // being undone belongs in `describe`, not in the button.
                  label="Undo served"
                  confirmLabel="Take it off"
                  describe={`Clears the served date (${row.servedOn}) from this ${title.toLowerCase()}. Only do this if it was entered against the wrong row.`}
                  pinned="end"
                  action={async () => {
                    const result = await clearLienDeadlineServed(row.id);
                    if (!result.ok) setError(result.error);
                  }}
                />
              ) : null
            }
          />
        )}
        {mode === "view" && !row.servedOn && (
          <RowActions
            className="flex shrink-0 flex-wrap items-center gap-2"
            destructive={
              canRemove ? (
                <ConfirmDelete
                  label="Remove"
                  confirmLabel="Remove it"
                  describe={`Removes this ${title.toLowerCase()} deadline on ${row.jobName}. It drops off the alerts list, and nothing will remind anyone about it again.`}
                  pinned="end"
                  action={async () => {
                    const result = await deleteLienDeadline(row.id);
                    if (!result.ok) setError(result.error);
                  }}
                />
              ) : null
            }
          >
            <button type="button" className={smallButton} onClick={() => setMode("serve")}>
              Mark served
            </button>
            <button type="button" className={smallButton} onClick={() => setMode("edit")}>
              Edit
            </button>
          </RowActions>
        )}
      </div>

      {mode === "serve" && (
        <form
          onSubmit={(event) => submit(event, (formData) => markLienDeadlineServed(row.id, formData))}
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <label className="block text-sm">
            <span className="text-ink-label">Served or recorded on — the date on the proof</span>
            {/* The person's own today, safe during render because this form
                only exists after a click (localToday.ts). A default for the
                SERVED date is a convenience; the DEADLINE never gets one. */}
            <input name="servedOn" type="date" required defaultValue={localToday()} className={inputClass} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Saving…" : "Mark served"}
            </button>
            <button type="button" className={smallButton} onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "edit" && (
        <form
          onSubmit={(event) => submit(event, (formData) => updateLienDeadline(row.id, formData))}
          className="mt-3 space-y-3 rounded-lg border border-line-card p-3"
        >
          <LienDeadlineFields jobs={jobs} editing={row} />
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" className={smallButton} onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="mt-2 text-sm text-tag-rose-ink" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function LienDeadlinesBoard({
  rows,
  jobs,
  canRemove,
}: {
  rows: LienDeadlineRow[];
  jobs: JobOption[];
  canRemove: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = rows.filter((row) => row.state !== "served");
  const served = rows.filter((row) => row.state === "served");

  return (
    <>
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between gap-3" data-tour="lien-add">
          <h2 className="text-sm font-semibold text-ink-label">Not served yet</h2>
          <button
            type="button"
            onClick={() => {
              setAdding((value) => !value);
              setError(null);
            }}
            disabled={jobs.length === 0}
            className="min-h-11 rounded-md border border-line-card px-3 text-sm text-ink-label hover:border-link hover:text-link disabled:opacity-50"
          >
            {adding ? "Cancel" : "Add a deadline"}
          </button>
        </div>

        {adding && (
          <form
            data-testid="lien-deadline-form"
            onSubmit={(event) =>
              submitForm(event, startTransition, createLienDeadline, (result) => {
                if (result.ok) {
                  setError(null);
                  setAdding(false);
                } else {
                  setError(result.error);
                }
              })
            }
            className="mb-4 space-y-3 rounded-lg border border-line-card bg-surface p-4"
          >
            <LienDeadlineFields jobs={jobs} />
            {error && (
              <p className="text-sm text-tag-rose-ink" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Saving…" : "Save deadline"}
            </button>
          </form>
        )}

        {open.length === 0 ? (
          <div className="rounded-lg border border-line-card bg-surface p-6" data-tour="lien-empty">
            <p className="text-ink-label">No lien deadlines waiting on you.</p>
            <p className="mt-2 max-w-xl text-sm text-ink-body">
              This app never works out a lien deadline for you — the dates depend on the state,
              public or private work, and your tier, and a wrong one can cost you lien rights. Get
              the date from your attorney or the statute and add it here. Until it is marked served,
              it stays on this list, and from 14 days out it is on the alerts list too. An empty list
              means nothing has been entered, not that no deadline is running.
            </p>
            {jobs.length === 0 && (
              <p className="mt-2 text-sm text-ink-body">
                <Link href="/jobs/new" className="underline hover:text-link">
                  Add a job
                </Link>{" "}
                first — every deadline belongs to one.
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="lien-open">
            {open.map((row) => (
              <DeadlineRow key={row.id} row={row} jobs={jobs} canRemove={canRemove} />
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10" data-tour="lien-served">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Served</h2>
        {served.length === 0 ? (
          <div className="rounded-lg border border-line-card bg-surface p-6">
            <p className="text-ink-label">Nothing marked served yet.</p>
            <p className="mt-2 max-w-xl text-sm text-ink-body">
              When a notice goes out or a claim is recorded, mark it served with the date on the proof.
              It stays here as the record.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {served.map((row) => (
              <DeadlineRow key={row.id} row={row} jobs={jobs} canRemove={canRemove} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
