"use client";

import { useRef, useState, useTransition } from "react";
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
 */
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
            formRef.current?.reset();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not log this time entry");
          }
        });
      }}
      className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <TimeEntryFields employees={employees} lineItems={lineItems} craftOptions={craftOptions} />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Logging…" : "Log time"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
