import type { WallCandidate } from "./wallVectors";

/**
 * ── TWO DIMENSION LINES A WALL APART ARE NOT A WALL ──
 *
 * Stacked dimension strings pair up like wall faces, and on the new-build
 * training sheets they were the largest kind of junk with a name: 251 of the
 * 277 ft on Fairgrounds A-101. A string has many dimensions written along it
 * and almost nothing tees into it, which is what this asks.
 *
 * Priced on every offered run on the training sheets, per building: 529 ft of
 * junk for 12 ft of real wall, and 229 ft for 0 on the half not tuned on.
 *
 * The count is what makes it safe. An earlier rule took 2 dimensions, or 1 with
 * tick marks: 11:1 on training and only 1.7:1 held out, because a real wall
 * often has a dimension or two written across it. Thin pen as a guard was also
 * measured and made it worse, 2.2:1: real walls with text between are drawn thin too.
 */

/** Dimensions between the faces. Four, because one or two can cross a real wall. */
export const FEWEST_DIMENSIONS = 4;
/** Partitions may stop at a string by accident, but a wall has many more. */
export const MOST_MEETING = 3;
/** Within this of a face a word still counts as between the faces, in feet. */
const BETWEEN_SLACK_FEET = 0.4;
/** A run ending this close to another run's line meets it, in feet, beyond half the thickness. */
const MEET_REACH_FEET = 1.5;
/** `12'-6"`, `99'-9 7/8"`, `3' - 0"`: digits, feet-inches marks and nothing else. */
const DIMENSION_TEXT = /^[\d'"\-\s./±+]+$/;

type Run = Pick<WallCandidate, "x1" | "y1" | "x2" | "y2" | "thicknessFeet">;
type Word = { str: string; x: number; y: number };

const length = (a: Run) => Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
const offLine = (a: Run, x: number, y: number) => Math.abs((a.x2 - a.x1) * (a.y1 - y) - (a.x1 - x) * (a.y2 - a.y1)) / length(a);
const along = (a: Run, x: number, y: number) => ((x - a.x1) * (a.x2 - a.x1) + (y - a.y1) * (a.y2 - a.y1)) / length(a);

/** How many other runs end on this run's line, or cross it. */
export function runsMeeting(c: Run, others: readonly Run[], feetPerUnit: number): number {
  const reach = MEET_REACH_FEET / feetPerUnit;
  const l = length(c);
  let meets = 0;
  for (const o of others) {
    if (o === c) continue;
    const ends = [[o.x1, o.y1], [o.x2, o.y2]] as const;
    const near = ends.some(([x, y]) => offLine(c, x, y) * feetPerUnit <= MEET_REACH_FEET + c.thicknessFeet / 2 && along(c, x, y) >= -reach && along(c, x, y) <= l + reach);
    const a = (c.x2 - c.x1) * (o.y1 - c.y1) - (c.y2 - c.y1) * (o.x1 - c.x1);
    const b = (c.x2 - c.x1) * (o.y2 - c.y1) - (c.y2 - c.y1) * (o.x2 - c.x1);
    const middle = along(c, (o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2);
    if (near || (a * b < 0 && middle >= 0 && middle <= l)) meets += 1;
  }
  return meets;
}

/** Feet-inches words whose centre sits between the run's faces, along its length. */
export function dimensionsBetween(c: Run, words: readonly Word[], feetPerUnit: number): number {
  const slack = 0.5 / feetPerUnit;
  const l = length(c);
  return words.filter((w) => {
    if (!DIMENSION_TEXT.test(w.str) || !/\d/.test(w.str)) return false;
    const t = along(c, w.x, w.y);
    return t >= -slack && t <= l + slack && offLine(c, w.x, w.y) * feetPerUnit <= c.thicknessFeet / 2 + BETWEEN_SLACK_FEET;
  }).length;
}

export function isDimensionString(c: Run, others: readonly Run[], words: readonly Word[], feetPerUnit: number): boolean {
  if (length(c) === 0) return false;
  return dimensionsBetween(c, words, feetPerUnit) >= FEWEST_DIMENSIONS && runsMeeting(c, others, feetPerUnit) <= MOST_MEETING;
}
