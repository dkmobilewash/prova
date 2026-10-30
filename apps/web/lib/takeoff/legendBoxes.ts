import type { WallCandidate } from "./wallVectors";

/**
 * ── A FRAMED BLOCK OF TEXT IS A LEGEND, A SCHEDULE OR THE NOTES — NOT FOUR WALLS ──
 *
 * Joplin G-101 frames its CODE FOOTPRINT LEGEND and CODE SUMMARY in a double
 * rule; A-101 frames GENERAL PLAN NOTES and FLOOR PLAN LEGEND the same way.
 * Two rules five inches apart pair exactly as a wall does, the four sides
 * meet at corners exactly as a room's do, and the product offered all of
 * them: 95 + 94 + 32 + 32 ft on one box. The table-rows rule looks BETWEEN
 * a run's own faces and does not see a frame whose text is a yard inside it.
 *
 * What a framed text block has and a room does not: a TITLE in large type
 * in its top band, from a short vocabulary — LEGEND, SCHEDULE, KEYNOTES,
 * NOTES, SUMMARY, SYMBOLS, ABBREVIATIONS, WALL TYPES. A frame that qualifies
 * is set aside whole: its sides and every run inside it, because the inside
 * of a legend is wall SAMPLES ("NEW WALL" drawn as a double line) and the
 * inside of a schedule is its rules.
 *
 * Never a room, and the first version was: it also accepted text DENSITY
 * (twenty words at one per twenty square feet), which Joplin's CODE SUMMARY
 * meets at 0.07 — and so does a 56 by 6 ft row of nine labelled kennel runs
 * on Camp Bow Wow A102, which cost 178 ft of real wall in the sweep. So the
 * density path is gone, and the title has to be a HEADING: at least 1.4
 * times the sheet's median word height, so a room's "SEE NOTES" in body
 * type cannot qualify it.
 */
export const BOX_TITLE = /\b(LEGEND|SCHEDULES?|KEY ?NOTES?|KEYED NOTES?|NOTES|SUMMARY|SYMBOLS?|ABBREVIATIONS?|WALL TYPES?)\b/i;
export const CORNER_FEET = 1.5;
export const TITLE_BAND = 0.35;
export const HEADING_SIZE = 1.4;
export const MIN_SIDE_FEET = 3;

export type LegendBox = { from: number; to: number; fromY: number; toY: number; why: string };
type Word = { x: number; y: number; str: string; /** Type height, page-width units; omitted means ordinary. */ h?: number };
type Run = Pick<WallCandidate, "x1" | "y1" | "x2" | "y2">;

const isHorizontal = (w: Run) => Math.abs(w.y2 - w.y1) <= 0.1 * Math.abs(w.x2 - w.x1);
const isVertical = (w: Run) => Math.abs(w.x2 - w.x1) <= 0.1 * Math.abs(w.y2 - w.y1);

/** The qualifying boxes on a sheet, with the runs that are their sides and the runs inside them. */
export function legendBoxes<T extends Run>(
  walls: readonly T[],
  words: readonly Word[],
  feetPerUnit: number,
): { boxes: LegendBox[]; sides: Set<T>; inside: Set<T> } {
  const r = CORNER_FEET / feetPerUnit;
  const minSide = MIN_SIDE_FEET / feetPerUnit;
  const hs = walls.filter((w) => isHorizontal(w) && Math.abs(w.x2 - w.x1) >= minSide);
  const vs = walls.filter((w) => isVertical(w) && Math.abs(w.y2 - w.y1) >= minSide);
  const boxes: LegendBox[] = [];
  const sides = new Set<T>();
  const inside = new Set<T>();
  const near = (a: number, b: number) => Math.abs(a - b) <= r;
  const heights = words.map((w) => w.h).filter((h): h is number => h !== undefined && h > 0).sort((a, b) => a - b);
  const median = heights.length === 0 ? 0 : heights[Math.floor(heights.length / 2)];
  const isHeading = (w: Word) => BOX_TITLE.test(w.str) && (median === 0 ? w.h === undefined : (w.h ?? 0) >= HEADING_SIZE * median);
  // ── THE FRAME IS TWO UPRIGHTS AND AT LEAST ONE RAIL ──
  //
  // Joplin's CODE SUMMARY, GENERAL PLAN NOTES and FLOOR PLAN LEGEND frames
  // reach here with their top rule missing — it carries the title band and
  // is often an underline or a table rule to the earlier filters — so a
  // frame is two verticals whose ends agree, closed by a horizontal at the
  // top or the bottom or both. A room with a door in one wall is the same
  // shape, which is why the title and the density, not the geometry, decide.
  for (let i = 0; i < vs.length; i += 1) {
    const left = vs[i];
    const lx = (left.x1 + left.x2) / 2, ly0 = Math.min(left.y1, left.y2), ly1 = Math.max(left.y1, left.y2);
    for (let j = i + 1; j < vs.length; j += 1) {
      const right = vs[j];
      const rx = (right.x1 + right.x2) / 2;
      if (Math.abs(rx - lx) < minSide) continue;
      if (!near(ly0, Math.min(right.y1, right.y2)) || !near(ly1, Math.max(right.y1, right.y2))) continue;
      const x0 = Math.min(lx, rx), x1 = Math.max(lx, rx);
      const rail = (y: number) => hs.find((h) => near((h.y1 + h.y2) / 2, y) && near(Math.min(h.x1, h.x2), x0) && near(Math.max(h.x1, h.x2), x1));
      const top = rail(ly0), bottom = rail(ly1);
      if (top === undefined && bottom === undefined) continue;
      // ── WHAT IS WRITTEN INSIDE ──
      const within = words.filter((w) => w.x > x0 && w.x < x1 && w.y > ly0 && w.y < ly1);
      const title = within.find((w) => w.y - ly0 <= (ly1 - ly0) * TITLE_BAND && isHeading(w));
      if (title === undefined) continue;
      const why = `a framed block titled "${title.str.trim()}" — a legend, schedule or notes, not walls`;
      boxes.push({ from: x0, to: x1, fromY: ly0, toY: ly1, why });
      for (const side of [left, right, top, bottom]) if (side !== undefined) sides.add(side);
      for (const w of walls) {
        if (sides.has(w)) continue;
        const inX = (x: number) => x > x0 - r && x < x1 + r;
        const inY = (y: number) => y > ly0 - r && y < ly1 + r;
        if (inX(w.x1) && inX(w.x2) && inY(w.y1) && inY(w.y2)) inside.add(w);
      }
    }
  }
  return { boxes, sides, inside };
}
