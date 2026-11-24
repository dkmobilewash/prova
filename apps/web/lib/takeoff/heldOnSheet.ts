import type { ScoredPairing } from "./demotedRuns";
import { runsHeldOffEstimate } from "./estimateHold";
import { runScores } from "./wallReview";
import type { WallModel } from "./wallClassifier";
import { renoModelRemovals, runModelVerdicts, type RenoModels } from "./wallRunVerdicts";
import type { PageTextItem } from "./wallTags";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── WHICH OFFERED RUNS ARE HELD OFF THE LIST: ONE FUNCTION, FOR DETECTION AND FOR THE LIVE LIST ──
 *
 * Server detection held runs back from the estimate with three models — the pairwise estimate hold, the run model
 * and R — and the viewer's live "Run takeoff" list applied none of the last two, so the list a contractor watched
 * was less filtered than what posting, auto-post and the evals used (found by the second session, 2026-11-21;
 * `proposal-live-list-parity.md`). This is that block of `detectWallsForCalibration`, lifted out unchanged and
 * pure, so both sides call the SAME code with the same inputs. `liveParityCensus.test.ts` fails if either side
 * stops calling it or another list starts deciding holds on its own.
 *
 * The models are passed in, never loaded here: the server reads them from files, the viewer receives them as data.
 * A null model is skipped exactly as an absent file is on the server.
 */
export type HeldModels = {
  /** The pairwise model for the 0.55 estimate hold: null when the company turned demoted walls off. */
  hold: WallModel | null;
  /** The pairwise model the run features read: present whenever the run model or R is. */
  pair: WallModel | null;
  /** `TAKEOFF_WALL_RUN_MODEL`. */
  run: WallModel | null;
  /** `TAKEOFF_WALL_RENO_MODEL` (paired) and, behind `TAKEOFF_RENO_UNPAIRED=1`, `TAKEOFF_WALL_RENO_ALL_MODEL` (unpaired). */
  reno: RenoModels | null;
};

export type HeldInput = {
  /** Every run on offer BEFORE the demolition compare. */
  beforeCompare: readonly WallCandidate[];
  /** The runs on offer after it: the list that is shown. */
  kept: readonly WallCandidate[];
  pairings: readonly ScoredPairing[];
  segments: readonly StrokeSegment[];
  textItems: readonly PageTextItem[];
  widthPt: number;
  feetPerUnit: number;
  /** A scanned sheet: the run model and R are vector-only, as trained. */
  scanned: boolean;
  /** The aligned demolition plan as the run columns read it (`priorForRuns`), when there is one. */
  prior?: { lines: readonly { x1: number; y1: number; x2: number; y2: number }[]; faces: readonly { x1: number; y1: number; x2: number; y2: number }[] };
};

export type HeldResult = {
  /** The kept runs held back, as the very objects of `kept`. */
  held: WallCandidate[];
  /** The run model's score per kept run (`kept` order), NaN where it gave none. Auto-post reads it as `runScore`. */
  runScore: number[];
  /** The pairwise model's run score per kept run, null where none: the set-wide review orders by it (`modelScore`). */
  modelScore: (number | null)[];
};

export function heldOnSheet(input: HeldInput, models: HeldModels): HeldResult {
  const held: WallCandidate[] = models.hold === null ? [] : runsHeldOffEstimate(models.hold, input.kept, input.pairings, input.feetPerUnit, input.scanned);
  const run = input.scanned ? null : models.run;
  const reno = input.scanned ? null : models.reno;
  let runScore = input.kept.map(() => Number.NaN);
  if ((run !== null || reno !== null) && models.pair !== null) {
    const verdictInput = {
      offered: input.beforeCompare,
      kept: input.kept,
      pairings: input.pairings,
      pairModel: models.pair,
      segments: input.segments,
      textItems: input.textItems,
      widthPt: input.widthPt,
      feetPerUnit: input.feetPerUnit,
      ...(input.prior === undefined ? {} : { prior: input.prior }),
    };
    if (run !== null) {
      const verdicts = runModelVerdicts(verdictInput, run);
      runScore = verdicts.scores;
      for (const one of verdicts.removed) if (!held.includes(one)) held.push(one);
    }
    if (reno !== null) for (const one of renoModelRemovals(verdictInput, reno)) if (!held.includes(one)) held.push(one);
  }
  const modelScore = models.hold !== null && !input.scanned ? runScores(models.hold, input.kept, input.pairings, input.feetPerUnit) : input.kept.map(() => null);
  return { held, runScore, modelScore };
}
