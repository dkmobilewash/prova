import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── UNIT-PLAN JUNK: WHAT A PAIR OF LINES A WALL'S THICKNESS APART IS NOT ──
 *
 * The pairer accepts any two parallel lines a scheduled thickness apart. On a
 * unit plan that is also a dashed overhead line beside a wall face, a layout
 * or dimension line a foot off a partition, a cabinet or fixture drawn as a
 * closed box, and a shelf drawn as two short parallel lines. The trained
 * classifier passes all of them (NOTES, 2026-10-27: its features are the
 * pair's thickness and length, which these share with a partition), so this
 * reads what the pair is MADE OF and what it CONNECTS TO instead:
 *
 *   dashed      — a face drawn as many short pieces with gaps between them is
 *                 a hidden, overhead or boundary line, never a wall face;
 *   closed box  — a short run whose two faces are joined at BOTH ends by a
 *                 cap the thickness long is a drawn object (a cabinet, a
 *                 fixture), not a wall, which ends open or in another wall;
 *   free-standing — a short run neither end of which reaches any other
 *                 candidate is a thing inside a room, not a partition, which
 *                 by construction meets a wall at one end at least.
 *
 * Every constant is a physical one and is not fitted to a sheet.
 *
 * ── NOT WIRED INTO THE PRODUCT, AND THE MEASUREMENT IS WHY ──
 *
 * Measured on the 26 training sheets (NOTES, "A unit-plan junk filter",
 * 2026-10-27) through `zzLoboVeto.eval.ts` (LOBO_JUNK=1). As first written
 * (box at any thickness, dashed at 4 pieces / 75% cover) it removed 3,700 ft
 * of KEY wall for 1,631 ft of reviewer-rejected junk: a wall segment between
 * two door jambs is a short run capped at both ends, and a wall drawn as
 * existing is dashed. As it stands (box only at casework depth, dashed at 6
 * pieces / 60%) it removes 332 ft of key wall, 564 ft of rejected junk and
 * 708 ft nobody has labelled — the pairer's 13 in thickness ceiling already
 * keeps base cabinets out, so casework-shaped junk is about 300 ft across
 * the set. The extra footage the round-bubble test uncovers is almost
 * entirely UNLABELLED (candidates the shipped finder never offered), not
 * junk; a labelling pass is what measures it, not a filter. Kept as the
 * instrument the eval runs, so the next version is measured the same way.
 *
 * Coordinates are page-width units; `feetPerUnit` converts.
 */

/** A face is dashed when at least this many pieces cover at most this share of its length. */
const DASH_PIECES = 6;
const DASH_COVER = 0.6;
/** How far from the face line a piece may sit and still be on it, in feet. */
const ON_FACE_FT = 0.15;
/** Runs up to this long can be a box or a free-standing object; a partition can be any length. */
const SHORT_RUN_FT = 10;
/** An end cap joins the faces when it is within this of the run's end, in feet. */
const CAP_REACH_FT = 0.5;
/** A closed box is casework only at casework depth: an upper cabinet is 12 in,
 *  a vanity 21, a base cabinet 24. A 4–8 in run capped at both ends is a wall
 *  segment between two door jambs, and the first version of this took 605 ft
 *  of those on Topeka p74 alone. */
const BOX_MIN_DEPTH_FT = 11 / 12;
/** A run reaches another candidate when an end lies within this of its line, in feet. */
const TOUCH_FT = 1.5;

export type JunkReason = "dashed" | "closed-box" | "free-standing";

export type JunkVerdict = { wall: WallCandidate; reason: JunkReason };

type P = { x: number; y: number };

function along(w: WallCandidate): { ux: number; uy: number; nx: number; ny: number; len: number } {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy) || 1e-12;
  return { ux: dx / len, uy: dy / len, nx: -dy / len, ny: dx / len, len };
}

