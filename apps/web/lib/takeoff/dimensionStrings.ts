import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── TWO PAIRS OF LINES A WALL APART THAT ARE NOT A WALL: A DIMENSION STRING, A GRID LINE ──
 *
 * On the cleaned keys (2026-10-30, `realplan/zzJunkKinds.eval.ts`) the
 * biggest junk that is NOT an existing wall is stacked dimension strings,
 * 2,447 ft: two dimension lines a foot apart with "99'-9 7/8"" written
 * between them, SW A110's two 100 ft ones, Joplin's, MHK's, Fairgrounds'.
 * "Dimension text between the faces" alone was priced twice and lost both
 * times (0.4 ft of junk per foot of real) because a real wall often has a
 * dimension written across it. What a dimension string has that a wall does
 * not is that NOTHING MEETS IT: no partition tees into a dimension line.
 * Priced on every offered run (`realplan/zzJunkRules.eval.ts`), per
 * building under the shipping rule:
 *
 *   ≥2 feet-inches texts between the faces, ≤1 run meets      432 junk / 28 real
 *   ≥1 text between and ≥1 perpendicular tick per 10 ft, ≤1    556 / 61
 *   axis-aligned, spans ≥85% of every other run, ≤1 meets       386 / 8
 *
 * The ticks are the witness lines and arrowheads crossing the string. The
 * third is the long line pair across the whole drawing — a property line
 * paired with a notes-box rule, a grid line and its neighbour — that at most
 * one wall touches; a real exterior wall is met by every partition behind
 * it. Each is set aside with its reason, never dropped.
 */

