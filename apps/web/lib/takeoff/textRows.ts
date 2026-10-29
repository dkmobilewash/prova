import type { WallCandidate } from "./wallVectors";

/**
 * ── TWO RULES OF A TABLE WITH ITS ROWS WRITTEN BETWEEN THEM ──
 *
 * A hardware schedule, a notes box, a legend: horizontal rules a few inches
 * apart with a row of text between each pair. The pair test reads two of
 * those rules as the faces of a wall, and the region placement leaves them on
 * the plan when the schedule sits inside the plan's own column (SW A110's
 * hardware schedule, Joplin's GENERAL PLAN NOTES, E Street's keynotes).
 *
 * What separates them from a wall: WORDS BETWEEN THE FACES along the run —
 * three or more, none of them a dimension — and nothing meeting the run, a
 * table being a thing no partition abuts. Wall tags do sit inside walls, but
 * one or two at a time, and a wall has partitions meeting it.
 *
 * Priced on every offered candidate of the 26 training label files
 * (`zzJunkKinds`, 2026-10-29): 301 ft of confirmed junk for 7 ft of real
 * wall, 43 to 1, on SW A110 (245) and E Street (56); the 7 ft is one 8 ft run
 * with a three-word tag in it. With "words ≥ 2" it is 2 to 1; with "words ≥ 4"
 * it loses nothing and takes 221 ft.
 */
export const TABLE_ROW_WORDS = 3;
/** Perpendicular candidates meeting the run that a table may have: a border it is drawn into. */
export const TABLE_MAX_TEES = 1;
/** A word may sit this far beyond the faces, in feet, and still be "between" them. */
const FACE_SLACK_FEET = 0.4;
/** A perpendicular run meeting this one ends within this many feet of its line. */
const MEETS_FEET = 1.5;
const DIMENSION = /^[\d'"\-\s./±+]+$/;

import { textItemCentre } from "./textCentre";

type Item = { str: string; x: number; y: number; width: number; height: number; angle?: number };

function alongT(w: WallCandidate, x: number, y: number): number {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const l2 = dx * dx + dy * dy;
  return l2 === 0 ? 0 : ((x - w.x1) * dx + (y - w.y1) * dy) / l2;
}
function offLine(w: WallCandidate, x: number, y: number): number {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const l = Math.hypot(dx, dy);
  return l === 0 ? Math.hypot(x - w.x1, y - w.y1) : Math.abs(dx * (w.y1 - y) - (w.x1 - x) * dy) / l;
}

/** Non-dimension words whose centre lies between the faces, along the run. */
export function wordsBetweenFaces(wall: WallCandidate, textItems: readonly Item[], widthPt: number, feetPerUnit: number): number {
  const reach = wall.thicknessFeet / 2 + FACE_SLACK_FEET;
  let n = 0;
  for (const item of textItems) {
    const str = item.str.trim();
    if (str === "" || (DIMENSION.test(str) && /\d/.test(str))) continue;
    const c = textItemCentre(item);
    const x = c.x / widthPt;
    const y = c.y / widthPt;
    const t = alongT(wall, x, y);
    if (t < -0.05 || t > 1.05) continue;
    if (offLine(wall, x, y) * feetPerUnit > reach) continue;
    n += 1;
  }
  return n;
}

/** Other candidates roughly perpendicular to this one with an end on its line. */
export function runsMeeting(wall: WallCandidate, others: readonly WallCandidate[], feetPerUnit: number): number {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const l = Math.hypot(dx, dy);
  if (l === 0) return 0;
  let n = 0;
  for (const o of others) {
    if (o === wall) continue;
    const ox = o.x2 - o.x1, oy = o.y2 - o.y1;
    const ol = Math.hypot(ox, oy);
    if (ol === 0 || Math.abs((dx * ox + dy * oy) / (l * ol)) > 0.26) continue;
    for (const [x, y] of [[o.x1, o.y1], [o.x2, o.y2]] as const) {
      const t = alongT(wall, x, y);
      if (t >= -0.02 && t <= 1.02 && offLine(wall, x, y) * feetPerUnit <= MEETS_FEET) { n += 1; break; }
    }
  }
  return n;
}

export function isTableRows(wall: WallCandidate, textItems: readonly Item[], others: readonly WallCandidate[], widthPt: number, feetPerUnit: number): boolean {
  return wordsBetweenFaces(wall, textItems, widthPt, feetPerUnit) >= TABLE_ROW_WORDS && runsMeeting(wall, others, feetPerUnit) <= TABLE_MAX_TEES;
}

/**
 * ── A LINE DRAWN UNDER A WORD IS THE WORD'S UNDERLINE ──
 *
 * A view title, a notes-box heading, a legend caption: the drafter rules a
 * line under the text, the line is as long as the text, and nothing else is
 * near it. Paired with a second rule or a box edge it reads as a wall — 354 ft
 * of confirmed junk on the training sheets (2026-10-29), 228 of them Joplin's
 * GENERAL PLAN NOTES box, against 26 ft of real wall that happened to sit
 * under a room name. So: a horizontal run, a word whose extent the run covers
 * (half a foot of slack either end), sitting within the word's own height or
 * a foot of the run, and the run no longer than 1.6 times the word plus a
 * foot. The length cap is what keeps a corridor wall with a room name on it
 * from qualifying.
 */
const UNDERLINE_SLACK_FEET = 0.5;
const UNDERLINE_LENGTH_RATIO = 1.6;

export function isUnderline(wall: WallCandidate, textItems: readonly Item[], widthPt: number, feetPerUnit: number): boolean {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const l = Math.hypot(dx, dy);
  if (l === 0 || Math.abs(dy) > l * 0.05) return false;
  const lengthFeet = l * feetPerUnit;
  const left = Math.min(wall.x1, wall.x2), right = Math.max(wall.x1, wall.x2);
  const slack = UNDERLINE_SLACK_FEET / feetPerUnit;
  for (const item of textItems) {
    if (item.str.trim() === "" || item.width <= 0) continue;
    const wx1 = item.x / widthPt, wx2 = (item.x + item.width) / widthPt;
    const wy = (item.y - item.height / 2) / widthPt;
    const heightFeet = (item.height / widthPt) * feetPerUnit;
    if (Math.abs(wy - wall.y1) * feetPerUnit > Math.max(1, heightFeet)) continue;
    if (left > wx1 + slack || right < wx2 - slack) continue;
    if (lengthFeet > (wx2 - wx1) * feetPerUnit * UNDERLINE_LENGTH_RATIO + 1) continue;
    return true;
  }
  return false;
}
