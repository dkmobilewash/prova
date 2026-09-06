"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTimeEntry, updateTimeEntry } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { money } from "@/lib/money";

/**
 * One logged time entry, with a two-step delete and a correction path that
 * keeps the original (issue #63).
 *
 * These are certified payroll hours. On a prevailing-wage job they are the
 * record produced when somebody asks what a person was paid and for what,
 * and the prevailing-wage review already compares them against a rule set
 * and reports where the two disagree — a comparison that only means
 * anything if the entered figure is a RECORD.
 *
 * It was neither. A single click on "Remove" destroyed the row with no
 * guard, and correcting a figure meant deleting it and typing a new one, so
 * nothing showed a correction had been made, when, or by whom. Time entries
 * were the only delete in the app without the two-step guard CLAUDE.md
 * names as a list-page convention, and the highest-consequence rows in it.
 *
 * Two things follow from that, and both are structural rather than
 * remembered:
 *
 *  1. The delete goes through `<RowActions>`, so arming it hides EVERY
 *     other action on the row — including the "Correct" button, and
 *     including whatever gets added here later. Twenty-one hand-rolled
 *     copies of this guard were found leaving an ordinary action live
 *     beside an armed confirm; this row does not get to be the
 *     twenty-second.
 *  2. The correction form has no field for the employee or the date. They
 *     are the entry's identity, they are locked by `updateTimeEntry`, and
 *     they are locked here by there being nothing to type them into. A
 *     wrong date is a different day's work: a new entry and a deleted one,
 *     not an edit.
 */

export type TimeEntryCorrectionView = {
  id: string;
  correctedByName: string;
  /** Rendered by the server; this component never formats a date itself. */
  correctedAtLabel: string;
  reason: string;
  previousHours: number;
  previousPayTypeLabel: string;
  previousCraftLabel: string | null;
  previousLineItemLabel: string | null;
  previousPerDiemAmount: number | null;
  previousTravelPayAmount: number | null;
  previousNote: string | null;
};