/** `12'-6"`, `99'-9 7/8"`, `3' - 0"`: digits, feet-inches marks and nothing else. */
export const DIMENSION_TEXT = /^[\d'"\-\s./±+]+$/;
/** At most this many other runs may meet a dimension string or a grid line. */
export const MEETS_MAX = 1;
/** Within this of a face a word still counts as "between the faces", in feet. */
export const BETWEEN_SLACK_FEET = 0.4;
/** A perpendicular stroke no longer than this crossing the band is a tick, in feet. */
export const TICK_MAX_FEET = 3;
/** A dimension string's ticks per 10 ft, when only one text sits between its faces. */
export const TICKS_PER_10_FEET = 1;
/** A grid line spans at least this share of every other run's extent along its axis. */
export const GRID_SPAN_SHARE = 0.85;
/** A run ending this close to another run's line meets it, in feet, beyond half the run's thickness. */
const MEET_REACH_FEET = 1.5;

type Word = { str: string; x: number; y: number };
type Run = Pick<WallCandidate, "x1" | "y1" | "x2" | "y2" | "thicknessFeet" | "lengthFeet">;

const len = (g: Run) => Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
function offLine(a: Run, px: number, py: number): number {
  const l = len(a);
  if (l === 0) return Math.hypot(px - a.x1, py - a.y1);
  return Math.abs((a.x2 - a.x1) * (a.y1 - py) - (a.x1 - px) * (a.y2 - a.y1)) / l;
}
function alongT(a: Run, px: number, py: number): number {
  const l = len(a);
  if (l === 0) return 0;
  return ((px - a.x1) * (a.x2 - a.x1) + (py - a.y1) * (a.y2 - a.y1)) / l;
}

/** How many other runs end on this run's line or cross it. */
export function runsMeeting(c: Run, others: readonly Run[], feetPerUnit: number): number {
  const l = len(c);
  if (l === 0) return 0;
  const th = c.thicknessFeet;
  const reach = MEET_REACH_FEET / feetPerUnit;
  let meets = 0;
  for (const o of others) {
    if (o === c) continue;
    const ends = [[o.x1, o.y1], [o.x2, o.y2]] as const;
    const near = ends.some(([x, y]) => offLine(c, x, y) * feetPerUnit <= MEET_REACH_FEET + th / 2 && alongT(c, x, y) >= -reach && alongT(c, x, y) <= l + reach);
    if (near) {
      meets += 1;
      continue;
    }
    const s1 = (c.x2 - c.x1) * (o.y1 - c.y1) - (c.y2 - c.y1) * (o.x1 - c.x1);
    const s2 = (c.x2 - c.x1) * (o.y2 - c.y1) - (c.y2 - c.y1) * (o.x2 - c.x1);
    if (s1 * s2 < 0) {
      const t = alongT(c, (o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2);
      if (t >= 0 && t <= l) meets += 1;
    }
  }
  return meets;
}

/** Feet-inches words whose centre sits between the run's faces, along its length. */
export function dimensionsBetween(c: Run, words: readonly Word[], feetPerUnit: number): number {
  const l = len(c);
  if (l === 0) return 0;
  const slack = 0.5 / feetPerUnit;
  let n = 0;
  for (const w of words) {
    if (!(DIMENSION_TEXT.test(w.str) && /\d/.test(w.str))) continue;
    const t = alongT(c, w.x, w.y);
    if (t < -slack || t > l + slack) continue;
    if (offLine(c, w.x, w.y) * feetPerUnit <= c.thicknessFeet / 2 + BETWEEN_SLACK_FEET) n += 1;
  }
  return n;
}

/** Short strokes perpendicular to the run crossing its band, per 10 ft. */
export function ticksPerTenFeet(c: Run, segments: readonly StrokeSegment[], feetPerUnit: number): number {
  const l = len(c);
  if (l === 0) return 0;
  const ux = (c.x2 - c.x1) / l, uy = (c.y2 - c.y1) / l;
  let ticks = 0;
  for (const s of segments) {
    const sl = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (sl === 0 || sl * feetPerUnit > TICK_MAX_FEET) continue;
    if (Math.abs(((s.x2 - s.x1) * ux + (s.y2 - s.y1) * uy) / sl) > 0.17) continue;
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    const t = alongT(c, mx, my);
    if (t < 0 || t > l) continue;
    if (offLine(c, mx, my) * feetPerUnit <= c.thicknessFeet / 2 + 0.3) ticks += 1;
  }
  const feet = l * feetPerUnit;
  return feet > 0 ? (10 * ticks) / feet : 0;
}

export type NotAWall = { kind: "dimension-string" | "grid-line"; why: string };

/**
 * Whether this run is a dimension string or a grid line rather than a wall.
 * `words` are the sheet's text items centred in page-width units; `segments`
 * the sheet's strokes in the same units; `others` the other offered runs.
 */
export function dimensionStringOrGridLine(
  c: Run,
  others: readonly Run[],
  words: readonly Word[],
  segments: readonly StrokeSegment[],
  feetPerUnit: number,
): NotAWall | null {
  const meets = runsMeeting(c, others, feetPerUnit);
  if (meets > MEETS_MAX) return null;
  const between = dimensionsBetween(c, words, feetPerUnit);
  if (between >= 2) return { kind: "dimension-string", why: `${between} dimensions written between the two lines and ${meets === 0 ? "nothing" : "one run"} meeting them — a dimension string, not a wall` };
  if (between >= 1) {
    const ticks = ticksPerTenFeet(c, segments, feetPerUnit);
    if (ticks >= TICKS_PER_10_FEET) return { kind: "dimension-string", why: `a dimension written between the two lines, ${ticks.toFixed(1)} witness ticks per 10 ft across them and ${meets === 0 ? "nothing" : "one run"} meeting them — a dimension string, not a wall` };
  }
  const l = len(c);
  const axis = Math.abs(c.y2 - c.y1) < l * 0.02 || Math.abs(c.x2 - c.x1) < l * 0.02;
  if (axis && others.length > 0) {
    let lo = Infinity, hi = -Infinity;
    for (const o of others) {
      if (o === c) continue;
      const a = alongT(c, o.x1, o.y1), b = alongT(c, o.x2, o.y2);
      lo = Math.min(lo, a, b);
      hi = Math.max(hi, a, b);
    }
    if (hi > lo && l / (hi - lo) >= GRID_SPAN_SHARE) return { kind: "grid-line", why: `runs the whole width of the drawing with ${meets === 0 ? "nothing" : "one run"} meeting it — a grid line, a property line or a border, not a wall` };
  }
  return null;
}