/** Pieces lying on a line through `origin` along `u`, within `tol` of it, projected onto [0, len]. */
function piecesOn(segments: readonly StrokeSegment[], origin: P, u: P, n: P, len: number, tol: number): [number, number][] {
  const out: [number, number][] = [];
  for (const s of segments) {
    const o1 = (s.x1 - origin.x) * n.x + (s.y1 - origin.y) * n.y;
    const o2 = (s.x2 - origin.x) * n.x + (s.y2 - origin.y) * n.y;
    if (Math.abs(o1) > tol || Math.abs(o2) > tol) continue;
    const a = (s.x1 - origin.x) * u.x + (s.y1 - origin.y) * u.y;
    const b = (s.x2 - origin.x) * u.x + (s.y2 - origin.y) * u.y;
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(len, Math.max(a, b));
    if (hi - lo > tol) out.push([lo, hi]);
  }
  return out;
}

function covered(pieces: [number, number][]): number {
  const sorted = [...pieces].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [lo, hi] of sorted) {
    if (hi <= end) continue;
    total += hi - Math.max(lo, end);
    end = hi;
  }
  return total;
}

function distToSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function junkReason(
  w: WallCandidate,
  segments: readonly StrokeSegment[],
  others: readonly WallCandidate[],
  feetPerUnit: number,
): JunkReason | null {
  if (w.curved === true) return null;
  const { ux, uy, nx, ny, len } = along(w);
  const u = { x: ux, y: uy };
  const n = { x: nx, y: ny };
  const tol = ON_FACE_FT / feetPerUnit;
  const half = w.thicknessFeet > 0 ? w.thicknessFeet / feetPerUnit / 2 : 0;
  const faces: P[] = half > 0
    ? [{ x: w.x1 + nx * half, y: w.y1 + ny * half }, { x: w.x1 - nx * half, y: w.y1 - ny * half }]
    : [{ x: w.x1, y: w.y1 }];

  // ── DASHED: every face is many pieces covering little of the run ──
  const dashed = faces.every((origin) => {
    const pieces = piecesOn(segments, origin, u, n, len, tol);
    return pieces.length >= DASH_PIECES && covered(pieces) / len <= DASH_COVER;
  });
  if (dashed) return "dashed";

  if (w.lengthFeet > SHORT_RUN_FT) return null;

  // ── CLOSED BOX: a cap across the thickness at both ends ──
  if (half > 0 && w.thicknessFeet >= BOX_MIN_DEPTH_FT) {
    const reach = CAP_REACH_FT / feetPerUnit;
    const capped = [0, 1].every((end) => {
      const ex = end === 0 ? w.x1 : w.x2;
      const ey = end === 0 ? w.y1 : w.y2;
      return segments.some((s) => {
        const sdx = s.x2 - s.x1;
        const sdy = s.y2 - s.y1;
        const slen = Math.hypot(sdx, sdy);
        if (slen < half * 1.2 || slen > half * 3) return false;
        // Across the run, not along it.
        if (Math.abs(sdx * ux + sdy * uy) / slen > 0.5) return false;
        const mx = (s.x1 + s.x2) / 2;
        const my = (s.y1 + s.y2) / 2;
        return Math.abs((mx - ex) * ux + (my - ey) * uy) <= reach && Math.abs((mx - ex) * nx + (my - ey) * ny) <= half + tol;
      });
    });
    if (capped) return "closed-box";
  }

  // ── FREE-STANDING: neither end reaches any other candidate ──
  const touch = TOUCH_FT / feetPerUnit;
  const ends: P[] = [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }];
  const reaches = ends.some((e) => others.some((o) => o !== w && distToSegment(e, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) <= touch));
  if (!reaches) return "free-standing";
  return null;
}

/** The candidates that are walls, and the ones set aside with the reason. */
export function withoutUnitPlanJunk(input: {
  walls: readonly WallCandidate[];
  /** The sheet's strokes in page-width units — the finder's `inUnits`. */
  segments: readonly StrokeSegment[];
  feetPerUnit: number;
}): { kept: WallCandidate[]; junk: JunkVerdict[] } {
  const kept: WallCandidate[] = [];
  const junk: JunkVerdict[] = [];
  for (const w of input.walls) {
    const reason = junkReason(w, input.segments, input.walls, input.feetPerUnit);
    if (reason === null) kept.push(w);
    else junk.push({ wall: w, reason });
  }
  return { kept, junk };
}
