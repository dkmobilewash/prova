"use client";

import { useState, useTransition } from "react";

import { conceptualBenchmark } from "@/lib/actions";
import { money } from "@/lib/money";
import {
  conceptualRange,
  conceptualSentence,
  type Benchmark,
} from "@/lib/conceptual-estimate";

/**
 * "A 40,000 SF office TI" → what this company's own finished work ran at.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THIS FILLS IN NOTHING. A PERSON TYPES THE VALUE.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * There is deliberately no "use this figure" button, and the area typed here
 * is NOT saved anywhere. The whole component is a calculator sitting beside
 * the field, and a person reads it and decides.
 *
 * That is the wall between a conceptual figure and a real one. A button that
 * wrote a $/SF number into `estimatedValue` would make the pipeline total —
 * which sums that column — part guess and part quote, with nothing on screen
 * saying which rows were which. `lib/conceptual-estimate.ts` explains at
 * length why this number is the most dangerous one this product could
 * produce; this component is the half of that argument that lives in the UI.
 */
export function ConceptualEstimateHelper() {
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState("");
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const parsed = Number(area.replace(/[,\s]/g, ""));
  const range = benchmark ? conceptualRange(Number.isFinite(parsed) ? parsed : 0, benchmark) : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
          // FETCHED ON OPEN, not loaded with the page. This reads every
          // finished job's costs, and /pipeline re-renders from the root on
          // every save — `pipelineQueryCensus.test.ts` is the guard that
          // caught the first version of this sitting in that load path.
          startLoading(async () => {
            const result = await conceptualBenchmark();
            if (result.ok) setBenchmark(result.value);
            else setError(result.error);
          });
        }}
        className="text-xs text-link hover:underline"
      >
        What has similar work run at?
      </button>
    );
  }

  return (
    <div className="rounded-md border border-line-row bg-surface-card p-3">
      <label className="block text-sm">
        <span className="text-ink-label">Gross area of the building (SF)</span>
        <input
          inputMode="decimal"
          value={area}
          onChange={(event) => setArea(event.target.value)}
          placeholder="40,000"
          className="mt-1 w-40 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        />
      </label>
      {/* Not a form field: this input has no `name`, so nothing here is
          submitted or stored. Said out loud because a box beside a form
          looks like part of it. */}
      <p className="mt-1 text-xs text-ink-muted">
        Not saved — this is a calculator, not part of the pursuit.
      </p>

      {loading && <p className="mt-2 text-xs text-ink-muted">Working out what similar work ran at…</p>}
      {error && (
        <p role="alert" className="mt-2 text-xs text-tag-rose-ink">
          {error}
        </p>
      )}

      {range && (
        <p className={`mt-2 text-xs ${range.sell ? "text-ink-body" : "text-ink-muted"}`}>
          {conceptualSentence(range, money)}
        </p>
      )}

      {range?.cost && (
        <p className="mt-1 text-xs text-ink-muted">
          What those jobs COST, over the same areas: {money(range.cost.low)} to{" "}
          {money(range.cost.high)}, middle {money(range.cost.median)}. The gap between the two
          ranges is the margin those jobs actually carried.
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setArea("");
        }}
        className="mt-3 rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Close
      </button>
    </div>
  );
}
