import { runDetection, type DetectReply, type DetectRequest, type FoundPairing } from "./detectRun";
import { regroupFrom } from "./findWallsOnSheet";
import type { SheetDetectResult } from "./offeredCandidates";
import { SheetTooSlowError } from "./timeBudget";
import { SheetTooDenseError } from "./wallVectors";

export type { DetectRequest, FoundPairing } from "./detectRun";

/**
 * ── RUN TAKEOFF FINDS THE SHEET OFF THE PAGE'S THREAD ──
 *
 * `detectForSheet` is seconds of synchronous work on a big sheet and it ran on the page's own
 * thread, so the tab could not paint, scroll or answer a click until it returned. On Broadway A1.0
 * that was more than 3.5 minutes, twice, in Chrome Round 22 (2026-11-13). The finder is faster now,
 * but no speed-up can promise every sheet a contractor uploads, so the guard is structural:
 *
 *  - the finder runs in a worker, so the page keeps its spinner and stays usable;
 *  - inside it, `withTimeBudget` stops the finder at `budgetMs` with `SheetTooSlowError`, which
 *    names the stage and tells the person to trace by hand;
 *  - and the page stops the worker outright at `limitMs`, in case anything ignores the budget.
 *
 * Where there is no `Worker` (the unit tests) or the worker cannot start, it runs on this thread
 * under the same budget, so the answer is the same and the worst case is bounded.
 */

/**
 * How long Run takeoff's finder may work before it stops itself, and when the page stops the worker
 * regardless. Off the page's thread a long budget costs a spinner, not a frozen tab, so it is set
 * for a slow machine rather than this one. Broadway A1.0, the slowest sheet measured, took 25–30 s
 * in the worker on an idle Mac and 60–90+ s on the same Mac while other jobs ran (one press ran
 * past a 90 s budget, 2026-11-13); the training sheets take a few seconds.
 */
export const FIND_BUDGET_MS = 180_000;
export const FIND_LIMIT_MS = 240_000;

/**
 * Finds the sheet in a worker and gives back what `detectForSheet` gives, `regroup` included.
 * Throws what the finder throws (`SheetTooSlowError`, `SheetTooDenseError`, an Error) so the
 * caller's existing `catch` says it.
 */
export async function detectOffThread(
  request: DetectRequest,
  limitMs: number,
): Promise<{ detected: SheetDetectResult; pairings: FoundPairing[] }> {
  const reply = await replyFor(request, limitMs);
  if (!reply.ok) {
    if (reply.kind === "too-slow") throw new SheetTooSlowError(reply.stage, reply.seconds);
    if (reply.kind === "too-dense") throw new SheetTooDenseError(reply.usableSegments);
    throw new Error(reply.message);
  }
  const { found, ...rest } = reply.detected;
  return { detected: { ...rest, found: { ...found, regroup: regroupFrom(found.regroupRecipe) } }, pairings: reply.pairings };
}

function replyFor(request: DetectRequest, limitMs: number): Promise<DetectReply> {
  let worker: Worker;
  try {
    if (typeof Worker === "undefined") return Promise.resolve(runDetection(request));
    worker = new Worker(new URL("./detect.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return Promise.resolve(runDetection(request));
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (reply: DetectReply | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      // A worker that could not run at all (a script that failed to load) is not an answer about
      // the sheet: the finder runs here instead, still under its budget.
      resolve(reply ?? runDetection(request));
    };
    const timer = setTimeout(() => settle({ ok: false, kind: "too-slow", stage: "reading the sheet", seconds: Math.round(limitMs / 1000) }), limitMs);
    worker.onmessage = (event: MessageEvent<DetectReply>) => settle(event.data);
    worker.onerror = () => settle(null);
    worker.postMessage(request);
  });
}
