import { inPageWidthUnits } from "./findWallsOnSheet";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── A PAIR OF DASHED LINES IS NOT A WALL TO BUILD ──
 *
 * The pair test asks whether two lines run side by side a wall-thickness
 * apart, and a hidden line does that as well as a face does: the dashed edge
 * of a canopy above, a mezzanine line, a property or setback line beside the
 * building edge, a demolished wall, a dashed grid line. `oneFacePerLine` joins
 * the dashes into one face before pairing, which is right for a face broken by
 * doors and exactly wrong here.
 *
 * Counted on the 26 training label files, product path, 2026-10-29: 2,122 ft
 * of confirmed junk has at least one dashed face, but so does 957 ft of real
 * wall — an existing wall drawn dashed, a face of hatch ticks — so "one face
 * dashed" is not a rule (2.2 to 1). BOTH faces dashed is: 590 ft of confirmed
 * junk against 33 ft of real wall, 18 to 1, the 33 ft being seven runs of
 * under 14 ft.
 *
 * Then measured where it counts, the 36-sheet sweep on top of #824's finder:
 * training extra −679 ft for missing +30 (Fairgrounds 21, NG Green Bay 3,
 * Topeka 6), no building worse by more than 21 ft; held-out, as a delta only,
 * extra −14 for missing +30 on one STEM wall. A floor on the dash length
 * (0.2 ft, to spare faces of hatch ticks) was tried and rejected: it saved
 * 9 ft of real wall and left 269 ft of junk on Bunkie A100 alone.
 *
 * What a dash pattern is here: several SHORT pieces with short regular gaps
 * covering a fair share of the run. A face broken by doors has long pieces; a
 * solid face has one.
 */
export const DASH_MIN_PIECES = 5;
export const DASH_MAX_PIECE_FEET = 2.5;
export const DASH_MAX_GAP_FEET = 2.5;
export const DASH_MIN_COVER = 0.25;
export const DASH_MAX_COVER = 0.9;
/** How far from the face's line a stroke may sit and still be part of it, in feet. */
const ON_FACE_FEET = 0.25;

export type FaceDash = {
  pieces: number;
  /** Share of the run the pieces cover, 0..1. */
  cover: number;
  longestFeet: number;
  medianPieceFeet: number;
  medianGapFeet: number;
};

const median = (xs: number[]) => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]);

/** The strokes along one face of the wall (`side` +1 or −1 of its centreline), as pieces of the run. */
export function faceDash(
  wall: WallCandidate,
  side: 1 | -1,
  /** The sheet's strokes in PAGE-WIDTH units, as `inPageWidthUnits` gives them. */
  segments: readonly StrokeSegment[],
  feetPerUnit: number,
): FaceDash {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const l = Math.hypot(dx, dy);
  const lengthFeet = l * feetPerUnit;
  if (l === 0) return { pieces: 0, cover: 0, longestFeet: 0, medianPieceFeet: 0, medianGapFeet: 0 };
  const ux = dx / l, uy = dy / l;
  const half = wall.thicknessFeet / 2;
  const reach = (half + ON_FACE_FEET) / feetPerUnit;
  const minX = Math.min(wall.x1, wall.x2) - reach, maxX = Math.max(wall.x1, wall.x2) + reach;
  const minY = Math.min(wall.y1, wall.y2) - reach, maxY = Math.max(wall.y1, wall.y2) + reach;
  const pieces: [number, number][] = [];
  for (const s of segments) {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    if (mx < minX || mx > maxX || my < minY || my > maxY) continue;
    const sdx = s.x2 - s.x1, sdy = s.y2 - s.y1;
    const sl = Math.hypot(sdx, sdy);
    if (sl === 0 || Math.abs((sdx * ux + sdy * uy) / sl) < 0.97) continue;
    const cross = dx * (my - wall.y1) - dy * (mx - wall.x1);
    if (wall.thicknessFeet > 0.05 && Math.sign(cross) !== side) continue;
    const off = (Math.abs(cross) / l) * feetPerUnit;
    if (Math.abs(off - half) > ON_FACE_FEET) continue;
    const t1 = ((s.x1 - wall.x1) * ux + (s.y1 - wall.y1) * uy) * feetPerUnit;
    const t2 = ((s.x2 - wall.x1) * ux + (s.y2 - wall.y1) * uy) * feetPerUnit;
    const a = Math.max(0, Math.min(t1, t2)), b = Math.min(lengthFeet, Math.max(t1, t2));
    if (b > a) pieces.push([a, b]);
  }
  pieces.sort((p, q) => p[0] - q[0]);
  let covered = 0, cur = -1, longest = 0, n = 0;
  const lens: number[] = [], gaps: number[] = [];
  for (const [a0, b0] of pieces) {
    const a1 = Math.max(a0, cur);
    if (b0 <= a1) continue;
    if (cur >= 0 && a1 - cur > 0.05) gaps.push(a1 - cur);
    covered += b0 - a1;
    cur = b0;
    n += 1;
    longest = Math.max(longest, b0 - a0);
    lens.push(b0 - a1);
  }
  return { pieces: n, cover: covered / Math.max(lengthFeet, 0.01), longestFeet: longest, medianPieceFeet: median(lens), medianGapFeet: median(gaps) };
}

export function isDashPattern(f: FaceDash): boolean {
  return (
    f.pieces >= DASH_MIN_PIECES &&
    f.longestFeet <= DASH_MAX_PIECE_FEET &&
    f.medianGapFeet > 0 &&
    f.medianGapFeet <= DASH_MAX_GAP_FEET &&
    f.cover >= DASH_MIN_COVER &&
    f.cover <= DASH_MAX_COVER
  );
}

/** True when BOTH faces of the pair are dash patterns. */
export function bothFacesDashed(wall: WallCandidate, segments: readonly StrokeSegment[], feetPerUnit: number): boolean {
  return isDashPattern(faceDash(wall, 1, segments, feetPerUnit)) && isDashPattern(faceDash(wall, -1, segments, feetPerUnit));
}

/** Convenience for callers holding strokes in points. */
export function bothFacesDashedInPoints(wall: WallCandidate, segmentsInPoints: readonly StrokeSegment[], widthPt: number, feetPerUnit: number): boolean {
  return bothFacesDashed(wall, segmentsInPoints.map(inPageWidthUnits(widthPt)), feetPerUnit);
}
