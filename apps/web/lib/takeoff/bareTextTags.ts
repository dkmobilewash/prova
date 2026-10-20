import type { TagSymbol, TextForSymbol } from "./tagSymbols";
import type { WallCandidate } from "./wallVectors";

/**
 * ── A TAG WITH NO SYMBOL AROUND IT ──
 *
 * Bunkie prints `P08` beside a wall with a leader and nothing drawn around
 * it; MHK prints its door marks the same way. `tagSymbols` finds nothing on
 * either, because there is no closed shape to find, and the sheet reads as
 * untagged when every wall is named.
 *
 * Bare text is accepted as a tag under two conditions and no others:
 *
 *   1. it is EXACTLY a code the set's own legend defines, or a mark its own
 *      door schedule lists — the vocabulary is the filter, as it is for
 *      symbols, and `P08` on a sheet whose legend names P06–P09 is a tag
 *      where `P08` on any other sheet is a room number;
 *   2. it sits on or right beside a wall: within `BESIDE_FEET` of a run.
 *      A legend's own column of codes sits on no wall.
 *
 * Text already inside a found symbol is left to the symbol path.
 */

/** How far from a run a bare code may sit and still name it, in feet. */
export const BESIDE_FEET = 3;

export type BareTextTag = {
  text: string;
  /** Centre, in page-width units. */
  x: number;
  y: number;
  /** Distance to the nearest run, in feet. */
  nearestFeet: number;
};

export function bareTextTags(input: {
  text: readonly TextForSymbol[];
  /** Upper-cased codes or marks the set defines. */
  vocabulary: ReadonlySet<string>;
  symbols: readonly TagSymbol[];
  walls: readonly WallCandidate[];
  feetPerUnit: number;
  widthPt: number;
}): BareTextTag[] {
  const { text, vocabulary, symbols, walls, feetPerUnit, widthPt } = input;
  if (!(widthPt > 0) || !(feetPerUnit > 0)) return [];
  const out: BareTextTag[] = [];
  for (const item of text) {
    const word = item.str.trim().toUpperCase();
    if (word === "" || !vocabulary.has(word)) continue;
    const cx = item.x + item.width / 2;
    const cy = item.y - item.height / 2;
    if (symbols.some((s) => Math.hypot(s.x - cx, s.y - cy) <= s.radius)) continue;
    const px = cx / widthPt;
    const py = cy / widthPt;
    let nearest = Infinity;
    for (const w of walls) nearest = Math.min(nearest, distance(px, py, w));
    const nearestFeet = nearest * feetPerUnit;
    if (nearestFeet > BESIDE_FEET) continue;
    out.push({ text: item.str.trim(), x: px, y: py, nearestFeet });
  }
  return out;
}

function distance(px: number, py: number, w: WallCandidate): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / len2));
  return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy));
}
