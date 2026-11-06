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