export type TimeEntryView = {
  id: string;
  dateLabel: string;
  employeeName: string;
  hours: number;
  payType: string;
  payTypeLabel: string;
  craftClassificationId: string | null;
  craftLabel: string | null;
  lineItemId: string | null;
  lineItemLabel: string | null;
  estimatedCost: number | null;
  perDiemAmount: number | null;
  travelPayAmount: number | null;
  note: string | null;
  corrections: TimeEntryCorrectionView[];
};

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-xs text-slate-400";
const btn =
  "rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function TimeEntryRow({
  jobId,
  entry,
  payTypes,
  lineItems,
  crafts,
  canDelete,
}: {
  jobId: string;
  entry: TimeEntryView;
  payTypes: { value: string; label: string }[];
  lineItems: { id: string; description: string }[];
  crafts: { id: string; label: string }[];
  canDelete: boolean;
}) {
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        router.refresh();
        onOk?.();
      } else {
        setError(result.error);
      }
    });
  }

  if (isCorrecting) {
    return (
      <li className="rounded-lg border border-blue-900 bg-slate-900 p-3 text-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => updateTimeEntry(jobId, entry.id, formData),
              () => setIsCorrecting(false),
            );
          }}
          className="flex flex-col gap-3"
        >
          {/* The locked half, shown so it is obvious what a correction is
              NOT allowed to touch. No inputs, so there is nothing for a
              later change to start reading. */}
          <p className="text-xs text-slate-400">
            Correcting <span className="text-slate-200">{entry.employeeName}</span> on{" "}
            <span className="text-slate-200">{entry.dateLabel}</span>. The person and the day
            can&apos;t be changed — that would be a different day&apos;s work, which is a new entry
            rather than a correction.
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <label className={labelClass}>
              Hours
              <input
                name="hours"
                defaultValue={entry.hours}
                required
                className={`w-20 ${inputClass}`}
              />
            </label>
            <label className={labelClass}>
              Pay type
              <select name="payType" defaultValue={entry.payType} className={inputClass}>
                {payTypes.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Cost code / SOV line
              <select
                name="lineItemId"
                defaultValue={entry.lineItemId ?? ""}
                className={inputClass}
              >
                <option value="">No specific line</option>
                {lineItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.description}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Craft classification
              <select
                name="craftClassificationId"
                defaultValue={entry.craftClassificationId ?? ""}
                className={inputClass}
              >
                <option value="">No craft tag</option>
                {crafts.map((craft) => (
                  <option key={craft.id} value={craft.id}>
                    {craft.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Per diem
              <input
                name="perDiemAmount"
                defaultValue={entry.perDiemAmount ?? ""}
                placeholder="none"
                className={`w-24 ${inputClass}`}
              />
            </label>
            <label className={labelClass}>
              Travel pay
              <input
                name="travelPayAmount"
                defaultValue={entry.travelPayAmount ?? ""}
                placeholder="none"
                className={`w-24 ${inputClass}`}
              />
            </label>
          </div>

          <label className={labelClass}>
            Note
            <input name="note" defaultValue={entry.note ?? ""} className={inputClass} />
          </label>

          <label className={labelClass}>
            What is being corrected, and why
            <input
              name="reason"
              required
              placeholder="Entered 10 hours; the timesheet says 8 straight and 2 OT."
              className={inputClass}
            />
            <span className="text-xs text-slate-500">
              Kept with the previous figures, so the record shows the change rather than replacing
              it.
            </span>
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={btn}>
              {isPending ? "Saving…" : "Save correction"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsCorrecting(false);
                setError(null);
              }}
              className={btn}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-slate-100">{entry.dateLabel}</span>
          <span className="text-slate-300">{entry.employeeName}</span>
          <span className="text-slate-400">{entry.hours}h</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
            {entry.payTypeLabel}
          </span>
          {entry.craftLabel && <span className="text-xs text-slate-500">{entry.craftLabel}</span>}
          {entry.lineItemLabel && (
            <span className="text-xs text-slate-500">{entry.lineItemLabel}</span>
          )}
          {entry.estimatedCost != null && (
            <span className="text-xs text-slate-500">Est. cost {money(entry.estimatedCost)}</span>
          )}
          {entry.perDiemAmount != null && (
            <span className="text-xs text-slate-500">Per diem {money(entry.perDiemAmount)}</span>
          )}
          {entry.travelPayAmount != null && (
            <span className="text-xs text-slate-500">Travel {money(entry.travelPayAmount)}</span>
          )}
          {entry.note && <span className="text-xs text-slate-500">— {entry.note}</span>}
          {entry.corrections.length > 0 && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300">
              corrected {entry.corrections.length}
              {entry.corrections.length === 1 ? " time" : " times"}
            </span>
          )}
        </div>

        {/* Every ordinary action is a CHILD, so arming the delete removes
            all of them. The `ConfirmDelete` is the `destructive` PROP and
            not a child — as a child it would unmount itself the instant it
            armed, because `RowActions` stops rendering children while
            armed, and the row would empty out with no confirm to click. */}
        <RowActions
          className="flex flex-wrap items-center gap-2"
          destructive={
            canDelete ? (
              <ConfirmDelete
                label="Remove"
                confirmLabel="Confirm remove"
                pending={isPending}
                pendingLabel="Removing…"
                prompt={`Remove ${entry.hours}h for ${entry.employeeName} on ${entry.dateLabel}?`}
                hint="These are payroll hours. To fix a figure, use Correct instead — it keeps the original."
                onConfirm={() => run(() => deleteTimeEntry(jobId, entry.id))}
                deleteClassName="text-xs text-red-400 hover:underline"
                cancelClassName={btn}
                confirmClassName="rounded-md border border-red-500 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                armedClassName="flex flex-wrap items-center gap-2"
              />
            ) : undefined
          }
        >
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setIsCorrecting(true);
              setError(null);
            }}
            className={btn}
          >
            Correct
          </button>
          {entry.corrections.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory((open) => !open)}
              className="text-xs text-blue-400 underline"
            >
              {showHistory ? "Hide history" : "History"}
            </button>
          )}
        </RowActions>
      </div>

      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}

      {showHistory && entry.corrections.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-l-2 border-slate-800 pl-3">
          {entry.corrections.map((correction) => (
            <li key={correction.id} className="text-xs text-slate-500">
              <span className="text-slate-400">{correction.correctedAtLabel}</span> ·{" "}
              {correction.correctedByName} · {correction.reason}
              <br />
              Was: {correction.previousHours}h {correction.previousPayTypeLabel}
              {correction.previousCraftLabel && ` · ${correction.previousCraftLabel}`}
              {correction.previousLineItemLabel && ` · ${correction.previousLineItemLabel}`}
              {correction.previousPerDiemAmount != null &&
                ` · per diem ${money(correction.previousPerDiemAmount)}`}
              {correction.previousTravelPayAmount != null &&
                ` · travel ${money(correction.previousTravelPayAmount)}`}
              {correction.previousNote && ` · ${correction.previousNote}`}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
