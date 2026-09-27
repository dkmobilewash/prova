"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  advancePlanIngest,
  planIngestFailures,
  retryPlanIngestPage,
  startPlanIngest,
} from "@/lib/actions";
// The TYPE from the database-free module, never from claim.ts — see its comment
// on IngestView. A client component that could reach prisma fails the build.
import type { IngestView } from "@/lib/plan-ingest/runner";

/**
 * Reading a plan set, and watching it happen.
 *
 * THIS PANEL IS THE ENGINE, not a progress indicator bolted onto one. The work
 * advances because this component asks for the next slice — see
 * `lib/actions/planIngest.ts` for why the browser drives and the cron is only
 * the safety net: a cron's interval bounds throughput, sub-daily crons are a
 * plan feature, and a person who just uploaded drawings should not watch a bar
 * move once every five minutes.
 *
 * SO CLOSING THE TAB IS A FIRST-CLASS CASE rather than an edge one. Every slice
 * claims its pages with a lease, so an abandoned run leaves nothing corrupt: the
 * claims lapse, and the cron or the next person to open this page continues from
 * exactly where it stopped. That is the whole reason the claim column exists,
 * and it is why this component needs no "are you sure you want to leave".
 *
 * WHAT IT DOES NOT DO: pretend. The bar shows pages settled over pages total,
 * derived from the task rows on every slice, never interpolated and never
 * animated ahead of the work. A progress bar that moves on a timer is a lie
 * about the one thing a person is watching it to learn.
 */

/** How long to wait between slices.
 *
 * Not zero: back-to-back Server Actions would hold a request open continuously
 * and make the rest of the page feel stuck. A short gap keeps the tab
 * responsive and costs nothing — the slice itself is the expensive part. */
const SLICE_GAP_MS = 400;

/** Stop asking after this many consecutive slices that moved nothing.
 *
 * THE GUARD AGAINST AN INFINITE LOOP OF FREE WORK, which is what this component
 * would otherwise become when every remaining page is inside its backoff window:
 * the slice returns honestly that nothing was claimable, and a naive loop would
 * ask again 400ms later, forever, for as long as the tab is open. Three strikes
 * then stop, and the panel says why. */
const MAX_IDLE_SLICES = 3;

export type PlanIngestPanelProps = {
  planId: string;
  /** The count the VIEWER read off the document — the server has no PDF library
   *  to read it with, which is why `TakeoffPlan` has no `pageCount` column.
   *  Null when the document has not been opened yet, which is the ordinary case
   *  on a freshly uploaded set. */
  pageCount: number | null;
  /** An unfinished run over this set, if one exists, so a reload picks up where
   *  it left off rather than offering to start a second one. */
  existing: IngestView | null;
};

type Failure = { pageNumber: number; attempts: number; error: string | null };

