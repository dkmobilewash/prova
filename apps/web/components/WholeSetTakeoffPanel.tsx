"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advancePlanIngest, chooseUploadProject, startPlanIngest, wholeSetTakeoffSummary } from "@/lib/actions";
import type { ProjectQuestion } from "@/lib/plan-ingest/projectIdentity";
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
  projects = null,
}: {
  planId: string;
  existing: IngestView | null;
  summary: WallsSummaryRow[];
  /** One upload, two projects (`projectIdentity.ts`, TAKEOFF_PROJECT_IDENTITY): the question, and the stored answer. */
  projects?: ProjectQuestion | null;
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

  function onChoose(pageNumber: number) {
    setError(null);
    startTransition(async () => {
      const result = await chooseUploadProject(planId, pageNumber);
      if (!alive.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refreshSummary();
      router.refresh();
    });
  }
  // The sheet numbers a project's pages carry, from the summary's own labels ("A101 — FLOOR PLAN").
  const labelOf = new Map(summary.map((row) => [row.pageNumber, row.label.split(" — ")[0]]));
  const describe = (pages: number[]) => {
    const numbers = pages.map((p) => labelOf.get(p)).filter((n): n is string => n !== undefined && !n.startsWith("Sheet "));
    return `${pages.length} ${pages.length === 1 ? "sheet" : "sheets"}${numbers.length > 0 ? `: ${numbers.slice(0, 4).join(", ")}${numbers.length > 4 ? "…" : ""}` : ""}`;
  };
  const asking = projects !== null && projects.chosen === null;

  const counted = (row: WallsSummaryRow) => row.status.kind === "walls" && row.status.notCounted === undefined;
  const found = summary.filter(counted);
  const passed = summary.filter((row) => !counted(row) && (row.status.kind === "walls" || row.status.kind === "skipped" || row.status.kind === "looked"));
  const failed = summary.filter((row) => row.status.kind === "failed");
  const inRun = view !== null && !view.complete;

  return (
    <section data-takeoff="whole-set" className="rounded-lg border border-line-card bg-surface p-4">
      {projects !== null && asking && (
        <div data-takeoff="which-project" className="mb-3">
          {/* NEVER PICKED FOR THEM: no default, no pre-selection, upload order. Nothing is counted until they answer. */}
          <p className="text-sm font-semibold text-ink-body">This upload has drawings from more than one project. Which one are you bidding?</p>
          <p className="mt-1 text-xs text-ink-muted">No walls are counted until you choose. The other project&apos;s sheets stay in the set and are not counted.</p>
          <ul className="mt-2 grid gap-2">
            {projects.groups.map((group) => (
              <li key={group.pages[0]}>
                <button
                  type="button"
                  data-takeoff="choose-project"
                  data-page={group.pages[0]}
                  onClick={() => onChoose(group.pages[0]!)}
                  disabled={pending}
                  className="w-full rounded-md border border-line-card px-3 py-2 text-left text-sm text-ink-body hover:bg-rail-hover disabled:opacity-50"
                >
                  <span className="font-semibold">{group.label}</span>
                  {group.lines.filter((line) => line !== group.label).slice(0, 2).map((line) => (
                    <span key={line} className="block text-xs text-ink-muted">{line}</span>
                  ))}
                  <span className="block text-xs text-ink-muted">{describe(group.pages)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {projects !== null && projects.chosen !== null && (
        <p data-takeoff="chosen-project" className="mb-3 text-xs text-ink-muted">
          Taking off <span className="font-semibold text-ink-body">{projects.groups[projects.chosen]!.label}</span>.{" "}
          {projects.groups.filter((_, i) => i !== projects.chosen).map((group) => (
            <span key={group.pages[0]}>
              {group.label} is another project in this upload and is not counted.{" "}
              <button
                type="button"
                data-takeoff="switch-project"
                data-page={group.pages[0]}
                onClick={() => onChoose(group.pages[0]!)}
                disabled={pending}
                className="underline hover:text-ink-body disabled:opacity-50"
              >
                Take off {group.label} instead
              </button>{" "}
            </span>
          ))}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!asking && <button
          type="button"
          data-takeoff="find-walls-everywhere"
          onClick={onStart}
          disabled={pending || running}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {running ? "Finding walls…" : inRun ? "Continue finding walls" : "Find walls on every floor plan"}
        </button>}
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
          {summary.some((row) => row.renovation && row.status.kind === "walls") && (
            <p className="mt-2 font-medium text-tag-amber-ink" data-takeoff="whole-set-renovation">
              Shows existing work, so draw the work area or exclude existing walls before sending:{" "}
              {summary.filter((row) => row.renovation && row.status.kind === "walls").map((row) => `${row.label} (${row.renovation!.join(", ")})`).join("; ")}.
            </p>
          )}
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {summary.map((row) => (
              <li key={row.pageNumber} data-takeoff="whole-set-sheet" data-page={row.pageNumber} data-status={row.status.kind}>
                <span className="text-ink-body">{row.label}</span>
                {" — "}
                {row.status.kind === "walls" && row.status.notCounted !== undefined
                  ? `found ${formatFeetInches(row.status.feet)}, not counted: ${row.status.notCounted}`
                  : row.status.kind === "walls"
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
