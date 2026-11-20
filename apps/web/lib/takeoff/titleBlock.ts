import type { StrokeSegment } from "./wallVectors";

/**
 * ── THE ANNOTATION SIDE OF A SHEET, READ OFF ITS OWN RULED BOUNDARY (prereg-not-drawing-v2.md) ──
 *
 * The scan path has had a title-strip aside since its six-training-scan measurement (360 ft junk,
 * 9 ft real) — but as a FIXED x >= 0.89, scan-only, with its own note asking for the block's border
 * to be read instead. This reads it, amendment 1's way: the boundary is the leftmost CHAINED
 * vertical — collinear pieces at one x whose gaps are small and whose combined span covers most of
 * the page height — with at least two distinct STRONG title words to its right. Stacked panel
 * borders (notes, keynotes, legend frames sharing one x) chain into one boundary, which is how Old
 * Town Hall draws it; Jane Hahan's and Singh's single full-height divider is a chain of one. SCALE
 * and DATE are deliberately not title words — they appear beside drawings; two of
 * DRAWN/CHECKED/SHEET/PROJECT/REVISION never do.
 */
const TITLE_WORDS = /\b(DRAWN|CHECKED|SHEET|PROJECT|REVISIONS?|JOB|ISSUED?|SEAL|ARCHITECTS?)\b/gi;
const SPAN_SHARE = 0.85;
const BOUNDARY_FROM_X = 0.7;
const BOTTOM_BAND = 0.15;
const MIN_TITLE_WORDS = 2;
const SAME_LINE = 0.002;
const CHAIN_GAP_SHARE = 0.02;

type Box = { from: number; to: number; fromY: number; toY: number };
type Text = { str: string; x: number; y: number; width: number; height: number };

/** Distinct title words in the given texts. */
const titleWordCount = (texts: readonly Text[]): number => {
  const found = new Set<string>();
  for (const t of texts) for (const m of t.str.toUpperCase().matchAll(TITLE_WORDS)) found.add(m[1].replace(/S$|D$/, ""));
  return found.size;
};

/** Collinear pieces at one coordinate chained over small gaps; the combined covered span. */
const chainedSpan = (pieces: readonly { at: number; lo: number; hi: number }[], gap: number): Map<number, number> => {
  const byAt = new Map<number, { lo: number; hi: number }[]>();
  for (const p of pieces) {
    const key = [...byAt.keys()].find((k) => Math.abs(k - p.at) <= SAME_LINE) ?? p.at;
    const list = byAt.get(key) ?? [];
    list.push(p);
    byAt.set(key, list);
  }
  const spans = new Map<number, number>();
  for (const [at, list] of byAt) {
    list.sort((a, b) => a.lo - b.lo);
    let covered = 0, lo = list[0].lo, hi = list[0].hi;
    for (const p of list.slice(1)) {
      if (p.lo <= hi + gap) hi = Math.max(hi, p.hi);
      else { covered += hi - lo; lo = p.lo; hi = p.hi; }
    }
    covered += hi - lo;
    spans.set(at, covered);
  }
  return spans;
};

/**
 * Title-block / annotation regions in page-width units: at most one right strip and one bottom
 * band. `segments` and `textItems` are in page points; the page height comes from the drawn extent.
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

  // The right strip: the leftmost chained full-height boundary with title words beyond it.
  const verticals = segments
    .filter((s) => Math.abs(s.x2 - s.x1) / widthPt < SAME_LINE)
    .map((s) => ({ at: (s.x1 + s.x2) / 2 / widthPt, lo: Math.min(s.y1, s.y2) / widthPt, hi: Math.max(s.y1, s.y2) / widthPt }))
    .filter((p) => p.at >= BOUNDARY_FROM_X);
  const vSpans = [...chainedSpan(verticals, CHAIN_GAP_SHARE * H)].filter(([, span]) => span >= SPAN_SHARE * H).map(([at]) => at).sort((a, b) => a - b);
  for (const x of vSpans) {
    if (titleWordCount(texts.filter((t) => t.ux >= x)) >= MIN_TITLE_WORDS) {
      out.push({ from: x, to: 1, fromY: 0, toY: H });
      break;
    }
  }

  // The bottom band: the highest chained full-width boundary in the bottom 15% with title words
  // below it, so the band is maximal.
  const horizontals = segments
    .filter((s) => Math.abs(s.y2 - s.y1) / widthPt < SAME_LINE)
    .map((s) => ({ at: (s.y1 + s.y2) / 2 / widthPt, lo: Math.min(s.x1, s.x2) / widthPt, hi: Math.max(s.x1, s.x2) / widthPt }))
    .filter((p) => p.at >= (1 - BOTTOM_BAND) * H);
  const hSpans = [...chainedSpan(horizontals, CHAIN_GAP_SHARE)].filter(([, span]) => span >= SPAN_SHARE).map(([at]) => at).sort((a, b) => a - b);
  for (const y of hSpans) {
    if (titleWordCount(texts.filter((t) => t.uy >= y)) >= MIN_TITLE_WORDS) {
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
