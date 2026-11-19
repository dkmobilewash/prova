import { matchWallRuns } from "./runMatch";
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
 * ── THE CUT IS 0.55, DIEGO'S CALL (2026-11-03), NOW THAT REVIEW WALLS EXISTS ──
 *
 * It was 0.4, picked by a rule that kept real wall held off under 2%. Review
 * walls put a held run one keypress from the estimate, so a higher hold costs a
 * reviewer a K rather than a lost wall. Swept on training sheets only:
 *
 *   cut    new build    real held off      renovation    real held off    review runs    worst building
 *          vs key       (new build)        vs key        (renovation)     to +10%
 *   0.40   +28.5%       0.5%, 171 ft       +179%         0.4%, 10 ft      6.5            Topeka 89 ft
 *   0.45   +27.1%       0.5%, 177 ft       +175%         1.2%, 26 ft      6              Topeka 92 ft
 *   0.50   +24.7%       0.7%, 241 ft       +171%         2.4%, 52 ft      6              Topeka 107 ft
 *   0.55   +22.4%       0.8%, 288 ft       +168%         2.7%, 58 ft      5              Topeka 110 ft
 *   0.60   +20.5%       1.4%, 489 ft       +148%         13%, 286 ft      4              Alden 207 ft
 *
 * Review runs are the median a simulated reviewer looks at, in likely-junk-feet
 * order with held runs last, to bring a new-build sheet within +10% of its key.
 * A rule logged before the sweep picked nothing, because renovation already
 * misses 6.9% of real wall in total at 0.4 against its 6% ceiling; 0.55 passed
 * the rule's other three conditions. 0.6 is out on any reading: Alden's held
 * walls are most of the building.
 *
 * Held-out, read once at 0.55, totals only: posted +94% against +104% at 0.4,
 * and real wall held off 4.0% (366 ft) against 1.7%, for 2,330 ft of junk.
 * The grey-out's own cut stays 0.2 (`modelNeverHides.test.ts`).
 */
export const ESTIMATE_HOLD_CUT = 0.55;
export const HELD_ITEM = "Walls — to confirm";
export const HELD_LABEL = "wall, to confirm";
/** Where a run a reviewer dropped goes: on the sheet, off the estimate, one undo from back. */
export const DROPPED_ITEM = "Walls — dropped";
export const DROPPED_LABEL = "wall, dropped";
/** A run a person said is a wall: priced untyped, and a re-find leaves it there. */
export const KEPT_LABEL = "wall, kept";
/** Labels only a person writes. A re-find keeps these and re-reads every other from the model. */
export const PERSON_LABELS: readonly string[] = [KEPT_LABEL, DROPPED_LABEL];
/** Typed by a person: Set type, and Accept in the review queue, write "<code> wall (set by hand)". */
export const SET_BY_HAND = " (set by hand)";
/** A person decided this row: kept, dropped, or typed by hand. A finder re-run must never reset it. */
export function personDecided(label: string | null): boolean {
  return label !== null && (PERSON_LABELS.includes(label) || label.endsWith(SET_BY_HAND));
}
/** Items the estimate leaves out: nothing on them is a wall anybody has accepted. */
export const OFF_ESTIMATE_ITEMS: readonly string[] = [HELD_ITEM, DROPPED_ITEM];

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

/**
 * The same run on the screen and on the job, within a millionth of the page
 * width and either way round: the viewer's find and the stored walls are two
 * detections, and an exact match let a review D miss the wall it was dropping.
 */
export function sameRun(a: Line, b: Line, tolerance = 1e-6): boolean {
  const near = (p: number, q: number) => Math.abs(p - q) <= tolerance;
  return (near(a.x1, b.x1) && near(a.y1, b.y1) && near(a.x2, b.x2) && near(a.y2, b.y2)) || (near(a.x1, b.x2) && near(a.y1, b.y2) && near(a.x2, b.x1) && near(a.y2, b.y1));
}

/**
 * ── KEEP / DROP NEVER CHANGES THE SCREEN WITHOUT THE SERVER (prereg-reattach-P0.md) ──
 *
 * What a review decision does with the stored row it matched. It decided on screen
 * and wrote nothing whenever no row matched, which after a finder deploy was every
 * moved run: the reviewer saw the drop, and it was gone on reload.
 *   "write"   a drop, or any decision on a held run: the row changes on the server;
 *   "screen"  a keep on a run already counted (nothing to change), or a run on a
 *             sheet with no walls on the job yet (the panel says "not on the job yet");
 *   "refuse"  the sheet's walls ARE on the job and none is this run: say so, decide nothing.
 */
export function reviewWrite(posted: { label: string | null } | null, kind: "keep" | "drop", sheetHasWalls: boolean): "write" | "screen" | "refuse" {
  if (posted === null) return sheetHasWalls ? "refuse" : "screen";
  return kind === "drop" || posted.label === HELD_LABEL ? "write" : "screen";
}

/**
 * ── "NEEDS A LOOK", DERIVED ON READ AND NEVER STORED ──
 *
 * How many of a sheet's person-decided wall rows (kept, dropped, typed by hand)
 * match no run of the current reading (`matchWallRuns`). They stay as the person
 * left them, and this says so. Zero when there is no reading to compare against.
 */
export function needsLookCount(rows: readonly { id: string; kind: string; xs: number[]; ys: number[]; label: string | null }[], runs: readonly Line[], feetPerUnit: number | null): number {
  if (runs.length === 0 || feetPerUnit === null) return 0;
  const people = rows.filter((m) => m.kind === "LINEAR" && m.xs.length === 2 && personDecided(m.label));
  const fresh = runs.map((r, at) => ({ ...r, id: `r${at}` }));
  const lineOfRow = (m: (typeof people)[number]) => ({ x1: m.xs[0]!, y1: m.ys[0]!, x2: m.xs[1]!, y2: m.ys[1]! });
  const pairs = matchWallRuns(people, fresh, lineOfRow, (r) => r, feetPerUnit);
  return people.filter((m) => !pairs.has(m.id)).length;
}
