import type { StrokeSegment } from "./wallVectors";

/**
 * ── THE TITLE BLOCK, READ OFF THE SHEET'S OWN RULED BOUNDARY (prereg-not-drawing-v2.md) ──
 *
 * The scan path has had a title-strip aside since its six-training-scan measurement (360 ft junk,
 * 9 ft real) — but as a FIXED x >= 0.89, scan-only, with its own note asking for the block's border
 * to be read instead. This reads it: the LEFTMOST vertical ruled line spanning >= 0.85 of the page
 * height in the right quarter of the sheet whose right side carries at least two distinct title
 * words and no plan caption is the title column's boundary; the analogous lowest full-width rule in
 * the bottom 15% with title words below it is a bottom title band. Constants fixed in the prereg.
 */
const TITLE_WORDS = /\b(SCALE|DATE|DRAWN|CHECKED|SHEET|PROJECT|REVISION|JOB|ISSUE|SEAL|ARCHITECT)\b/gi;
const SPAN_SHARE = 0.85;
const RIGHT_QUARTER = 0.75;
const BOTTOM_BAND = 0.15;
const MIN_TITLE_WORDS = 2;

type Box = { from: number; to: number; fromY: number; toY: number };
type Text = { str: string; x: number; y: number; width: number; height: number };

/** Distinct title words in the given texts. */
const titleWordCount = (texts: readonly Text[]): number => {
  const found = new Set<string>();
  for (const t of texts) for (const m of t.str.toUpperCase().matchAll(TITLE_WORDS)) found.add(m[1]);
  return found.size;
};

/** A view caption inside the region — large text naming a PLAN — says this is a drawing, not a title block. */
const holdsPlanCaption = (texts: readonly Text[]): boolean => {
  const heights = texts.map((t) => t.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 0;
  return texts.some((t) => /\bPLAN\b/i.test(t.str) && t.height >= 1.3 * median);
};

/**
 * Title-block regions in page-width units: at most one right strip and one bottom band.
 * `segments` and `textItems` are in page points; the page height is taken from the drawn extent.
 */
export function titleBlockRegions(
  segments: readonly StrokeSegment[],
  textItems: readonly Text[],
  widthPt: number,
): Box[] {
  if (segments.length === 0 || !(widthPt > 0)) return [];
  const H = segments.reduce((m, s) => Math.max(m, s.y1, s.y2), 0) / widthPt;
  const texts = textItems.map((t) => ({ ...t, ux: t.x / widthPt, uy: t.y / widthPt }));
  const out: Box[] = [];

  // The right strip: leftmost qualifying full-height vertical rule.
  const verticals = segments
    .filter((s) => Math.abs(s.x2 - s.x1) / widthPt < 0.002 && Math.abs(s.y2 - s.y1) / widthPt >= SPAN_SHARE * H)
    .map((s) => (s.x1 + s.x2) / 2 / widthPt)
    .filter((x) => x >= RIGHT_QUARTER)
    .sort((a, b) => a - b);
  for (const x of verticals) {
    const right = texts.filter((t) => t.ux >= x);
    if (titleWordCount(right) >= MIN_TITLE_WORDS && !holdsPlanCaption(right)) {
      out.push({ from: x, to: 1, fromY: 0, toY: H });
      break;
    }
  }

  // The bottom band: the HIGHEST qualifying full-width rule in the bottom 15%, so the band is
  // maximal — an internal divider lower down would under-cover it.
  const horizontals = segments
    .filter((s) => Math.abs(s.y2 - s.y1) / widthPt < 0.002 && Math.abs(s.x2 - s.x1) / widthPt >= SPAN_SHARE)
    .map((s) => (s.y1 + s.y2) / 2 / widthPt)
    .filter((y) => y >= (1 - BOTTOM_BAND) * H)
    .sort((a, b) => a - b);
  for (const y of horizontals) {
    const below = texts.filter((t) => t.uy >= y);
    if (titleWordCount(below) >= MIN_TITLE_WORDS && !holdsPlanCaption(below)) {
      out.push({ from: 0, to: 1, fromY: y, toY: H });
      break;
    }
  }
  return out;
}

/** Both endpoints inside one of the boxes (page-width units). */
export function insideBoxes(boxes: readonly Box[], x1: number, y1: number, x2: number, y2: number): boolean {
  const inb = (b: Box, x: number, y: number) => x >= b.from && x <= b.to && y >= b.fromY && y <= b.toY;
  return boxes.some((b) => inb(b, x1, y1) && inb(b, x2, y2));
}
