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

// ── THE SET: one queue across every counted sheet ──

export type SetReviewItem = {
  pageNumber: number;
  measurementId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  score: number | null;
  held: boolean;
};

/** Every sheet's runs in one order, the same rule as a sheet's: likely junk feet, held last. */
export function setReviewOrder(items: readonly SetReviewItem[]): SetReviewItem[] {
  const order = reviewOrder(items.map((item, at) => ({ at, held: item.held, score: item.score, lengthFeet: item.lengthFeet })));
  return order.map((at) => items[at]!);
}

/**
 * What the set review says it has done: facts only. An estimate of "runs left to
 * reach ~10%" from the model's scores was measured and is not shipped: the scores
 * are not calibrated, so it said "review 90 more" on a set 2% over its key and
 * "within ~10%" on one still 37% over. See the PR body.
 */
export function setReviewProgress(queue: readonly SetReviewItem[], decided: ReadonlyMap<string, "keep" | "drop">): string {
  const dropped = queue.filter((item) => decided.get(item.measurementId) === "drop").reduce((n, item) => n + item.lengthFeet, 0);
  return `${decided.size} of ${queue.length} looked at · ${Math.round(dropped).toLocaleString("en-US")} ft dropped`;
}

/**
 * One sheet's posted walls as review items: each wall measurement a whole-set
 * run wrote, with the score its stored run carried. Dropped ones are already
 * decided and are left out; a measurement whose run has no score is unscored.
 */
export function setReviewItems(input: {
  pageNumber: number;
  feetPerUnit: number;
  measurements: readonly { id: string; kind: string; source: string; label: string | null; xs: readonly number[]; ys: readonly number[] }[];
  storedRuns: readonly { x1: number; y1: number; x2: number; y2: number; modelScore?: number }[];
  heldLabel: string;
  droppedLabel: string;
}): SetReviewItem[] {
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return input.measurements
    .filter((m) => m.kind === "LINEAR" && m.source === "DETECTED" && m.label !== input.droppedLabel && m.xs.length === 2 && m.ys.length === 2)
    .map((m) => {
      const [x1, x2] = [m.xs[0]!, m.xs[1]!];
      const [y1, y2] = [m.ys[0]!, m.ys[1]!];
      const run = input.storedRuns.find((r) => same(r.x1, x1) && same(r.y1, y1) && same(r.x2, x2) && same(r.y2, y2));
      return {
        pageNumber: input.pageNumber,
        measurementId: m.id,
        x1,
        y1,
        x2,
        y2,
        lengthFeet: Math.hypot(x2 - x1, y2 - y1) * input.feetPerUnit,
        score: run?.modelScore ?? null,
        held: m.label === input.heldLabel,
      };
    });
}
