"use client";

import { useRef, useState, useTransition } from "react";
import type { JobLineItem } from "@prova/db";
import { logTimeEntry } from "@/lib/actions";
import {
  TimeEntryFields,
  type TimeEntryCraftOption,
  type TimeEntryEmployeeOption,
  type TimeEntryLineItemOption,
} from "@/components/TimeEntryFields";

export type {
  TimeEntryCraftOption,
  TimeEntryEmployeeOption,
  TimeEntryLineItemOption,
} from "@/components/TimeEntryFields";

/**
 * Logs a day's hours for one employee against a job.
 *
 * The fields themselves moved to `<TimeEntryFields>` when #63 added the
 * correction form, so the two cannot drift: both post the same names and both
 * are parsed by `parseTimeEntryFigures`. The DIFFERENCE between them is the
 * point — this form offers the employee and the date, the correction form
 * renders those as text, because a logged hour never changes hands.
 *
 * Needs its own error slot, unlike the plain server-action forms elsewhere
 * on this page: logTimeEntry refuses an exact repeat of the same entry
 * submitted within the last few seconds (see the guard's own comment in
 * lib/actions/labor.ts), and now also refuses hours that are not a positive
 * number rather than throwing a message production would redact. A
 * `<form action={fn}>` has nowhere to show either. Same useTransition +
 * inline error shape as PayApplications.tsx.
 *
 * IT DOES NOT RESET THE WHOLE FORM ANY MORE. It called `form.reset()`, which
 * put every field back to its server-rendered default — and the employee
 * select has no default, so it snapped back to whoever happens to be first
 * in the list, while the date went blank. Hours are entered one person at a
 * time from one crew sheet: eight carpenters on Tuesday is eight submits,
 * and the form asked which day it was eight times. The two fields that are
 * the SAME across that run are the two it threw away.
 */

/**
 * The fields kept across a submit, and why each one.
 *
 * `date` — one crew sheet is one day. Retyping it per entry is the
 * keystrokes, and a mistyped one is a WH-347 that does not foot.
 *
 * `employeeUserId` — kept not because the next entry is the same person (it
 * usually is not) but because a reset put the select on the FIRST name in
 * the company every time, which is a wrong answer wearing a confident face.
 * What was last chosen is at least what is on screen. Neither behaviour
 * guards against logging the same person twice; `logTimeEntry` is what does
 * that, refusing an exact repeat within a few seconds.
 *
 * Everything else — hours, pay type, cost code, craft, per diem, travel,
 * note — clears, because carrying an unseen 8 or a stale per diem into the
 * next person's entry is the error this cannot let happen quietly.
 */
const STICKY_FIELDS = ["employeeUserId", "date"] as const;
export function LogTimeEntryForm({
  jobId,
  employees,
  lineItems,
  craftOptions,
}: {
  jobId: string;
  employees: TimeEntryEmployeeOption[];
  lineItems: TimeEntryLineItemOption[];
  craftOptions: TimeEntryCraftOption[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          try {
            const result = await logTimeEntry(jobId, formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            // Read off the submitted FormData, then written back after the
            // reset. Restoring from the FormData rather than from the live
            // DOM means what comes back is exactly what was FILED, never
            // something the user started typing while the action was in
            // flight.
            const kept = STICKY_FIELDS.map(
              (name) => [name, String(formData.get(name) ?? "")] as const,
            );
            const form = formRef.current;
            form?.reset();
            for (const [name, value] of kept) {
              const field = form?.querySelector<HTMLInputElement | HTMLSelectElement>(
                `[name="${name}"]`,
              );
              if (field) field.value = value;
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not log this time entry");
          }
        });
      }}
      className="flex flex-col gap-2 rounded-lg border border-line-card bg-surface p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <TimeEntryFields employees={employees} lineItems={lineItems} craftOptions={craftOptions} />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-ink hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Logging…" : "Log time"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
