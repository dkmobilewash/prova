"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advancePlanIngest, startPlanIngest, wholeSetTakeoffSummary } from "@/lib/actions";
import type { IngestView } from "@/lib/plan-ingest/runner";
import type { WallsSummaryRow } from "@/lib/plan-ingest/walls";
import { formatFeetInches } from "@/lib/feet-inches";

/**
 * "Find walls on every floor plan" — the button, the count, and the list.
 *
 * The pump is `PlanIngestPanel`'s: call `advancePlanIngest` until the run is
 * complete or three slices pass with nothing moving (everything left is in its
 * backoff window). Each slice does one sheet's detection on the server, so the
 * count climbs a sheet at a time and the page can be closed and reopened — the
 * run is rows, not this component.
 */
const SLICE_GAP_MS = 400;
const MAX_IDLE_SLICES = 3;

export function WholeSetTakeoffPanel({
  planId,
  existing,
  summary: initialSummary,
}: {
  planId: string;
  existing: IngestView | null;
  summary: WallsSummaryRow[];
}) {
  const router = useRouter();
  const [view, setView] = useState<IngestView | null>(existing);
  const [summary, setSummary] = useState(initialSummary);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refreshSummary = useCallback(async () => {
    const result = await wholeSetTakeoffSummary(planId);
    if (alive.current && result.ok) setSummary(result.value);
  }, [planId]);

  const pump = useCallback(
    async (jobId: string, idle: number, before: number) => {
      if (!alive.current) return;
      const result = await advancePlanIngest(jobId);
      if (!alive.current) return;
      if (!result.ok) {
        setError(result.error);
        setRunning(false);
        return;
      }
      const next = result.value;
      setView(next);
      const settled = next.finished + next.exhausted;
      if (settled !== before) void refreshSummary();
      if (next.complete) {
        setRunning(false);
        // The walls are rows now; the viewer reads them on the page's next
        // load, so give it one — opening a sheet then finds them waiting.
        router.refresh();
        return;
      }
      const nextIdle = settled > before ? 0 : idle + 1;
      if (nextIdle >= MAX_IDLE_SLICES) {
        setRunning(false);
        return;
      }
      setTimeout(() => void pump(jobId, nextIdle, settled), SLICE_GAP_MS);
    },
    [refreshSummary, router],
  );

  function onStart() {
    setError(null);
    startTransition(async () => {
      const result = await startPlanIngest(planId, "WALLS");
      if (!alive.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setView(result.value);
      setRunning(true);
      void pump(result.value.jobId, 0, result.value.finished + result.value.exhausted);
    });
  }

  const found = summary.filter((row) => row.status.kind === "walls");
  const passed = summary.filter((row) => row.status.kind === "skipped" || row.status.kind === "looked");
  const failed = summary.filter((row) => row.status.kind === "failed");
  const inRun = view !== null && !view.complete;

  return (
    <section data-takeoff="whole-set" className="rounded-lg border border-line-card bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-takeoff="find-walls-everywhere"
          onClick={onStart}
          disabled={pending || running}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {running ? "Finding walls…" : inRun ? "Continue finding walls" : "Find walls on every floor plan"}
        </button>
        {view && (
          <span data-takeoff="whole-set-progress" className="text-sm text-ink-body">
            {view.finished + view.exhausted} of {view.total} sheets
            {view.complete ? " — done" : running ? "" : view.waiting ? " — waiting to retry" : " — paused"}
          </span>
        )}
        {error && (
          <span data-takeoff="whole-set-error" className="text-sm text-tag-rose-ink">
            {error}
          </span>
        )}
      </div>
      {summary.length > 0 && (
        <div className="mt-3 text-xs text-ink-muted" data-takeoff="whole-set-summary">
          <span data-takeoff="whole-set-counts">
            {found.length} {found.length === 1 ? "sheet has" : "sheets have"} walls
            {passed.length > 0 ? `, ${passed.length} passed over` : ""}
            {failed.length > 0 ? `, ${failed.length} failed` : ""}.
          </span>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {summary.map((row) => (
              <li key={row.pageNumber} data-takeoff="whole-set-sheet" data-page={row.pageNumber} data-status={row.status.kind}>
                <span className="text-ink-body">{row.label}</span>
                {" — "}
                {row.status.kind === "walls"
                  ? `${row.status.groups} wall ${row.status.groups === 1 ? "group" : "groups"}, ${formatFeetInches(row.status.feet)}`
                  : row.status.kind === "skipped"
                    ? `passed over: ${row.status.why}`
                    : row.status.kind === "looked"
                      ? row.status.note
                      : row.status.kind === "failed"
                        ? `failed: ${row.status.error}`
                        : inRun || running
                          ? "waiting"
                          : "not looked at yet"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
