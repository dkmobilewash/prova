"use client";

import { useState, useTransition } from "react";
import { setWallTypesFromDrawings } from "@/lib/actions";
import { AI_FEATURE_LABEL, PLAN_READING_SENTENCE } from "@/lib/ai/features";

/**
 * AI plan reading on `/welcome`: on for a new company (lib/auth.ts), said here
 * with what it costs, and one tap turns it off. The same action as Settings'
 * takeoff list (`setWallTypesFromDrawings`), so the two cannot disagree.
 */
export function PlanReadingSwitch({ initialOn }: { initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    const next = !on;
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      if (next) form.set("wallTypesFromDrawings", "on");
      try {
        const result = await setWallTypesFromDrawings(form);
        if (result.ok) setOn(next);
        else setError(result.error);
      } catch {
        setError("Couldn't save just now. Nothing was changed — try again.");
      }
    });
  };

  return (
    <section data-setup="plan-reading" className="mt-6 rounded-md border border-line-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">
            AI plan reading <span className="font-normal text-ink-muted">({AI_FEATURE_LABEL.PLAN_TEXT_READ})</span>
          </h2>
          <p className="mt-1 text-sm text-ink-body">{PLAN_READING_SENTENCE}</p>
          <p className="mt-1 text-xs text-ink-muted">Wall types and heights come back as suggestions for you to confirm. Change it any time in Settings.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="AI plan reading"
          disabled={isPending}
          onClick={toggle}
          className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-line-card px-3 text-sm font-semibold text-ink hover:bg-rail-hover disabled:opacity-50"
        >
          {isPending ? "Saving…" : on ? "On — turn off" : "Off — turn on"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
