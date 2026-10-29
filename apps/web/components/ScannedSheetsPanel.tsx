"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { advancePlanIngest, startPlanIngest } from "@/lib/actions";
import type { IngestView } from "@/lib/plan-ingest/runner";

/**
 * "Read N scanned sheets": starts the RASTER ingest stage and pumps it from
 * the browser the way `PlanIngestPanel` pumps the inventory — one sheet per
 * advance, the count climbing beside the button. Shown only when the company
 * switch is on and the set has scanned sheets the stage has not read.
 */
const SLICE_GAP_MS = 250;
const MAX_IDLE_SLICES = 40;

export function ScannedSheetsPanel({ planId, scanned, unread, existing }: { planId: string; scanned: number; unread: number; existing: IngestView | null }) {
  const router = useRouter();
  const [view, setView] = useState<IngestView | null>(existing);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function pump(jobId: string, idle: number, last: number) {
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
    if (next.complete) {
      setRunning(false);
      router.refresh();
      return;
    }
    const done = next.finished + next.exhausted;
    const nextIdle = done > last ? 0 : idle + 1;
    if (nextIdle >= MAX_IDLE_SLICES) {
      setRunning(false);
      setError("Reading paused — nothing moved for a while. Press again to continue.");
      return;
    }
    setTimeout(() => void pump(jobId, nextIdle, done), SLICE_GAP_MS);
  }

  async function onStart() {
    setError(null);
    setRunning(true);
    const started = await startPlanIngest(planId, "RASTER");
    if (!started.ok) {
      setError(started.error);
      setRunning(false);
      return;
    }
    setView(started.value);
    void pump(started.value.jobId, 0, started.value.finished + started.value.exhausted);
  }

  const progress = view ? `${view.finished + view.exhausted} of ${view.total} sheets${view.complete ? " — done" : running ? "" : " — paused"}` : null;
  return (
    <section data-takeoff="scanned-sheets" className="rounded-lg border border-line-card bg-surface p-4">
      <p className="text-sm text-ink-body">
        {scanned} sheet{scanned === 1 ? " is" : "s are"} scanned — a picture of a drawing, with no lines or writing in the
        file. {unread > 0 ? `${unread} not read yet.` : "All read."}
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Reading finds the lines and the printed scale on the picture so Find the walls can work on them. Seconds per sheet,
        no model.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void onStart()}
          disabled={running || unread === 0}
          data-takeoff="read-scanned-sheets"
          className="min-h-[48px] rounded-md bg-rail-hover px-4 text-sm font-medium text-ink hover:bg-lift disabled:opacity-50"
        >
          {running ? "Reading…" : unread === 0 ? "Scanned sheets read" : `Read ${unread} scanned sheet${unread === 1 ? "" : "s"}`}
        </button>
        {progress && (
          <span data-takeoff="scanned-progress" className="text-xs text-ink-muted">
            {progress}
          </span>
        )}
      </div>
      {error && (
        <p data-takeoff="scanned-error" className="mt-2 text-xs text-ink-muted">
          {error}
        </p>
      )}
    </section>
  );
}
