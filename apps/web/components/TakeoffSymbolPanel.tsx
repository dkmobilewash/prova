"use client";

import { useState, useTransition } from "react";
import { saveTakeoffMeasurement } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";
import type { SymbolMatch } from "@/lib/takeoff/symbolSignature";

/**
 * "Count like this": the count of the boxed symbol's matches on this sheet,
 * less the ones the estimator clicked off, saved as a COUNT measurement —
 * one point per kept match, named by the estimator, so it becomes the line
 * item exactly as a hand-clicked count does. See `lib/takeoff/symbolSignature.ts`.
 */
export function TakeoffSymbolPanel({
  jobId,
  pageId,
  itemId,
  state,
  onClear,
  onSaved,
}: {
  jobId: string;
  pageId: string;
  itemId: string | null;
  state: { matches: SymbolMatch[]; dropped: Set<number>; ms: number; busy: boolean; error: string | null };
  onClear: () => void;
  onSaved: (saved: { id: string }) => void;
}) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const kept = state.matches.filter((_, i) => !state.dropped.has(i));
  const save = () => {
    if (!label.trim()) return setError("Name what you're counting — that name becomes the line item.");
    const body = new FormData();
    body.set("pageId", pageId);
    body.set("kind", "COUNT");
    body.set("label", label.trim());
    if (itemId) body.set("itemId", itemId);
    body.set("points", JSON.stringify({ xs: kept.map((m) => (m.box.x1 + m.box.x2) / 2), ys: kept.map((m) => (m.box.y1 + m.box.y2) / 2) }));
    startTransition(async () => {
      const result = await saveTakeoffMeasurement(jobId, body);
      if (!result.ok) return setError(result.error);
      onSaved({ id: result.value.id });
    });
  };
  return (
    <div data-takeoff="symbol-count" className="mb-2 rounded-lg border border-line-card bg-surface p-3 text-xs">
      {state.busy ? (
        <p className="flex items-center gap-2 text-ink-body">
          <Spinner /> Reading the sheet for matches…
        </p>
      ) : state.error ? (
        <p className="text-tag-rose-ink">{state.error}</p>
      ) : (
        <>
          <p className="text-sm font-medium text-ink" data-takeoff="symbol-count-total">
            {kept.length} {kept.length === 1 ? "match" : "matches"}
            {state.dropped.size > 0 ? ` (${state.dropped.size} dropped)` : ""}
          </p>
          <p className="mt-0.5 text-ink-muted">
            Found by the drawn shape in {Math.round(state.ms)} ms — turned or mirrored copies count, lettering beside
            them is ignored. Click a green mark on the sheet to drop it; click again to take it back.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              name="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="What are you counting? e.g. duplex receptacle"
              className="min-w-[14rem] flex-1 rounded-md border border-line-card bg-canvas px-2 py-1 text-xs text-ink"
              data-takeoff="symbol-label"
            />
            <button
              type="button"
              onClick={save}
              disabled={isPending || kept.length === 0}
              className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-neutral-900 disabled:opacity-50"
              data-takeoff="symbol-save"
            >
              {isPending ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                `Save count of ${kept.length}`
              )}
            </button>
            <button type="button" onClick={onClear} className="text-xs text-ink-muted underline hover:text-ink-body">
              Clear
            </button>
          </div>
          {error && <p className="mt-1 text-tag-rose-ink">{error}</p>}
        </>
      )}
    </div>
  );
}
