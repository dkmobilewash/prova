"use client";

import { useState, useTransition } from "react";
import {
  deleteSubmittal,
  recordSubmittalResponse,
  sendSubmittalRevision,
  updateSubmittal,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { inputClass, labelClass } from "@/components/RfiFields";
import { SubmittalFields, type SubmittalDefaults } from "@/components/SubmittalFields";
import {
  OUTCOMES,
  daysBetween,
  isOverdue,
  latestRevision,
  outcomeLabel,
  stateLabel,
  submittalState,
  type RevisionData,
} from "@/components/submittalLabels";
import { localToday } from "@/components/localToday";

export type SubmittalRowData = SubmittalDefaults & {
  id: string;
  number: number;
  jobName: string;
  submittedByName: string | null;
  revisions: RevisionData[];
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50";

export function SubmittalRow({
  submittal,
  today,
  canDelete,
  showJob,
}: {
  submittal: SubmittalRowData;
  today: string;
  canDelete: boolean;
  showJob: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "send" | "respond">("view");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Actions in this feature return their failures instead of throwing —
  // production redacts thrown Server Action messages to a digest,
  // verified 2026-08-27 on a real production build.
  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  const latest = latestRevision(submittal.revisions);
  const state = submittalState(submittal.revisions);
  const overdue = isOverdue(submittal.revisions, today);
  const nextRevisionNumber = (latest?.revisionNumber ?? 0) + 1;

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => updateSubmittal(submittal.id, formData),
              () => setMode("view"),
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">
            Submittal {submittal.number} · {submittal.jobName}
          </p>
          <SubmittalFields defaults={submittal} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === "send") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => sendSubmittalRevision(submittal.id, formData),
              () => setMode("view"),
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">
            {nextRevisionNumber === 1
              ? `Send submittal ${submittal.number}`
              : `Send revision ${nextRevisionNumber} of submittal ${submittal.number}`}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Date sent
              <input type="date" name="sentOn" required defaultValue={localToday()} className={inputClass} />
              <span className="text-xs text-slate-500">
                The date it actually left, not today — backdate it when you&apos;re entering history.
              </span>
            </label>
            <label className={labelClass}>
              Answer needed back by
              <input type="date" name="dueBack" defaultValue="" className={inputClass} />
            </label>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Record as sent"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === "respond") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => recordSubmittalResponse(submittal.id, formData),
              () => setMode("view"),
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">
            What came back on revision {latest?.revisionNumber} of submittal {submittal.number}?
          </p>

          <label className={labelClass}>
            The reviewer&apos;s stamp
            <select name="outcome" required defaultValue={latest?.outcome ?? ""} className={inputClass}>
              <option value="" disabled>
                Pick what the stamp said
              </option>
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            Date the response came back
            <input
              type="date"
              name="returnedOn"
              defaultValue={latest?.returnedOn ?? localToday()}
              className={inputClass}
            />
            <span className="text-xs text-slate-500">
              The date it actually came back, not today — a response entered late must not read as a
              late response.
            </span>
          </label>

          <label className={labelClass}>
            Notes on the response
            <textarea
              name="responseNotes"
              rows={2}
              defaultValue={latest?.responseNotes ?? ""}
              placeholder="What 'approved as noted' actually noted, or why it bounced."
              className={inputClass}
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Record response"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const stateChip =
    state === "APPROVED"
      ? "bg-green-500/15 text-green-300"
      : state === "REVISE"
        ? "bg-amber-500/15 text-amber-300"
        : state === "WITH_GC"
          ? "bg-blue-500/15 text-blue-300"
          : "bg-slate-800 text-slate-400";

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-500">SUB {submittal.number}</span>
          <span className="text-slate-100">{submittal.title}</span>
          {overdue ? (
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">Overdue</span>
          ) : (
            <span className={`rounded px-1.5 py-0.5 text-xs ${stateChip}`}>{stateLabel(state)}</span>
          )}
          {state === "APPROVED" && latest && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
              Build from revision {latest.revisionNumber}
            </span>
          )}
        </div>

        {submittal.description && <p className="mt-1 text-sm text-slate-300">{submittal.description}</p>}

        {submittal.revisions.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-l-2 border-slate-700 pl-3">
            {[...submittal.revisions]
              .sort((a, b) => a.revisionNumber - b.revisionNumber)
              .map((rev) => {
                const days = rev.returnedOn ? daysBetween(rev.sentOn, rev.returnedOn) : null;
                return (
                  <li key={rev.revisionNumber} className="text-xs text-slate-400">
                    <span className="font-mono text-slate-500">R{rev.revisionNumber}</span>
                    {` · sent ${rev.sentOn}`}
                    {rev.dueBack && !rev.returnedOn && ` · due back ${rev.dueBack}`}
                    {rev.returnedOn && rev.outcome && (
                      <>
                        {` · ${outcomeLabel(rev.outcome).toLowerCase()} ${rev.returnedOn}`}
                        {days !== null && days >= 0 && ` · ${days} day${days === 1 ? "" : "s"}`}
                      </>
                    )}
                    {rev.responseNotes && (
                      <span className="text-slate-500"> — {rev.responseNotes}</span>
                    )}
                  </li>
                );
              })}
          </ul>
        )}

        <p className="mt-1 text-xs text-slate-500">
          {showJob && <span className="text-blue-400">{submittal.jobName} · </span>}
          {[submittal.specSection, submittal.drawingReference].filter(Boolean).join(" · ")}
          {submittal.submittedByName &&
            `${submittal.specSection || submittal.drawingReference ? " · " : ""}logged by ${submittal.submittedByName}`}
        </p>

        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {state === "NOT_SENT" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setMode("send")}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Record as sent
          </button>
        )}

        {state === "WITH_GC" && (
          <button type="button" disabled={isPending} onClick={() => setMode("respond")} className={btn}>
            Record response
          </button>
        )}

        {state === "REVISE" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setMode("send")}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Send revision {nextRevisionNumber}
          </button>
        )}

        {state === "APPROVED" && (
          <button type="button" disabled={isPending} onClick={() => setMode("send")} className={btn}>
            Send revision {nextRevisionNumber}
          </button>
        )}

        {(state === "REVISE" || state === "APPROVED") && (
          <button type="button" disabled={isPending} onClick={() => setMode("respond")} className={btn}>
            Edit response
          </button>
        )}

        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setMode("edit");
            setIsConfirmingDelete(false);
          }}
          className={btn}
        >
          Edit
        </button>

        {canDelete &&
          state === "NOT_SENT" &&
          (isConfirmingDelete ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => deleteSubmittal(submittal.id))}
                className="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsConfirmingDelete(false)}
                className={btn}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsConfirmingDelete(true)}
              className={btn}
            >
              Delete
            </button>
          ))}
      </div>
    </li>
  );
}
