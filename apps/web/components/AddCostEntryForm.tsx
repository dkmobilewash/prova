"use client";

import { useRef, useState, useTransition } from "react";
import { addCostEntry } from "@/lib/actions";

const COST_CATEGORIES = ["LABOR", "MATERIAL", "SUBCONTRACTOR", "OTHER"] as const;

const TRADE_SCOPE_OPTIONS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

/**
 * Logs an actual expense against a line item.
 *
 * Needs its own error slot, unlike the plain server-action forms elsewhere
 * on this page: addCostEntry now refuses an exact repeat submitted within
 * the last few seconds (see the guard's own comment in lib/actions/jobs.ts)
 * and a `<form action={fn}>` has nowhere to show that refusal. Same
 * useTransition + inline error shape as PayApplications.tsx.
 */
export function AddCostEntryForm({
  jobId,
  lineItemId,
  defaultTradeScope,
}: {
  jobId: string;
  lineItemId: string;
  defaultTradeScope: (typeof TRADE_SCOPE_OPTIONS)[number]["value"] | null;
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
            const result = await addCostEntry(jobId, lineItemId, formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            formRef.current?.reset();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not log this cost");
          }
        });
      }}
      className="mt-3 flex flex-col gap-2 border-t border-line-row pt-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <input
          name="description"
          placeholder="Cost description"
          required
          className="flex-1 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
        <input
          name="amount"
          placeholder="Amount"
          required
          className="w-24 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
        <select
          name="category"
          defaultValue="OTHER"
          className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
        >
          {COST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          name="tradeScope"
          defaultValue={defaultTradeScope ?? ""}
          title="Trade this expense belongs to — defaults to this line item's trade, but can differ (e.g. a general-conditions line spanning several trades)"
          className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
        >
          <option value="">No trade tag</option>
          {TRADE_SCOPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-ink hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Logging…" : "Log cost"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
