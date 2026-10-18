import { angleOf, lengthOf, type StrokeSegment, type WallCandidate } from "./wallVectors";

/**
 * ── IS THERE ACTUALLY A LINE ALONG THIS WALL, OR ONLY THINGS THAT LINE UP? ──
 *
 * Camp Bow Wow A120's enlarged restroom plan came back with 29 diagonal runs
 * and 176 ft of "wall" at ±60°, drawn as two big X patterns across the floor.
 * There is no diagonal wall on that drawing. The X's are HATCHING, and this is
 * how they became walls:
 *
 *   - the hatch is a family of short ticks — 41 strokes at ±60°, the longest
 *     1.29 ft, the median 0.08 ft, at a 1.85in pitch;
 *   - `oneFacePerLine` joins collinear pieces into one face, correctly, because
 *     a real wall face broken by windows is also pieces;
 *   - two such assembled faces sit a plausible wall-thickness apart, so the
 *     pairer returns a 12 ft wall at 7-11/16in — a textbook partition by every
 *     measurement this repo takes.
 *
 * `inAHatchSeries` cannot reach them. It refuses a pair when it finds TWO more
 * parallel strokes at a whole number of the pair's own step, and that is a test
 * about a fill's PITCH; these faces are assembled, so the thing beside them is
 * a tick at a fraction of a step, in a family of 41 spread over a whole
 * drawing. Measured on A120: 0 to 3 parallel strokes within 5% of the page.
 *
 * ── WHAT SEPARATES THEM, MEASURED RATHER THAN REASONED ──
 *
 * The obvious rule was "a hatch has many parallel lines between the faces" and
 * IT IS WRONG. Counted on A120: the phantom diagonals have a median of 2 lines
 * between their faces and the real orthogonal walls a median of 6 — the real
 * walls have MORE, because a restroom plan is full of fixtures and tile. A
 * threshold there would have removed the walls and kept the hatch.
 *
 * What does separate them is how much of the run has ink along it:
 *
 *   | A120's enlarged plan, after the view split | coverage |
 *   | --- | --- |
 *   | the 29 diagonal X runs | 0.00 .. 0.15, median 0.09 |
 *   | the 11 orthogonal runs | 0.16 .. 1.00, median 0.86 |
 *
 * A hatch tick is one inch of a twelve-foot "wall", so the run is 91% empty
 * paper. A real wall is a line somebody drew along its whole length.
 *
 * ── AND IT IS BLIND TO ANGLE BY CONSTRUCTION, WHICH IS THE POINT ──
 *
 * The complaint was about diagonals, and the tempting fix is to distrust a
 * diagonal run. That would be wrong: a bay, a chamfered corner and a splayed
 * corridor are real angled walls, and this repo already lost S07's bay once to
 * a rule that could not handle one.
 *
 * This asks only "is there a stroke along this centreline", which a 45° wall
 * drawn as two continuous 45° lines answers exactly as a horizontal one does —
 * coverage 1.0 either way. `drawnCoverage.test.ts` pins that with a 45° wall
 * and a 45° hatch side by side, and the mutation that matters is making the
 * rule angle-aware: the hatch case stays green and the diagonal wall goes red.
 */

/**
 * How much of a run's own length must carry a stroke.
 *
 * ── CHOSEN FROM AN OPENING, NOT FROM THE GAP BETWEEN THE POPULATIONS ──
 *
 * The measured gap on A120 is 0.15 against 0.16, and sitting the threshold in
 * it would be fitting one sheet. The binding constraint is the other end: a
 * wall MERGED ACROSS AN OPENING is legitimately not drawn for the width of the
 * door, and `mergeWalls` reports a gross length that includes it. A 3 ft door
 * in a 12 ft wall is 0.75 covered; two doors in a 15 ft wall, 0.6.
 *
 * So the floor sits well below any wall an opening can thin and far above the
 * hatch: a run must have a stroke along a THIRD of itself.
 */
export const DRAWN_COVERAGE_MIN = 0.33;

