"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveCompanyBidDefaults } from "@/lib/actions";

/**
 * The company's standing markup rates, on Settings.
 *
 * These do not price anything by themselves: they pre-fill a job's bid recap
 * the first time it is opened, exactly as `Contact.defaultRetainagePercent`
 * pre-fills `Job.retainagePercent`. Changing them never reaches a job that has
 * already saved its own — which is the whole point of the job keeping its own
 * row, since a bid already sent was built at the rates of the day it was sent.
 */

export type BidDefaultsView = Record<string, string | null>;

const FIELDS: { key: string; label: string }[] = [
  { key: "materialMarkupPercent", label: "Material markup" },
  { key: "laborMarkupPercent", label: "Labor markup" },
  { key: "subcontractorMarkupPercent", label: "Subcontractor markup" },
  { key: "otherMarkupPercent", label: "Other / equipment markup" },
  { key: "escalationPercent", label: "Escalation" },
  { key: "materialTaxPercent", label: "Sales tax on material" },
  { key: "overheadPercent", label: "Overhead" },
  { key: "profitPercent", label: "Profit" },
  { key: "bondPercent", label: "Bond premium" },
  { key: "contingencyPercent", label: "Contingency" },
];

export function BidDefaultsForm({ defaults }: { defaults: BidDefaultsView | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveCompanyBidDefaults(formData);
      if (!result.ok) return setError(result.error);
      setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs text-ink-label">
            {f.label}
            <span className="flex w-fit items-center gap-1">
              <input
                name={f.key}
                defaultValue={defaults?.[f.key] ?? ""}
                inputMode="decimal"
                placeholder="—"
                className="w-20 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
              />
              <span className="text-ink-muted">%</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-ink hover:bg-neutral-700 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save default markup"}
        </button>
        {error && <p className="text-sm text-tag-amber-ink">{error}</p>}
        {saved && !error && <p className="text-sm text-ink-body">Saved. New jobs start from these.</p>}
      </div>
    </form>
  );
}
