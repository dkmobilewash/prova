/**
 * ── THE SAME WALL RUN, FOUND AGAIN ──
 *
 * A re-run of the finder can return a run a hair off the one already on the
 * job (Chrome on Baker A101, 2026-11-06): matched by exact coordinates, the
 * typed group read "untyped" under its own type's heading, Clear type found
 * nothing, and Set type wrote a SECOND row for the same wall. One test, used by
 * the panel, Set type and Clear type: both ends within a tolerance, either way
 * round. In page widths: 1e-3 is about 3½" on a 1/8" sheet, well inside the gap
 * between two walls.
 */
export const RUN_MATCH_TOLERANCE = 1e-3;

export function sameRunAs(run: { x1: number; y1: number; x2: number; y2: number }, xs: readonly number[], ys: readonly number[], tolerance = RUN_MATCH_TOLERANCE): boolean {
  if (xs.length !== 2 || ys.length !== 2) return false;
  const near = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) < tolerance;
  return (near(run.x1, run.y1, xs[0]!, ys[0]!) && near(run.x2, run.y2, xs[1]!, ys[1]!)) || (near(run.x1, run.y1, xs[1]!, ys[1]!) && near(run.x2, run.y2, xs[0]!, ys[0]!));
}

/**
 * ── A RUN THAT LIES ALONG ANOTHER ──
 *
 * A revised sheet's wall can be the earlier one cut in two, where a new wall
 * now meets it, or the same wall made longer: end-to-end it matches nothing, and
 * walk v8's revised A101 (two walls ADDED) read as 71 ft of S6A and S8B removed
 * and 82 ft new. `run` lies along the segment (xs, ys) when both its ends are
 * within `tolerance` of that segment's line and its midpoint falls within the
 * segment: a piece of it, or it extended.
 */
export function liesAlong(run: { x1: number; y1: number; x2: number; y2: number }, xs: readonly number[], ys: readonly number[], tolerance = RUN_MATCH_TOLERANCE): boolean {
  if (xs.length !== 2 || ys.length !== 2) return false;
  const ax = xs[0]!, ay = ys[0]!, dx = xs[1]! - ax, dy = ys[1]! - ay;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return false;
  const off = (x: number, y: number) => Math.abs((x - ax) * dy - (y - ay) * dx) / len;
  if (off(run.x1, run.y1) >= tolerance || off(run.x2, run.y2) >= tolerance) return false;
  const t = (((run.x1 + run.x2) / 2 - ax) * dx + ((run.y1 + run.y2) / 2 - ay) * dy) / (len * len);
  return t >= 0 && t <= 1;
}

type Line = { x1: number; y1: number; x2: number; y2: number };
/** Within 5°. */
export const SAME_WALL_COS = 0.9962;
/** The offset floor: half a 6-8" wall is 0.25-0.33 ft, and a deploy that moves every end 0.3 ft must still match. */
export const SAME_WALL_OFFSET_FEET = 0.35;
/** Overlap along the line, as a share of the LONGER run. */
export const SAME_WALL_OVERLAP = 0.6;

/** The overlap in feet when `a` and `b` are the same wall, else null. */
export function wallOverlapFeet(a: Line, b: Line, feetPerUnit: number, thicknessFeet = 0, shareOf: "longer" | "b" = "longer"): number | null {
  const la = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  const lb = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
  if (!(la > 0) || !(lb > 0) || !(feetPerUnit > 0)) return null;
  const ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la;
  if (Math.abs(ux * ((b.x2 - b.x1) / lb) + uy * ((b.y2 - b.y1) / lb)) <= SAME_WALL_COS) return null;
  const offFrom = (l: Line, len: number, x: number, y: number) => (Math.abs((l.x2 - l.x1) * (l.y1 - y) - (l.x1 - x) * (l.y2 - l.y1)) / len) * feetPerUnit;
  const off = Math.max(offFrom(a, la, b.x1, b.y1), offFrom(a, la, b.x2, b.y2), offFrom(b, lb, a.x1, a.y1), offFrom(b, lb, a.x2, a.y2));
  if (off > Math.max(SAME_WALL_OFFSET_FEET, thicknessFeet / 2)) return null;
  const t1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy, t2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy;
  const overlap = (Math.min(la, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2))) * feetPerUnit;
  return overlap >= SAME_WALL_OVERLAP * (shareOf === "b" ? lb : Math.max(la, lb)) * feetPerUnit ? overlap : null;
}

/**
 * ── THE SAME WALL AFTER A FINDER CHANGE (prereg-reattach-P0.md) ──
 *
 * A stored row keeps the finder's coordinates from the day it was posted. After a
 * deploy that moved an end, the exact matches (`sameRun` 1e-6, `isHeldRun` 1e-9,
 * `sameRunAs` ~3½") found nothing. A refresh then put DROPPED walls back on the
 * estimate, the viewer's Keep/Drop wrote nothing, and Set type counted a wall twice.
 * Same wall = within 5°, offset under half the thickness (floor 0.35 ft), and
 * overlapping by 60% of the LONGER run. A collinear twin further along the line, the
 * next wall over, or a stub on a long wall never matches (#1225 had the twin defect
 * in the labelling tool).
 */
export function sameWallRun(a: Line, b: Line, feetPerUnit: number, thicknessFeet = 0): boolean {
  return wallOverlapFeet(a, b, feetPerUnit, thicknessFeet) !== null;
}

/** The row that is the same wall as `run` with the most overlap, skipping `taken`; null when none is. */
export function nearestWallRun<T extends { id: string }>(run: Line, rows: readonly T[], lineOf: (row: T) => Line, feetPerUnit: number, taken?: ReadonlySet<string>): T | null {
  let best: { row: T; overlap: number } | null = null;
  for (const row of rows) {
    if (taken?.has(row.id)) continue;
    const overlap = wallOverlapFeet(lineOf(row), run, feetPerUnit);
    if (overlap !== null && (best === null || overlap > best.overlap)) best = { row, overlap };
  }
  return best?.row ?? null;
}

/** One-to-one, best overlap first across every pair: which fresh row each stored row is. */
export function matchWallRuns<S extends { id: string }, F extends { id: string }>(stored: readonly S[], fresh: readonly F[], lineOfStored: (s: S) => Line, lineOfFresh: (f: F) => Line, feetPerUnit: number): Map<string, F> {
  const pairs: { s: S; f: F; overlap: number }[] = [];
  for (const s of stored) for (const f of fresh) {
    const overlap = wallOverlapFeet(lineOfStored(s), lineOfFresh(f), feetPerUnit);
    if (overlap !== null) pairs.push({ s, f, overlap });
  }
  pairs.sort((x, y) => y.overlap - x.overlap);
  const out = new Map<string, F>();
  const usedFresh = new Set<string>();
  for (const { s, f } of pairs) {
    if (out.has(s.id) || usedFresh.has(f.id)) continue;
    out.set(s.id, f);
    usedFresh.add(f.id);
  }
  return out;
}

/** `run` lies mostly (60% of ITS length) along `row`: the finder's re-reading of part of that wall. */
export function liesMostlyOn(run: Line, row: Line, feetPerUnit: number): boolean {
  return wallOverlapFeet(row, run, feetPerUnit, 0, "b") !== null;
}
