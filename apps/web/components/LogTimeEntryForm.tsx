"use client";

import { useRef, useState, useTransition } from "react";
import { logTimeEntry } from "@/lib/actions";

const TIME_ENTRY_PAY_TYPE_OPTIONS = [
  { value: "STRAIGHT", label: "Straight" },
  { value: "OVERTIME", label: "Overtime" },
  { value: "DOUBLE_TIME", label: "Double time" },
  { value: "SHIFT_DIFFERENTIAL", label: "Shift differential" },
] as const;

export type TimeEntryEmployeeOption = { id: string; name: string | null; email: string };
export type TimeEntryLineItemOption = { id: string; description: string };
export type TimeEntryCraftOption = { id: string; label: string };

/**
 * Logs a day's hours for one employee against a job.
 *
 * Needs its own error slot, unlike the plain server-action forms elsewhere
 * on this page: logTimeEntry now refuses an exact repeat of the same entry
 * submitted within the last few seconds (see the guard's own comment in
 * lib/actions/labor.ts) and a `<form action={fn}>` has nowhere to show that
 * refusal. Same useTransition + inline error shape as PayApplications.tsx.
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
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Employee
          <select
            name="employeeUserId"
            required
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            {employees.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name ?? member.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Date
          <input
            type="date"
            name="date"
            required
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Hours
          <input
            name="hours"
            placeholder="8"
            required
            className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Pay type
          <select
            name="payType"
            defaultValue="STRAIGHT"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            {TIME_ENTRY_PAY_TYPE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Cost code / SOV line
          <select
            name="lineItemId"
            defaultValue=""
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="">No specific line</option>
            {lineItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.description}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Craft classification
          <select
            name="craftClassificationId"
            defaultValue=""
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="">No craft tag</option>
            {craftOptions.map((craft) => (
              <option key={craft.id} value={craft.id}>
                {craft.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Per diem
          <input
            name="perDiemAmount"
            placeholder="optional"
            className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Travel pay
          <input
            name="travelPayAmount"
            placeholder="optional"
            className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <input
          name="note"
          placeholder="Note (optional)"
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
        />
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
