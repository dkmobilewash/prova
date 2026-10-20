/**
 * ── SCORING A FINDER AGAINST A HELD-OUT BUILDING'S ANSWER KEY ──
 *
 * The key for a held-out sheet is ACCEPTED walls plus TRACED ones, and the
 * traced half is what makes the score mean anything: without it the key
 * contains only walls the finder already proposed, so a finder that proposes
 * nothing scores perfectly and every miss is invisible. Tracing is how a
 * reviewer records a wall the finder never offered.
 *
 * ── MEASURED IN FEET, NOT IN RUNS ──
 *
 * A subcontractor bills linear feet. Two readings of one wall as 20 ft and
 * 19.4 ft are nearly the same money and two different runs, so a count of
 * matched runs flatters or punishes the finder for how it happened to split a
 * wall. Feet are what the estimate is made of.
 *
 * Three numbers per sheet, and the third is the one to read first:
 *
 *   MISSING  key feet no proposal covers        — walls that would be unbilled
 *   EXTRA    proposed feet no key wall covers   — walls that would be overbilled
 *   NET      proposed minus key                 — what the bid would be out by
 *
 * Net can be near zero while both halves are large, which is why all three are
 * reported. A finder that misses a 40 ft wall and invents a 40 ft one nets to
 * nothing and is wrong twice.
 */

export type ScoredRun = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
};

export type SheetScore = {
  set: string;
  sheet: string;
  keyFeet: number;
  keyFromTraced: number;
  proposedFeet: number;
  missingFeet: number;
  extraFeet: number;
  netFeet: number;
  keyRuns: number;
  proposedRuns: number;
};

/**
 * How far a proposal may sit from a key wall and still be the same wall, in
 * feet, perpendicular to it.
 *
 * 1.5 ft, the same band `duplicateCandidates` uses for "one wall offered
 * twice" — wider than drafting jitter and the nine-inch offset twins that
 * started this, narrower than a corridor or a cavity.
 */
export const SAME_WALL_FEET = 1.5;

const len = (r: ScoredRun) => Math.hypot(r.x2 - r.x1, r.y2 - r.y1);

/** Perpendicular distance from `p` to the infinite line through `r`. */
function offLine(r: ScoredRun, px: number, py: number): number {
  const l = len(r);
  if (l === 0) return Math.hypot(px - r.x1, py - r.y1);
  return Math.abs((r.x2 - r.x1) * (r.y1 - py) - (r.x1 - px) * (r.y2 - r.y1)) / l;
}

/** How much of `b` lies along `a`, in `a`'s direction, as a length. */
function overlapAlong(a: ScoredRun, b: ScoredRun): number {
  const la = len(a);
  if (la === 0) return 0;
  const ux = (a.x2 - a.x1) / la;
  const uy = (a.y2 - a.y1) / la;
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const b1 = at(b.x1, b.y1);
  const b2 = at(b.x2, b.y2);
  const lo = Math.max(0, Math.min(b1, b2));
  const hi = Math.min(la, Math.max(b1, b2));
  return Math.max(0, hi - lo);
}

/**
 * The feet of `a` that no run in `others` covers.
 *
 * Covered length is summed per other-run. Two proposals along one key wall
 * can therefore sum to more than its length, which `Math.max(0, ...)` below
 * already clamps — so there is no separate cap. An earlier version had one
 * (`Math.min(aLen, covered)`) and mutation showed it changed nothing
 * reachable: the clamp was doing the work. Removed rather than left as a
 * second guard nobody can test.
 *
 * The duplicate still shows up, as EXTRA rather than as coverage, which is
 * what double-billing a wall would be.
 */
function uncoveredFeet(
  a: ScoredRun,
  others: readonly ScoredRun[],
  feetPerUnit: number,
): number {
  const band = SAME_WALL_FEET / feetPerUnit;
  const aLen = len(a);
  if (aLen === 0) return 0;
  let covered = 0;
  for (const other of others) {
    // Both ends of the other run within the band of a's line, as
    // `duplicateCandidates` requires — a wall crossing at a shallow angle
    // touches the line and is not the same wall.
    const ends = Math.max(
      offLine(a, other.x1, other.y1),
      offLine(a, other.x2, other.y2),
    );
    if (ends > band) continue;
    covered += overlapAlong(a, other);
  }
  return Math.max(0, (aLen - covered) * feetPerUnit);
}

/**
 * Score one sheet's proposals against its key.
 *
 * `key` is accepted PLUS traced. `proposed` is whatever the thing under test
 * put forward — the rules alone, or the rules with a classifier's vetoes
 * applied.
 */
export function scoreSheet(input: {
  set: string;
  sheet: string;
  key: readonly ScoredRun[];
  proposed: readonly ScoredRun[];
  feetPerUnit: number;
  keyFromTracedFeet?: number;
}): SheetScore {
  const { set, sheet, key, proposed, feetPerUnit } = input;
  const keyFeet = key.reduce((n, r) => n + len(r) * feetPerUnit, 0);
  const proposedFeet = proposed.reduce((n, r) => n + len(r) * feetPerUnit, 0);
  const missingFeet = key.reduce((n, r) => n + uncoveredFeet(r, proposed, feetPerUnit), 0);
  const extraFeet = proposed.reduce((n, r) => n + uncoveredFeet(r, key, feetPerUnit), 0);
  return {
    set,
    sheet,
    keyFeet,
    keyFromTraced: input.keyFromTracedFeet ?? 0,
    proposedFeet,
    missingFeet,
    extraFeet,
    netFeet: proposedFeet - keyFeet,
    keyRuns: key.length,
    proposedRuns: proposed.length,
  };
}

/** The same numbers across several sheets, summed rather than averaged. */
export function totalScore(sheets: readonly SheetScore[]): {
  sheets: number;
  keyFeet: number;
  keyFromTraced: number;
  proposedFeet: number;
  missingFeet: number;
  extraFeet: number;
  netFeet: number;
} {
  const sum = (pick: (s: SheetScore) => number) => sheets.reduce((n, s) => n + pick(s), 0);
  return {
    sheets: sheets.length,
    keyFeet: sum((s) => s.keyFeet),
    keyFromTraced: sum((s) => s.keyFromTraced),
    proposedFeet: sum((s) => s.proposedFeet),
    missingFeet: sum((s) => s.missingFeet),
    extraFeet: sum((s) => s.extraFeet),
    // Summed, not averaged: a sheet 50 ft over and one 50 ft under is a bid
    // that is right by accident, and averaging says so where summing does not.
    netFeet: sum((s) => s.netFeet),
  };
}

/**
 * The key for a saved label file: accepted walls plus traced ones.
 *
 * Exported because getting this wrong is silent — a key built from accepted
 * runs alone looks complete and measures the finder against its own output.
 */
export function keyFromLabels(saved: {
  verdicts: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number; lengthFeet: number; verdict: string }>;
}): { key: ScoredRun[]; fromTracedFeet: number } {
  const key: ScoredRun[] = [];
  let fromTracedFeet = 0;
  for (const v of saved.verdicts) {
    if (v.verdict !== "wall" && v.verdict !== "traced") continue;
    key.push({ x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, lengthFeet: v.lengthFeet });
    if (v.verdict === "traced") fromTracedFeet += v.lengthFeet;
  }
  return { key, fromTracedFeet };
}
