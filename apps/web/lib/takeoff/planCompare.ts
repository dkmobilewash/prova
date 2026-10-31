import type { WallCandidate } from "./wallVectors";
import { alignViews, type Line } from "./viewAlign";

/**
 * ── A WALL ON THE PRIOR PLAN TOO IS NOT NEW WORK ──
 *
 * No drawing style separates existing from new across sets (NOTES.md,
 * 2026-10-30). Most renovation sets carry the answer another way: a demolition
 * or existing plan of the same level. Align the two, and a wall on the new plan
 * that the prior plan also draws is existing to remain; a wall only on the new
 * plan is new.
 *
 * Translation only, at this sheet's scale: a prior plan at another scale or
 * rotated aligns to nothing and sets nothing aside, which is the safe failure.
 * `pairDemoWithNewPlan` chooses the prior page and refuses to guess.
 */
/** Fewest agreeing wall pairs that count as the same plan. */
export const MIN_VOTES = 5;
/** How far a matched line may sit from where the wall says it should, in feet. */
export const SAME_PLACE_FEET = 0.5;
/** Two thicknesses are one band within an inch or 15%, the band `userExclusions` uses. */
export const THICKNESS_BAND_FEET = 1 / 12;
export const THICKNESS_BAND_SHARE = 0.15;
/** Share of a wall the prior plan must cover for it to be the same wall. */
export const SAME_WALL_SHARE = 0.7;
/** The finder paired too little on a demolition plan when its walls are under this share of the new sheet's feet: use raw faces. */
export const FEW_WALLS_SHARE = 0.25;

/** A prior-plan line: a wall with its thickness, or a raw face with none. */
export type PriorLine = Line & { thicknessFeet?: number };

const len = (l: Line) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);

/** Feet of `wall` lying along any of `prior`. Overlaps are merged, so two lines over one foot count it once. */
function coveredShare(wall: Line, reachUnits: number, prior: readonly Line[]): number {
  const l = len(wall);
  if (l === 0) return 0;
  const ux = (wall.x2 - wall.x1) / l, uy = (wall.y2 - wall.y1) / l;
  const spans: [number, number][] = [];
  for (const p of prior) {
    const pl = len(p);
    if (pl === 0 || Math.abs(((p.x2 - p.x1) * ux + (p.y2 - p.y1) * uy) / pl) < 0.97) continue;
    const off = (x: number, y: number) => Math.abs((x - wall.x1) * uy - (y - wall.y1) * ux);
    if (Math.max(off(p.x1, p.y1), off(p.x2, p.y2)) > reachUnits) continue;
    const a = (p.x1 - wall.x1) * ux + (p.y1 - wall.y1) * uy, b = (p.x2 - wall.x1) * ux + (p.y2 - wall.y1) * uy;
    const lo = Math.max(0, Math.min(a, b)), hi = Math.min(l, Math.max(a, b));
    if (hi > lo) spans.push([lo, hi]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let covered = 0, end = 0;
  for (const [lo, hi] of spans) {
    if (hi > end) {
      covered += hi - Math.max(lo, end);
      end = hi;
    }
  }
  return covered / l;
}

/** Sideways offset of a wall's face, in page-width units. */
function faceOf(wall: Line, offset: number): Line {
  const l = len(wall) || 1;
  const nx = -(wall.y2 - wall.y1) / l, ny = (wall.x2 - wall.x1) / l;
  return { x1: wall.x1 + nx * offset, y1: wall.y1 + ny * offset, x2: wall.x2 + nx * offset, y2: wall.y2 + ny * offset };
}

const band = (a: number, b: number) => Math.max(THICKNESS_BAND_FEET, THICKNESS_BAND_SHARE * Math.max(a, b));

/**
 * Same place and same thickness band. Against a prior WALL the thicknesses are
 * compared. Against raw FACES there is no thickness to read, so BOTH of this
 * wall's faces must be drawn: one line beside it is not a wall of this
 * thickness, which is what let a single face claim whole walls.
 */
export function onPriorPlan(wall: Pick<WallCandidate, "x1" | "y1" | "x2" | "y2" | "thicknessFeet">, prior: readonly PriorLine[], feetPerUnit: number): boolean {
  const reach = SAME_PLACE_FEET / feetPerUnit;
  const walls = prior.filter((p) => p.thicknessFeet !== undefined && Math.abs(p.thicknessFeet - wall.thicknessFeet) <= band(p.thicknessFeet, wall.thicknessFeet));
  if (coveredShare(wall, reach, walls) >= SAME_WALL_SHARE) return true;
  const faces = prior.filter((p) => p.thicknessFeet === undefined);
  if (faces.length === 0) return false;
  const half = wall.thicknessFeet / 2 / feetPerUnit;
  return coveredShare(faceOf(wall, half), reach, faces) >= SAME_WALL_SHARE && coveredShare(faceOf(wall, -half), reach, faces) >= SAME_WALL_SHARE;
}

/** The prior plan's walls moved onto this sheet, or null when the two do not align. */
export function alignPrior(walls: readonly Line[], prior: readonly PriorLine[], feetPerUnit: number): PriorLine[] | null {
  const shift = alignViews(walls, prior, feetPerUnit);
  if (shift === null || shift.votes < MIN_VOTES) return null;
  return prior.map((p) => ({ ...p, x1: p.x1 + shift.dx, y1: p.y1 + shift.dy, x2: p.x2 + shift.dx, y2: p.y2 + shift.dy }));
}
