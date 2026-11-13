import { readFileSync } from "node:fs";
import type { ScoredPairing } from "./demotedRuns";
import { runsHeldOffEstimate } from "./estimateHold";
import type { PriorPlan } from "./priorPlan";
import { longFaces } from "./viewAlign";
import { deciderFor, scoreCandidate, type WallModel } from "./wallClassifier";
import { resolveModelPath } from "./wallModelFile";
import { RUN_FEATURE_NAMES, runFeatureRows } from "./wallRunFeatures";
import type { PageTextItem } from "./wallTags";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── THE RUN MODEL AT RUN TAKEOFF (METHOD v2, wired 2026-11-13 after its held-out exam passed) ──
 *
 * `models/wall-run-model.json` scores every run on offer (`wallRunFeatures.ts`' row). Two uses:
 *
 *  - REMOVE-ONLY: a run the hand chain would post (kept by the demolition compare, not held by
 *    the pairwise model) is held back when its score is below `RUN_REMOVE_BELOW`, exactly the rule
 *    the exam passed (held-out error 9,578 ft vs hand 10,859, no set worse).
 *  - AUTO-POST: its score rides on the stored run (`runScore`) and `wallItems.ts` posts it as
 *    "Walls (auto, high confidence)" at `MODEL_EVIDENCE.walls.autoPostAt`, for a company with the
 *    auto-post switch on.
 *
 * Behind `TAKEOFF_WALL_RUN_MODEL`: unset, nothing here runs and Run takeoff is what it was. Not
 * `TAKEOFF_WALL_MODEL`, which names the PAIRWISE model the grey-out already reads in production —
 * and which this model needs too, for its `modelScore` and `heldOffEstimate` columns.
 *
 * The feature table the model trained and was examined on (`zzWallFeatureTable.eval.ts`) calls
 * `runModelRows` below, so the exam's columns and the product's are one function.
 */
export const RUN_MODEL_ENV = "TAKEOFF_WALL_RUN_MODEL";
/** loso.py's `REMOVE_BELOW`, the line the exam passed at. */
export const RUN_REMOVE_BELOW = 0.1;

let cached: { key: string; model: WallModel | null } | null = null;

/** The run model named by `TAKEOFF_WALL_RUN_MODEL`, or null (unset, unreadable, or not this build's columns — logged once). */
export function loadRunModel(env: Record<string, string | undefined> = process.env): WallModel | null {
  const named = env[RUN_MODEL_ENV] ?? "";
  if (cached !== null && cached.key === named) return cached.model;
  let model: WallModel | null = null;
  if (named !== "") {
    const file = resolveModelPath(named);
    try {
      const read = JSON.parse(readFileSync(file, "utf8")) as WallModel & { kind?: string };
      if (read.kind === "run" && deciderFor(read, RUN_FEATURE_NAMES) !== null) model = read;
      else console.error("[wall-run-model] refused: not a gbdt-binary-v1 run model with this build's RUN_FEATURE_NAMES", { file });
    } catch (err) {
      console.error("[wall-run-model] unreadable, so Run takeoff runs without it", { file, kind: err instanceof Error ? err.name : "unknown" });
    }
  }
  cached = { key: named, model };
  return model;
}

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
