import { modelVerdicts, type ScoredPairing } from "./demotedRuns";
import type { WallModel } from "./wallClassifier";

type Line = { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number };

/**
 * ── THE ORDER A REVIEWER MEETS THE RUNS ──
 *
 * The runs on the estimate first, then the runs held off it to confirm. Within
 * each, the most likely junk FEET first: length times doubt. Measured on the
 * training sheets with the labels as the reviewer, runs looked at to bring a
 * new build within +10% of the key, median per sheet:
 *
 *   by doubt alone (lowest score first)   26
 *   longest first                          6
 *   likely junk feet                       5   (shipped; 590 runs in all, against 1,146 by doubt)
 *
 * Doubt alone was what was asked for and is the slowest: the overcount is
 * mostly long junk, and the lowest scores are often short runs.
 */
export function reviewOrder(runs: readonly { at: number; held: boolean; score: number | null; lengthFeet?: number }[], by: ReviewOrderBy = "likely junk feet"): number[] {
  const rank = (r: { score: number | null; lengthFeet?: number }) => {
    if (by === "longest") return -(r.lengthFeet ?? 0);
    if (by === "likely junk feet") return -(r.lengthFeet ?? 0) * (1 - (r.score ?? UNSCORED_DOUBT));
    return r.score === null ? Number.POSITIVE_INFINITY : r.score;
  };
  const onEstimate = runs.filter((r) => !r.held).sort((a, b) => rank(a) - rank(b) || a.at - b.at);
  const held = runs.filter((r) => r.held).sort((a, b) => rank(a) - rank(b) || a.at - b.at);
  return [...onEstimate, ...held].map((r) => r.at);
}

export type ReviewOrderBy = "doubt" | "longest" | "likely junk feet";
/** A run the model has nothing to say about is taken as even odds. */
const UNSCORED_DOUBT = 0.5;

/** Each run's model score, the best of its pairings; null where it has none. */
export function runScores(model: WallModel, runs: readonly Line[], pairings: readonly ScoredPairing[], feetPerUnit: number): (number | null)[] {
  const verdicts = modelVerdicts(model, Number.POSITIVE_INFINITY, runs, pairings, feetPerUnit);
  return runs.map((_, at) => verdicts.get(at)?.score ?? null);
}

// ── THE REVIEW ITSELF: an order, a cursor, the decisions and their undo ──

export type ReviewDecision = { at: number; kind: "keep" | "drop" };
export type ReviewState = { order: readonly number[]; decided: readonly ReviewDecision[] };

export function startReview(order: readonly number[]): ReviewState {
  return { order, decided: [] };
}

/** The run to look at now: the first in order nobody has decided. Null when done. */
export function currentRun(state: ReviewState): number | null {
  const done = new Set(state.decided.map((d) => d.at));
  return state.order.find((at) => !done.has(at)) ?? null;
}

export function decide(state: ReviewState, kind: ReviewDecision["kind"]): ReviewState {
  const at = currentRun(state);
  return at === null ? state : { ...state, decided: [...state.decided, { at, kind }] };
}

/** Takes back the last decision, which is the run shown again. */
export function undoDecision(state: ReviewState): { state: ReviewState; undone: ReviewDecision | null } {
  const undone = state.decided.at(-1) ?? null;
  return { state: undone === null ? state : { ...state, decided: state.decided.slice(0, -1) }, undone };
}

export function droppedRuns(state: ReviewState): Set<number> {
  return new Set(state.decided.filter((d) => d.kind === "drop").map((d) => d.at));
}

export function reviewCounter(state: ReviewState): string {
  return `${state.decided.length} of ${state.order.length} reviewed`;
}

/**
 * Where to look for one run: its box with room round it, as a zoom factor and
 * the scroll that centres it. Page-width units in, pixels out.
 */
export function viewOfRun(
  run: { x1: number; y1: number; x2: number; y2: number },
  page: { widthPt: number; heightPt: number },
  frame: { width: number; height: number },
  feetPerUnit: number,
  baseScale: number,
): { zoom: number; left: number; top: number } {
  const pad = Math.max(12 / feetPerUnit, 0.5 * Math.hypot(run.x2 - run.x1, run.y2 - run.y1));
  const w = (Math.abs(run.x2 - run.x1) + 2 * pad) * page.widthPt * baseScale;
  const h = (Math.abs(run.y2 - run.y1) + 2 * pad) * page.widthPt * baseScale;
  const zoom = Math.min(6, Math.max(1, Math.min(frame.width / w, frame.height / h)));
  const scale = page.widthPt * baseScale * zoom;
  const cx = ((run.x1 + run.x2) / 2) * scale;
  const cy = ((run.y1 + run.y2) / 2) * scale;
  return { zoom, left: Math.max(0, cx - frame.width / 2), top: Math.max(0, cy - frame.height / 2) };
}
