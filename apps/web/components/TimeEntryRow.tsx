"use client";

import { useState, useTransition } from "react";
import { updateTimeEntry } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import {
  TimeEntryFields,
  type TimeEntryCraftOption,
  type TimeEntryLineItemOption,
} from "@/components/TimeEntryFields";
import { timeEntryPayTypeLabel } from "@/lib/time-entry-correction";
import { money } from "@/lib/money";

export type TimeEntryRowData = {
  id: string;
  /** Formatted by the SERVER with `formatCalendarDate` — a stored calendar
   * day, rendered in UTC. A client component formatting it would render the
   * reader's zone and be a day early west of UTC (issue #101), which is why
   * this arrives as a string and not as a Date. */
  dateLabel: string;
  employeeLabel: string;
  hours: string;
  payType: string;
  note: string | null;
  perDiemAmount: string | null;
  travelPayAmount: string | null;
  lineItemId: string | null;
  lineItemLabel: string | null;
  craftClassificationId: string | null;
  craftLabel: string | null;
  /** Formatted on the server: it needs the job's fringe rate schedule, which
   * is not something a row has. Null when no schedule covers the entry's
   * craft and date — never a guessed rate (lib/labor-cost.ts). */
  estimatedCostLabel: string | null;
  /** "corrected Sep 13, 2026 by Cyrus Obiz", or null on an entry nobody has
   * corrected — which is every entry logged right the first time. */
  lastCorrectedLabel: string | null;
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

/**
 * One logged day's hours, with the two things issue #63 found missing.
 *
 * BEFORE: the row's only control was "Remove", and it deleted on the first
 * click. Correcting an hour therefore meant destroying the row and typing a
 * new one — on the records a WH-347 is built from, and the records #61's
 * sibling finding already has the app checking against a prevailing-wage rule
 * set ("entered 10 straight, rules imply 8 straight, 2 OT"). A figure that
 * can be silently replaced is not evidence.
 *
 * NOW: Remove asks twice through the shared `<ConfirmDelete>`, and Edit opens
 * the same `<TimeEntryFields>` the log form uses, with the person and the day
 * worked rendered as text rather than as inputs. Which fields those are, and
 * why, is argued in lib/time-entry-correction.ts; a BEFORE UPDATE trigger in
 * the database is what actually holds the line.
 *
 * `pinned="end"` because this cluster is right-pinned — `shrink-0` inside the
 * row's `justify-between` — so the LAST control is the one that keeps its
 * position when arming empties the row, and Cancel has to be it. Below 640px
 * the row wraps and there is no stable end at all; `ConfirmDelete` handles
 * that itself with a full-width column, Cancel on top (#184), so nothing here
 * has to know about it.
 *
 * NO `router.refresh()` after a save, deliberately. A Server Action that
 * calls `revalidatePath` and RETURNS a value re-renders the client on its
 * own — read out of the installed Next source and recorded in CLAUDE.md
 * against issue #61, where "the router refresh never fired" was the leading
 * hypothesis for a stale list and turned out to be wrong. `TakeoffForm` is
 * this app's control for that.
 */
export function TimeEntryRow({
  entry,
  lineItems,
  craftOptions,
  deleteAction,
}: {
  entry: TimeEntryRowData;
  lineItems: TimeEntryLineItemOption[];
  craftOptions: TimeEntryCraftOption[];
  /** Already bound to this job and this entry by the page, so this component
   *  decides WHEN a delete happens and never WHAT gets deleted. */
  deleteAction: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <li className="flex flex-col gap-2 rounded-lg border border-blue-900 bg-slate-900 p-3 text-sm">
        <form
          // A refusal is about the values that were submitted, so it goes the
          // moment one of them changes — otherwise "Hours has to be a
          // positive number" sits under a field that by then reads 8.
          onInput={() => setError(null)}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            startTransition(async () => {
              try {
                const result = await updateTimeEntry(entry.id, formData);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setEditing(false);
              } catch {
                // A thrown Server Action message is REDACTED to a digest in
                // production, so there is nothing to show from `err` — say
                // the one useful thing instead, which is that the hours may
                // not have changed.
                setError("Could not save that correction. Reload the page and check the entry before trying again.");
              }
            });
          }}
          className="flex flex-col gap-2"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Correcting a logged hour
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <TimeEntryFields
              lineItems={lineItems}
              craftOptions={craftOptions}
              defaults={entry}
              locked={{ employeeLabel: entry.employeeLabel, dateLabel: entry.dateLabel }}
            />
          </div>
          <p className="text-xs text-slate-500">
            The person and the day worked can&rsquo;t be corrected — an hour logged against the wrong
            name or the wrong day is a different record. Remove this entry and log the right one.
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save correction"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null);
                setEditing(false);
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
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-slate-100">{entry.dateLabel}</span>
        <span className="text-slate-300">{entry.employeeLabel}</span>
        <span className="text-slate-400">{entry.hours}h</span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
          {timeEntryPayTypeLabel(entry.payType)}
        </span>
        {entry.craftLabel && <span className="text-xs text-slate-500">{entry.craftLabel}</span>}
        {entry.lineItemLabel && <span className="text-xs text-slate-500">{entry.lineItemLabel}</span>}
        {entry.estimatedCostLabel && (
          <span className="text-xs text-slate-500">Est. cost {entry.estimatedCostLabel}</span>
        )}
        {entry.perDiemAmount != null && (
          <span className="text-xs text-slate-500">Per diem {money(Number(entry.perDiemAmount))}</span>
        )}
        {entry.travelPayAmount != null && (
          <span className="text-xs text-slate-500">Travel {money(Number(entry.travelPayAmount))}</span>
        )}
        {entry.note && <span className="text-xs text-slate-500">— {entry.note}</span>}
        {entry.lastCorrectedLabel && (
          /* The trace the issue asks for: that a correction happened, when,
             and by whom. It deliberately does not claim to say what the
             figure used to be — see labor.prisma. */
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-300">
            {entry.lastCorrectedLabel}
          </span>
        )}
      </div>

      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-2"
        destructive={
          <ConfirmDelete
            pinned="end"
            label="Remove"
            confirmLabel="Confirm remove"
            describe="Removes this logged hour from the job. Labor cost and certified payroll are recalculated from the hours that remain."
            action={deleteAction}
            /* `describe`, not `hint`, and the comment below is exactly why
               the two are not interchangeable: `hint` is a flex item of this
               shrink-0 cluster and widens the row, while `describe` wraps the
               delete button in a `<Hint>` — `display: contents` on the wrapper
               and `position: fixed` on the tooltip — so it adds no box and
               nothing here is measured differently. */
            describe="Takes these hours off the job for good, so they come off certified payroll for that week. To fix a wrong number, use Edit instead — a correction is recorded, a removal is not."
            deleteClassName="text-xs text-red-400 hover:underline disabled:opacity-50"
            cancelClassName={btn}
            confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            /* No `hint` and no `prompt`, deliberately. Both render as extra
               flex items inside this cluster, and the cluster is `shrink-0` —
               a sentence in there widens the row rather than wrapping inside
               it, and this row already carries up to nine spans of its own. I
               have no browser here to measure that at 375px, and an unmeasured
               layout change to a shared row is what CLAUDE.md's geometry
               entries are all about. The row's own text names the day, the
               person and the hours, which is what `hint` exists to supply when
               a row does not; the delete-versus-correct distinction is
               explained in the edit form, where there is room for it. */
          />
        }
      >
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setEditing(true);
          }}
          className={btn}
        >
          Edit
        </button>
      </RowActions>
    </li>
  );
}
