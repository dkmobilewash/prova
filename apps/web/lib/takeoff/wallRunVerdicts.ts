import type { ScoredPairing } from "./demotedRuns";
import { runsHeldOffEstimate } from "./estimateHold";
import type { PriorPlan } from "./priorPlan";
import { longFaces } from "./viewAlign";
import { scoreCandidate, type WallModel } from "./wallClassifier";
import { runFeatureRows } from "./wallRunFeatures";
import type { PageTextItem } from "./wallTags";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * The run model's and R's DECISIONS, pure: no file is read here, so the viewer can run exactly the code server
 * detection runs (`heldOnSheet.ts`, prereg-live-list-parity.md). Loading the models from disk stays in
 * `wallRunModel.ts`, which re-exports all of this, so no caller changed.
 */

/** loso.py's `REMOVE_BELOW`, the line the exam passed at. */
export const RUN_REMOVE_BELOW = 0.1;

/** Renovation words on the sheet (the table's `renovation` column). */
export function isRenovationSheet(textItems: readonly { str: string }[]): boolean {
  const words = textItems.map((t) => t.str).join(" ");
  return /\(E\)/i.test(words) || (words.match(/\bEXIST/gi) ?? []).length >= 3 || /RENOVATION|REMODEL|TENANT IMPROVEMENT|\bDEMO/i.test(words);
}

type Line = { x1: number; y1: number; x2: number; y2: number };

/** The aligned demolition plan as the run columns read it: its kept lines and its long faces, shifted onto this sheet. */
export function priorForRuns(pp: PriorPlan, demo: { segments: readonly StrokeSegment[]; widthPt: number }, feetPerUnit: number, widthPt: number): { lines: Line[]; faces: Line[] } | undefined {
  if (pp.lines === null) return undefined;
  const sh = pp.shift ?? { dx: 0, dy: 0 };
  return {
    lines: pp.lines,
    faces: longFaces(demo.segments, demo.widthPt, (feetPerUnit * demo.widthPt) / widthPt).map((f) => ({ x1: f.x1 + sh.dx, y1: f.y1 + sh.dy, x2: f.x2 + sh.dx, y2: f.y2 + sh.dy })),
  };
}

const runKey = (r: Line) => `${r.x1.toFixed(5)},${r.y1.toFixed(5)},${r.x2.toFixed(5)},${r.y2.toFixed(5)}`;

export type RunModelInput = {
  /** Every run on offer BEFORE the demolition compare. */
  offered: readonly WallCandidate[];
  /** The runs on offer AFTER it (other objects; matched by position). All of `offered` with no aligned prior. */
  kept: readonly WallCandidate[];
  pairings: readonly ScoredPairing[];
  /** The pairwise wall model (`TAKEOFF_WALL_MODEL`). */
  pairModel: WallModel;
  segments: readonly StrokeSegment[];
  textItems: readonly PageTextItem[];
  widthPt: number;
  feetPerUnit: number;
  prior?: { lines: readonly Line[]; faces: readonly Line[] };
};

/** One feature row per `offered` run, and which of them the compare kept — the table's rows and the product's. */
export function runModelRows(input: RunModelInput): { rows: number[][]; kept: boolean[]; heldOff: boolean[] } {
  const keptKeys = new Set(input.kept.map(runKey));
  const kept = input.offered.filter((r) => keptKeys.has(runKey(r)));
  const heldOff = new Set(runsHeldOffEstimate(input.pairModel, kept, input.pairings, input.feetPerUnit, false));
  const rows = runFeatureRows({
    runs: input.offered,
    kept: new Set(kept),
    heldOff,
    pairings: input.pairings,
    model: input.pairModel,
    segments: input.segments,
    textItems: input.textItems,
    widthPt: input.widthPt,
    feetPerUnit: input.feetPerUnit,
    renovation: isRenovationSheet(input.textItems),
    ...(input.prior === undefined ? {} : { prior: input.prior }),
  });
  return { rows, kept: input.offered.map((r) => keptKeys.has(runKey(r))), heldOff: input.offered.map((r) => heldOff.has(r)) };
}

/**
 * The run model's score for each KEPT run (`input.kept` order), and the kept runs the remove-only
 * rule holds back: posted by the hand chain (not held by the pairwise model) and scored below
 * `RUN_REMOVE_BELOW`.
 */
export function runModelVerdicts(input: RunModelInput, runModel: WallModel): { scores: number[]; removed: WallCandidate[] } {
  const { rows, kept, heldOff } = runModelRows(input);
  const byKey = new Map<string, { score: number; posted: boolean }>();
  input.offered.forEach((r, i) => {
    if (kept[i]) byKey.set(runKey(r), { score: scoreCandidate(runModel, rows[i]!), posted: !heldOff[i] });
  });
  const scores: number[] = [];
  const removed: WallCandidate[] = [];
  for (const r of input.kept) {
    const v = byKey.get(runKey(r));
    scores.push(v?.score ?? Number.NaN);
    if (v !== undefined && v.posted && v.score < RUN_REMOVE_BELOW) removed.push(r);
  }
  return { scores, removed };
}

/**
 * The kept runs R holds back: none unless the sheet is a renovation sheet paired with its demolition
 * plan (an aligned prior), else exactly the run model's remove-only rule with R's scores.
 */
export function renoModelRemovals(input: RunModelInput, renoModel: WallModel): WallCandidate[] {
  if (input.prior === undefined || !isRenovationSheet(input.textItems)) return [];
  return runModelVerdicts(input, renoModel).removed;
}
