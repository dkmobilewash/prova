import { modelVerdicts, type ScoredPairing } from "./demotedRuns";
import type { WallModel } from "./wallClassifier";

type Line = { x1: number; y1: number; x2: number; y2: number };

/**
 * ── WALLS THE MODEL DOUBTS STAY OFF THE ESTIMATE UNTIL SOMEBODY CONFIRMS THEM ──
 *
 * Offered junk was posting on "Walls — untyped", and Joplin's walls came to the
 * estimate 18% over the key. A run the wall model doubts now goes on its own
 * item, still drawn on the sheet and still a room boundary, and the estimate
 * skips that item until the estimator says it is a wall.
 *
 * The cut is 0.4, not the grey-out's 0.2. At 0.2 almost nothing moved: Joplin
 * stayed +19% and Baker +10%. Real wall left off, as a share of the key:
 *
 *   cut    training    held-out totals
 *   0.2    0.1%        0.9%
 *   0.4    0.5%        1.7%
 *   0.5    0.8%        2.7%
 *
 * Training flatters this model, which was trained on those sheets, so held-out
 * sets the limit of about 2%.
 */
export const ESTIMATE_HOLD_CUT = 0.4;
export const HELD_ITEM = "Walls — to confirm";
export const HELD_LABEL = "wall, to confirm";

/** The runs the model doubts. None on a scan: it was not trained on one. */
export function runsHeldOffEstimate<T extends Line & { thicknessFeet: number }>(
  model: WallModel,
  runs: readonly T[],
  pairings: readonly ScoredPairing[],
  feetPerUnit: number,
  scanned: boolean,
): T[] {
  const verdicts = modelVerdicts(model, ESTIMATE_HOLD_CUT, runs, pairings, feetPerUnit, { scanned });
  return runs.filter((_, at) => verdicts.has(at));
}

/** Is this stored run one of those? Stored runs carry the finder's own coordinates. */
export function isHeldRun(run: Line, held: readonly Line[]): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return held.some((h) => near(h.x1, run.x1) && near(h.y1, run.y1) && near(h.x2, run.x2) && near(h.y2, run.y2));
}