/**
 * How far off the run's own line a stroke may sit and still count as drawing
 * it, as a multiple of the run's half-thickness.
 *
 * ── IT WAS 1.3, AND THAT COST ONE REAL WALL ON THE BENCH ──
 *
 * A wall's faces are at exactly half a thickness either side, so 1.3 looks
 * generous. Measured, it is not: at 1.3 the bench's missed-walls-over-10ft went
 * from 111 to 112, and the one it lost was a 36 ft wall on
 * `A-101__half-11x17`. At 2 the wall comes back and every phantom this filter
 * removes stays removed — 111 missed, 17 of 60 type-totals outside 2%, both
 * exactly the baseline, with phantoms down on about twenty cases.
 *
 * 3 measures identically to 2, so the value is inside a plateau rather than on
 * an edge. 2 is taken because it is the smaller of the two and the band still
 * cannot reach a neighbouring wall: `joinCorners` extends a run's ends and
 * `mergeWalls` joins across openings, either of which can leave the pairer's
 * centreline a little off the strokes that drew it, and a whole thickness of
 * slack covers that without reaching the next assembly.
 */
const FACE_BAND = 2;

/** Parallel to within this, in radians — the pairer's own tolerance. */
const PARALLEL_RAD = 0.05;

/**
 * The fraction of `wall`'s length that has a parallel stroke lying along it,
 * inside its own thickness. 1 is drawn end to end; 0 is nothing at all.
 */
export function drawnCoverage(
  wall: WallCandidate,
  strokes: readonly StrokeSegment[],
  /** Half the run's thickness, in the strokes' own coordinate units — only the
   *  caller's calibration can turn `thicknessFeet` into those. */
  halfBandUnits: number,
): number {
  const len = lengthOf(wall);
  if (!(len > 0)) return 1;
  const dir = angleOf(wall);
  const ux = (wall.x2 - wall.x1) / len;
  const uy = (wall.y2 - wall.y1) / len;
  const nx = -(wall.y2 - wall.y1) / len;
  const ny = (wall.x2 - wall.x1) / len;
  const band = halfBandUnits * FACE_BAND;
  const spans: [number, number][] = [];
  for (const seg of strokes) {
    if (!(lengthOf(seg) > 0)) continue;
    const gap = Math.abs(((angleOf(seg) - dir + Math.PI / 2) % Math.PI) - Math.PI / 2);
    if (gap > PARALLEL_RAD) continue;
    const a1 = seg.x1 - wall.x1;
    const b1 = seg.y1 - wall.y1;
    const a2 = seg.x2 - wall.x1;
    const b2 = seg.y2 - wall.y1;
    const across = Math.abs(((a1 + a2) / 2) * nx + ((b1 + b2) / 2) * ny);
    if (across > band) continue;
    const from = a1 * ux + b1 * uy;
    const to = a2 * ux + b2 * uy;
    spans.push([Math.min(from, to), Math.max(from, to)]);
  }
  if (spans.length === 0) return 0;
  // ── THE UNION OF THE SPANS, NOT THEIR SUM ──
  //
  // A wall has TWO faces and both lie along it, so a sum would report 2.0 for
  // an ordinary partition, and a hatch with four ticks stacked at one place
  // would out-score a wall drawn end to end. Each part of the run counts once.
  spans.sort((p, q) => p[0] - q[0]);
  let covered = 0;
  let at = -Infinity;
  for (const [from, to] of spans) {
    const lo = Math.max(from, at, 0);
    const hi = Math.min(to, len);
    if (hi > lo) covered += hi - lo;
    at = Math.max(at, to);
  }
  return covered / len;
}

/**
 * The runs that are actually drawn, with the hatch slices removed.
 *
 * ── A CURVED RUN IS EXEMPT, AND NOT BECAUSE IT IS AWKWARD ──
 *
 * `curvedWalls` reports a run whose `lengthFeet` is the CENTRELINE ARC while
 * its endpoints are only the chord — 14.17 ft against 12.0 on S07's bay. Every
 * span here is measured along the chord, so an arc's own strokes bow away from
 * the line being measured and a perfectly drawn bay reads as barely covered.
 * The right rule for an arc is a different one, and inventing it here to avoid
 * an exemption is how S07's bay was lost the first time.
 */
export function wallsActuallyDrawn(
  walls: readonly WallCandidate[],
  strokes: readonly StrokeSegment[],
  feetPerUnit: number,
  minCoverage: number = DRAWN_COVERAGE_MIN,
): WallCandidate[] {
  if (!(feetPerUnit > 0)) return [...walls];
  return walls.filter((wall) => {
    if (wall.curved === true) return true;
    const halfBandUnits = wall.thicknessFeet / feetPerUnit / 2;
    return drawnCoverage(wall, strokes, halfBandUnits) >= minCoverage;
  });
}
