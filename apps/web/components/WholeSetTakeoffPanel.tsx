"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advancePlanIngest, choosePlanOfWork, chooseUploadProject, markWholeSheetNewWork, startPlanIngest, wholeSetTakeoffSummary } from "@/lib/actions";
import { WORK_AREA_PROMPT } from "@/lib/takeoff/workAreaFirst";
import { Spinner } from "@/components/Spinner";
import type { PlanOfWorkQuestion } from "@/lib/plan-ingest/walls";
import { useThumbnails } from "@/components/TakeoffSheetTree";
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
  jobId,
  existing,
  summary: initialSummary,
  projects = null,
  planQuestion = null,
}: {
  planId: string;
  /** For each renovation sheet's "Draw work area": the full workspace, on that sheet. */
  jobId?: string;
  existing: IngestView | null;
  summary: WallsSummaryRow[];
  /** One upload, two projects (`projectIdentity.ts`, TAKEOFF_PROJECT_IDENTITY): the question, and the stored answer. */
  projects?: ProjectQuestion | null;
  /** No floor plan for the run to count (`planOfWork`, same flag): which sheet(s) are the plan of the work. */
  planQuestion?: PlanOfWorkQuestion | null;
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

  // A renovation sheet with walls and no work area yet: asked on its row and named in the summary (W5).
  const needsWorkArea = (row: WallsSummaryRow) => row.renovation !== undefined && row.workArea !== true && row.status.kind === "walls";
  const unanswered = summary.filter(needsWorkArea);
  function wholeSheet(pageNumber: number) {
    setError(null);
    startTransition(async () => {
      const result = await markWholeSheetNewWork(planId, pageNumber);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary((rows) => rows.map((r) => (r.pageNumber === pageNumber ? { ...r, workArea: true } : r)));
    });
  }

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
  // NOTHING IS PRE-TICKED the first time: the contractor names the plan of the work, the panel never guesses it.
  const [picked, setPicked] = useState<number[]>(planQuestion?.chosen ?? []);
  const [changing, setChanging] = useState(false);
  const askingPlan = !asking && planQuestion !== null && (planQuestion.chosen.length === 0 || changing);
  const thumbs = useThumbnails(planId, askingPlan);
  const rowLabel = new Map(summary.map((row) => [row.pageNumber, row.label]));
  const candidateKey = planQuestion?.candidates.join(",") ?? "";
  useEffect(() => {
    // A picture of each sheet offered, one PDF render apiece, serialised by the hook (TakeoffSheetTree's own).
    if (askingPlan) for (const page of candidateKey.split(",").filter(Boolean)) thumbs.request(Number(page));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `thumbs` is a fresh object each render over stable refs
  }, [askingPlan, candidateKey]);
  function onChoosePlan() {
    setError(null);
    startTransition(async () => {
      const result = await choosePlanOfWork(planId, picked);
      if (!alive.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChanging(false);
      await refreshSummary();
      router.refresh();
    });
  }

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
      {askingPlan && planQuestion !== null && (
        <div data-takeoff="which-plan" className="mb-3">
          <p className="text-sm font-semibold text-ink-body">No floor plan to count was found in this set. Which sheet shows the work?</p>
          <p className="mt-1 text-xs text-ink-muted">Nothing is counted until you choose. Tick every sheet that is a plan of the work.</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {planQuestion.candidates.map((page) => {
              const src = thumbs.get(page);
              return (
                <li key={page}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-line-card p-2 text-sm text-ink-body hover:bg-rail-hover">
                    <input
                      type="checkbox"
                      data-takeoff="plan-candidate"
                      data-page={page}
                      className="h-5 w-5 shrink-0"
                      checked={picked.includes(page)}
                      onChange={(event) => setPicked((now) => (event.target.checked ? [...now, page] : now.filter((p) => p !== page)))}
                    />
                    {src ? <img src={src} alt="" className="w-[72px] shrink-0 border border-line-row" /> : <span className="h-[48px] w-[72px] shrink-0 border border-line-row" />}
                    <span>{rowLabel.get(page) ?? `Sheet ${page}`}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            data-takeoff="count-plan"
            onClick={onChoosePlan}
            disabled={pending || picked.length === 0}
            className="mt-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
          >
            {picked.length === 1 ? "Count this sheet" : "Count these sheets"}
          </button>
        </div>
      )}
      {!asking && !askingPlan && planQuestion !== null && planQuestion.chosen.length > 0 && (
        <p data-takeoff="chosen-plan" className="mb-3 text-xs text-ink-muted">
          Counting {planQuestion.chosen.map((page) => (rowLabel.get(page) ?? `sheet ${page}`).split(" — ")[0]).join(", ")}: you named {planQuestion.chosen.length === 1 ? "it" : "them"} the plan of the work.{" "}
          <button type="button" data-takeoff="change-plan" onClick={() => setChanging(true)} className="underline hover:text-ink-body">
            Change
          </button>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!asking && !askingPlan && <button
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
          {/* ── ONLY THE SHEETS STILL UNANSWERED (work-area-first.md W5) ── a work area, drawn or the whole sheet. */}
          {unanswered.length > 0 && (
            <p className="mt-2 font-medium text-tag-amber-ink" data-takeoff="whole-set-renovation">
              Shows existing work, so each needs its work area before sending:{" "}
              {unanswered.map((row) => `${row.label} (${row.renovation!.join(", ")})`).join("; ")}.
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
                {/* ── THE SAME PROMPT AS THE SHEET, WITH THE SAME TWO EXITS (Diego's audit order, 2026-11-25) ── */}
                {needsWorkArea(row) && (
                  <span className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-tag-amber px-2 py-1 font-medium text-tag-amber-ink" data-takeoff="whole-set-work-area">
                    {WORK_AREA_PROMPT}
                    {jobId !== undefined && (
                      <a href={`/takeoff/${jobId}?page=${row.pageNumber}`} className="inline-flex min-h-[32px] items-center rounded-md border border-line-card bg-surface px-2 text-ink-body">
                        Draw work area
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={pending}
                      className="min-h-[32px] rounded-md border border-line-card bg-surface px-2 text-ink-body"
                      onClick={() => wholeSheet(row.pageNumber)}
                    >
                      {/* Busy while the save runs (W3b): `pending` also disables it, so a second press does nothing. */}
                      {pending ? (
                        <>
                          <Spinner /> Saving…
                        </>
                      ) : (
                        "Whole sheet is new work"
                      )}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