export function PlanIngestPanel({ planId, pageCount, existing }: PlanIngestPanelProps) {
  const [view, setView] = useState<IngestView | null>(existing);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [running, setRunning] = useState(false);
  const [isPending, startTransition] = useTransition();

  /** Set on unmount so a slice that resolves after the panel is gone does not
   *  set state on a dead component, and does not schedule another slice. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadFailures = useCallback(async (jobId: string) => {
    const result = await planIngestFailures(jobId);
    if (!alive.current) return;
    if (result.ok) setFailures(result.value);
  }, []);

  /**
   * The slice loop.
   *
   * RECURSIVE WITH A TIMEOUT rather than `setInterval`, deliberately: an
   * interval fires whether or not the previous slice came back, so a slow slice
   * would overlap the next one and the page would hold several requests open at
   * once. This asks for the next slice only once the last has answered.
   */
  const pump = useCallback(
    async (jobId: string, idle: number) => {
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
        void loadFailures(jobId);
        return;
      }

      // Nothing settled this slice. Either every page is waiting out its
      // backoff, or another worker is doing them — both mean stop asking.
      const moved = !view || next.finished + next.exhausted > view.finished + view.exhausted;
      const nextIdle = moved ? 0 : idle + 1;
      if (nextIdle >= MAX_IDLE_SLICES) {
        setRunning(false);
        void loadFailures(jobId);
        return;
      }

      setTimeout(() => void pump(jobId, nextIdle), SLICE_GAP_MS);
    },
    // `view` is read for the moved-or-not comparison; including it is correct
    // and harmless, because `pump` is only ever called through a fresh closure.
    [loadFailures, view],
  );

  function onStart() {
    setError(null);
    startTransition(async () => {
      // `pageCount === null` cannot reach here — the button is disabled and the
      // sentence is rendered as guidance instead. Kept as a guard because a
      // disabled button is a UI fact rather than a contract, and this call
      // creates rows.
      if (pageCount === null) return;
      const started = await startPlanIngest(planId, "PAGE_INVENTORY", pageCount);
      if (!started.ok) return setError(started.error);
      setView(started.value);
      setRunning(true);
      void pump(started.value.jobId, 0);
    });
  }

  function onResume() {
    if (!view) return;
    setError(null);
    setRunning(true);
    void pump(view.jobId, 0);
  }

  function onRetry(pageNumber: number) {
    if (!view) return;
    setError(null);
    startTransition(async () => {
      const result = await retryPlanIngestPage(view.jobId, pageNumber);
      if (!result.ok) return setError(result.error);
      setFailures((current) => current.filter((failure) => failure.pageNumber !== pageNumber));
      setRunning(true);
      void pump(view.jobId, 0);
    });
  }

  useEffect(() => {
    if (existing && existing.exhausted > 0) void loadFailures(existing.jobId);
  }, [existing, loadFailures]);

  return (
    <section className="rounded-lg border border-line-card bg-surface p-4" data-plan-ingest="panel">
      <h3 className="mb-1 text-sm font-semibold text-ink">Reading the sheets</h3>

      {!view && (
        <>
          {/* DERIVED FROM `pageCount`, NOT WRITTEN INTO ERROR STATE AFTER A
              CLICK — a fix a person found by clicking this on 2026-09-27. The
              sentence used to be set as an `error` when somebody pressed the
              button with no sheet on file, and NOTHING CLEARED IT: they went
              and set a scale, the header updated to "1 sheet worked on", and
              the panel still told them to open the plan set in the viewer
              first. The advice was stale and the app looked like it had not
              noticed.

              As guidance it cannot go stale — the prop changes, the sentence
              goes. The same reasoning as this repo's rule that derived state is
              never stored, applied to a sentence rather than a figure. */}
          <p className="mb-3 text-sm text-ink-body">
            {pageCount === null
              ? "Open this plan set in the viewer first, so C Stream knows how many sheets it has. Setting a sheet's scale is what puts it on file."
              : "C Stream can walk this plan set sheet by sheet. It stops and resumes safely, so you can close this page and come back."}
          </p>
          <button
            type="button"
            onClick={onStart}
            disabled={isPending || pageCount === null}
            className="min-h-[48px] rounded-md bg-neutral-800 px-4 text-sm font-medium text-ink hover:bg-neutral-700 disabled:opacity-50"
          >
            {isPending ? "Starting…" : "Read the sheets"}
          </button>
        </>
      )}

      {view && (
        <>
          <p className="mb-2 text-sm text-ink-body" data-plan-ingest="progress">
            <span className="text-ink-label">
              {view.finished + view.exhausted} of {view.total}
            </span>{" "}
            {view.total === 1 ? "sheet" : "sheets"} ({view.percent}%)
            {view.exhausted > 0 && (
              <>
                {" — "}
                <span className="text-tag-amber-ink">
                  {view.exhausted} couldn&apos;t be read
                </span>
              </>
            )}
          </p>

          {/* The bar is the same two numbers, never interpolated. `aria-*`
              carries them too, because a bar is a picture of a number and a
              screen reader gets the number. */}
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={view.percent}
            aria-label="Sheets read"
            className="mb-3 h-2 w-full overflow-hidden rounded-full bg-canvas"
          >
            <div
              className={`h-full ${view.exhausted > 0 ? "bg-tag-amber-ink" : "bg-tag-green-ink"}`}
              style={{ width: `${view.percent}%` }}
            />
          </div>

          <p className="mb-3 text-sm text-ink-body" data-plan-ingest="state">
            {view.complete
              ? view.exhausted > 0
                ? "Finished, with some sheets unread. Retry them below."
                : "Every sheet read."
              : running
                ? "Reading…"
                : view.waiting
                  ? "Waiting a moment before trying the sheets that failed."
                  : "Paused. Nothing is lost — pick it up whenever."}
          </p>

          {!running && !view.complete && (
            <button
              type="button"
              onClick={onResume}
              className="min-h-[48px] rounded-md bg-neutral-800 px-4 text-sm font-medium text-ink hover:bg-neutral-700"
            >
              Keep reading
            </button>
          )}
        </>
      )}

      {failures.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 border-t border-line-card pt-3">
          {failures.map((failure) => (
            <li key={failure.pageNumber} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-ink-label">Sheet {failure.pageNumber}</span>
              <span className="text-ink-body">{failure.error ?? "Couldn't be read."}</span>
              <button
                type="button"
                onClick={() => onRetry(failure.pageNumber)}
                disabled={isPending}
                className="min-h-[48px] rounded-md border border-line-card px-3 text-sm text-ink hover:bg-canvas disabled:opacity-50"
              >
                Retry
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-3 text-sm text-tag-amber-ink">{error}</p>}
    </section>
  );
}
