"use client";

import { useState, useTransition } from "react";
import { saveSymbolCountAcrossSheets, saveTakeoffMeasurement } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";
import type { SymbolMatch } from "@/lib/takeoff/symbolSignature";
import { scopeSentence, type SheetScope } from "@/lib/takeoff/symbolScope";

/** One sheet of an across-the-set count, as the viewer's walk fills it in. */
export type AcrossRow = { page: number; number: string | null; count: number; ms: number; scaling: string; xs: number[]; ys: number[] };
export type AcrossState = {
  scope: SheetScope;
  fromNumber: string | null;
  running: boolean;
  /** Pages the walk has looked at so far, in scope or not. */
  looked: number;
  total: number;
  rows: AcrossRow[];
  error: string | null;
  done: boolean;
};

/**
 * "Count like this": the count of the boxed symbol's matches on this sheet,
 * less the ones the estimator clicked off, saved as a COUNT measurement —
 * one point per kept match, named by the estimator, so it becomes the line
 * item exactly as a hand-clicked count does. See `lib/takeoff/symbolSignature.ts`.
 */
export function TakeoffSymbolPanel({
  jobId,
  planId,
  pageId,
  pageNumber,
  itemId,
  state,
  across,
  pageCount,
  onAcross,
  onCancelAcross,
  onClear,
  onSaved,
}: {
  jobId: string;
  planId: string;
  /** Null on a sheet with no page row yet; the save makes one from `pageNumber`. */
  pageId: string | null;
  pageNumber: number;
  itemId: string | null;
  state: { matches: SymbolMatch[]; dropped: Set<number>; ms: number; busy: boolean; error: string | null; label?: string | null; tag?: string | null };
  /** The across-the-set walk, once started. */
  across: AcrossState | null;
  pageCount: number | null;
  onAcross: (scope: SheetScope) => void;
  onCancelAcross: () => void;
  onClear: () => void;
  /** `keepOpen` leaves the panel up, because the across-the-set result is said here. */
  onSaved: (saved: { id: string }, keepOpen?: boolean) => void;
}) {
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<SheetScope>("discipline");
  const [error, setError] = useState<string | null>(null);
  const [acrossSaved, setAcrossSaved] = useState<{ total: number; sheets: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const kept = state.matches.filter((_, i) => !state.dropped.has(i));
  const acrossTotal = across?.rows.reduce((t, r) => t + r.count, 0) ?? 0;
  const saveAcross = () => {
    if (!across || across.running) return;
    if (!label.trim()) return setError("Name what you're counting — that name becomes the line item.");
    const sheets = across.rows.filter((r) => r.count > 0).map((r) => ({ pageNumber: r.page, xs: r.xs, ys: r.ys }));
    startTransition(async () => {
      const result = await saveSymbolCountAcrossSheets(jobId, planId, { label: label.trim(), itemId, sheets });
      if (!result.ok) return setError(result.error);
      setAcrossSaved({ total: result.value.total, sheets: result.value.saved.length });
      if (result.value.saved[0]) onSaved({ id: result.value.saved[0].measurementId }, true);
    });
  };
  const save = () => {
    if (!label.trim()) return setError("Name what you're counting — that name becomes the line item.");
    const body = new FormData();
    if (pageId) body.set("pageId", pageId);
    body.set("planId", planId);
    body.set("pageNumber", String(pageNumber));
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
            Found by the drawn shape in {Math.round(state.ms)} ms — turned or mirrored copies count
            {state.label ? <>, only where the symbol reads &ldquo;{state.label}&rdquo;</> : null}
            {state.tag ? <>, only where it is tagged {state.tag}</> : null}. Click a green mark on the sheet to drop it;
            click again to take it back.
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
          {/* ── ACROSS THE SET ── */}
          {pageCount !== null && pageCount > 1 && kept.length > 0 && (
            <div className="mt-3 border-t border-line-card pt-2" data-takeoff="symbol-across">
              {across === null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value === "all" ? "all" : "discipline")}
                    className="rounded-md border border-line-card bg-canvas px-2 py-1 text-xs text-ink"
                    data-takeoff="symbol-scope"
                  >
                    <option value="discipline">Sheets of the same discipline</option>
                    <option value="all">Every sheet in the set</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => onAcross(scope)}
                    className="rounded-md border border-line-card px-3 py-1 text-xs font-medium text-ink hover:bg-canvas"
                    data-takeoff="symbol-across-start"
                  >
                    Find on all sheets
                  </button>
                  <span className="text-ink-muted">Same shape, same size on paper; a sheet at another scale is tried at that scale too.</span>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink" data-takeoff="symbol-across-total">
                    {acrossTotal} across {across.rows.filter((r) => r.count > 0).length} sheets
                    {across.running ? ` — looking at sheet ${across.looked} of ${across.total}…` : across.done ? "" : " (stopped)"}
                  </p>
                  <p className="mt-0.5 text-ink-muted">{scopeSentence(across.scope, across.fromNumber, across.rows.length, across.total)}</p>
                  {across.error && <p className="mt-1 text-tag-rose-ink">{across.error}</p>}
                  <table className="mt-1 w-full text-left text-xs" data-takeoff="symbol-across-rows">
                    <tbody>
                      {across.rows.map((r) => (
                        <tr key={r.page} className={r.count === 0 ? "text-ink-muted" : "text-ink-body"}>
                          <td className="pr-2">p{r.page}</td>
                          <td className="pr-2">{r.number ?? "—"}</td>
                          <td className="pr-2 text-right tabular-nums">{r.count}</td>
                          <td className="pr-2 text-ink-muted">{(r.ms / 1000).toFixed(1)} s{r.scaling === "paper" ? "" : ` · ${r.scaling}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {across.running ? (
                      <button type="button" onClick={onCancelAcross} className="text-xs text-ink-muted underline hover:text-ink-body">
                        Stop here
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={saveAcross}
                        disabled={isPending || acrossTotal === 0 || acrossSaved !== null}
                        className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-neutral-900 disabled:opacity-50"
                        data-takeoff="symbol-across-save"
                      >
                        {isPending ? <><Spinner /> Saving…</> : `Save ${acrossTotal} across ${across.rows.filter((r) => r.count > 0).length} sheets`}
                      </button>
                    )}
                  </div>
                  {acrossSaved && (
                    <p className="mt-1 text-ink-muted" data-takeoff="symbol-across-saved">
                      Saved {acrossSaved.total} on {acrossSaved.sheets} sheets as one count.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
