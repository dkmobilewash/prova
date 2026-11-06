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
