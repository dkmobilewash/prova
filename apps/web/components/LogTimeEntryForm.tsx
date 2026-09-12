"use client";

import { useRef, useState, useTransition } from "react";
import type { JobLineItem } from "@prova/db";
import { logTimeEntry } from "@/lib/actions";

const TIME_ENTRY_PAY_TYPE_OPTIONS = [
  { value: "STRAIGHT", label: "Straight" },
  { value: "OVERTIME", label: "Overtime" },
  { value: "DOUBLE_TIME", label: "Double time" },
  { value: "SHIFT_DIFFERENTIAL", label: "Shift differential" },
] as const;

export type TimeEntryEmployeeOption = { id: string; name: string | null; email: string };

/**
 * All the cost-code picker reads: a value for the `<option>` and a label to
 * show. No quantity, no price, no cost — nothing numeric at all.
 *
 * The second half is a boundary guard, not decoration. This type was already
 * `{ id, description }` and the page still passed whole `job.lineItems` rows
 * to it for weeks, because TypeScript is structural: a JobLineItem HAS an id
 * and a description, so a wider object satisfies a narrower type and the
 * compiler says nothing. What it carried besides was six Prisma `Decimal`
 * columns plus a nested `costEntries` relation, and Next 15 cannot serialize
 * a Decimal across the server/client boundary — so every render of
 * /jobs/[id] logged "Decimal objects are not supported" once per field and
 * put a dev-overlay issue count on screen.
 *
 * Banning the rest of the row makes that pass a compile error instead. The
 * banned keys are derived from `JobLineItem` rather than listed, so a Decimal
 * column added to the model tomorrow is covered without anyone remembering
 * this file — a hand-written list is the drift this guard exists to stop.
 * Type-only import: erased at compile time, so the db package stays out of
 * the client bundle.
 */
export type TimeEntryLineItemOption = {
  id: string;
  description: string;
} & {
  [K in Exclude<keyof JobLineItem, "id" | "description">]?: never;
};

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
      className="flex flex-col gap-2 rounded-lg border border-line-card bg-surface p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Employee
          <select
            name="employeeUserId"
            required
            className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
          >
            {employees.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name ?? member.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Date
          <input
            type="date"
            name="date"
            required
            className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Hours
          <input
            name="hours"
            placeholder="8"
            required
            className="w-20 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Pay type
          <select
            name="payType"
            defaultValue="STRAIGHT"
            className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
          >
            {TIME_ENTRY_PAY_TYPE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Cost code / SOV line
          <select
            name="lineItemId"
            defaultValue=""
            className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
          >
            <option value="">No specific line</option>
            {lineItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.description}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Craft classification
          <select
            name="craftClassificationId"
            defaultValue=""
            className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
          >
            <option value="">No craft tag</option>
            {craftOptions.map((craft) => (
              <option key={craft.id} value={craft.id}>
                {craft.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Per diem
          <input
            name="perDiemAmount"
            placeholder="optional"
            className="w-24 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Travel pay
          <input
            name="travelPayAmount"
            placeholder="optional"
            className="w-24 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
          />
        </label>
        <input
          name="note"
          placeholder="Note (optional)"
          className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
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
