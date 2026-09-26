"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveCompanyBidDefaults } from "@/lib/actions";
import { RECAP_RATE_FIELDS, RECAP_RATE_KEYS } from "@/lib/bid-recap";

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

/**
 * DERIVED, not written out. This was a tenth hand-written rate list, and it was
 * the most expensive of them: the per-job form and the parse both grew an
 * equipment rate on 2026-09-26 and this one did not, so the company-wide
 * equipment markup was storable, parseable — and impossible to type in. A rate
 * with no input is a rate nobody can ever set, and nothing failed to say so.
 *
 * Its `otherMarkupPercent` label also still read "Other / equipment markup",
 * which is the old one-rate-doing-two-jobs world surviving on the one screen
 * that had not been looked at.
 */
const FIELDS = RECAP_RATE_KEYS.map((key) => ({ key: key as string, ...RECAP_RATE_FIELDS[key] }));

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
