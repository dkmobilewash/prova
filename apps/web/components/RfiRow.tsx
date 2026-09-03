"use client";

import { useState, useTransition } from "react";
import { answerRfi, deleteRfi, markRfiSent, setRfiClosed, updateRfi } from "@/lib/actions";
import { RfiFields, fieldInputClass, labelClass, type RfiDefaults } from "@/components/RfiFields";
import { daysBetween, isOverdue, statusLabel } from "@/components/rfiLabels";
import { localToday } from "@/components/localToday";

export type RfiRowData = RfiDefaults & {
  id: string;
  number: number;
  jobName: string;
  status: string;
  sentOn: string | null;
  answeredOn: string | null;
  answer: string | null;
  costImpact: boolean;
  scheduleImpact: boolean;
  askedByName: string | null;
};

// 44px, from 34px.  +  is what makes min-h centre
// the label rather than pin it to the top.
const btn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function RfiRow({
  rfi,
  today,
  canDelete,
  showJob,
}: {
  rfi: RfiRowData;
  today: string;
  canDelete: boolean;
  showJob: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "answer">("view");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<void>, fallback: string) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : fallback);
      }
    });
  }

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(async () => {
              await updateRfi(rfi.id, formData);
              setMode("view");
            }, "Could not save changes");
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">
            RFI {rfi.number} · {rfi.jobName}
          </p>
          <RfiFields defaults={rfi} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
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

  if (mode === "answer") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(async () => {
              await answerRfi(rfi.id, formData);
              setMode("view");
            }, "Could not record the answer");
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">
            Record the answer to RFI {rfi.number}
          </p>

          <label className={labelClass}>
            Answer as given
            <textarea
              name="answer"
              required
              rows={3}
              defaultValue={rfi.answer ?? ""}
              placeholder="Paste or summarise the written response"
              className={fieldInputClass}
            />
          </label>

          <label className={labelClass}>
            Date the answer came back
            <input
              type="date"
              name="answeredOn"
              defaultValue={rfi.answeredOn ?? localToday()}
              className={fieldInputClass}
            />
            {/* slate-400 — slate-500 measures 3.83:1 here, under the 4.5 floor
                for text, and this is the sentence that stops a late answer
                being recorded as an on-time one. */}
            <span className="text-xs text-slate-400">
              The date it actually came back, not today — an answer entered late must not read as a late
              answer.
            </span>
          </label>

          {/* The whole label row is the tap target, and `min-h-11` makes it
              44px instead of the 20px it was. The box itself goes 16px → 20px:
              these two ticks are what marks an RFI worth pulling into a change
              order, so a miss costs money later. */}
          <label className="flex min-h-11 items-center gap-3 py-2 text-sm text-slate-300">
            <input
              type="checkbox"
              name="costImpact"
              defaultChecked={rfi.costImpact}
              className="h-5 w-5 shrink-0 accent-blue-500"
            />
            The answer changes cost
          </label>
          <label className="flex min-h-11 items-center gap-3 py-2 text-sm text-slate-300">
            <input
              type="checkbox"
              name="scheduleImpact"
              defaultChecked={rfi.scheduleImpact}
              className="h-5 w-5 shrink-0 accent-blue-500"
            />
            The answer changes schedule
          </label>
          <p className="-mt-1 text-xs text-slate-400">
            These don&apos;t create a change order. They mark the RFIs worth pulling when someone builds
            one.
          </p>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Record answer"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const overdue = isOverdue(rfi, today);
  // The actions now refuse an answer dated before the send, so this can't
  // go negative — but a day count is the number people will quote in a
  // dispute, so it doesn't get to render nonsense even if data predating
  // that check is still around.
  const rawDays = rfi.sentOn ? daysBetween(rfi.sentOn, rfi.answeredOn ?? today) : null;
  const openDays = rawDays !== null && rawDays >= 0 ? rawDays : null;

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-400">RFI {rfi.number}</span>
          <span className="text-slate-100">{rfi.subject}</span>
          {overdue ? (
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">
              Overdue
            </span>
          ) : (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
              {statusLabel(rfi.status)}
            </span>
          )}
          {rfi.costImpact && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300">Cost</span>
          )}
          {rfi.scheduleImpact && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300">Schedule</span>
          )}
        </div>

        <p className="mt-1 text-sm text-slate-300">{rfi.question}</p>

        {rfi.answer && (
          <p className="mt-2 border-l-2 border-slate-700 pl-3 text-sm text-slate-400">{rfi.answer}</p>
        )}

        {/* slate-400, not slate-500 — measured 3.83:1 on the slate-900 card,
            under the 4.5 floor. These dates ARE the delay claim; this page's
            own intro says "we asked and nobody got back to us" is worth
            nothing without them. They do not get to be the faintest line. */}
        <p className="mt-1 text-xs text-slate-400">
          {showJob && <span className="text-blue-400">{rfi.jobName} · </span>}
          {rfi.sentOn ? `sent ${rfi.sentOn}` : "not sent"}
          {rfi.dueBy && ` · due ${rfi.dueBy}`}
          {rfi.answeredOn && ` · answered ${rfi.answeredOn}`}
          {openDays !== null && ` · ${openDays} day${openDays === 1 ? "" : "s"}`}
        </p>
        <p className="text-xs text-slate-400">
          {[rfi.drawingReference, rfi.specSection].filter(Boolean).join(" · ")}
          {rfi.askedByName && `${rfi.drawingReference || rfi.specSection ? " · " : ""}raised by ${rfi.askedByName}`}
        </p>

        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {rfi.status === "DRAFT" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => markRfiSent(rfi.id), "Could not mark it sent")}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Mark sent
          </button>
        )}

        {(rfi.status === "SENT" || rfi.status === "ANSWERED") && (
          <button type="button" disabled={isPending} onClick={() => setMode("answer")} className={btn}>
            {rfi.status === "ANSWERED" ? "Edit answer" : "Record answer"}
          </button>
        )}

        {rfi.status === "ANSWERED" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => setRfiClosed(rfi.id, true), "Could not close it")}
            className={btn}
          >
            Close
          </button>
        )}

        {rfi.status === "CLOSED" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => setRfiClosed(rfi.id, false), "Could not reopen it")}
            className={btn}
          >
            Reopen
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
          rfi.status === "DRAFT" &&
          (isConfirmingDelete ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => deleteRfi(rfi.id), "Could not delete the draft")}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
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
              Delete draft
            </button>
          ))}
      </div>
    </li>
  );
}
