import { duplicatePairs } from "./duplicateCandidates";
import type { WallCandidate } from "./wallVectors";

/**
 * ── ON A SCAN, THE LETTERS ARE LINES TOO ──
 *
 * A vector sheet keeps its words in a text layer and the finder never sees
 * them as strokes. A scan has no such layer: the raster stage reads ink
 * bands off the bitmap and a room tag's digits are ink — the uprights of a
 * "1" and an "8" are a pair of short parallel lines, which is what a wall
 * looks like. Chrome's Evergreen round named two offered as walls (A242B's
 * "318", A244A #215).
 *
 * The stage also OCRs the sheet, and OCR says where the words are. A run
 * whose middle sits inside an OCR word's box, and that is NO LONGER THAN THE
 * WORD'S GLYPHS ARE TALL, is a letter stroke: nothing drawn as lettering can
 * be longer than its own glyph height, and a wall under a tag is longer.
 *
 * ── WHY THE GLYPH HEIGHT AND NOT THE BOX, MEASURED ──
 *
 * Tesseract returns LINE boxes, and on a drawing a "line" is whatever it
 * found across a horizontal band: on six training sheets rasterised at
 * 200 dpi the median box it drew was 6 INCHES wide, reading "| | | |",
 * "HALLWAY | HE" — wall fragments as glyphs. A first version of this rule
 * admitted a run up to 1.5× the box's long side, and over those six sheets it
 * set aside 2,888 ft of REAL wall against 2,271 ft of junk (Joplin A-101
 * alone: 749 ft real). The same sheets with the glyph-height bound and a
 * text-like filter: 0 ft real, 0 ft junk — the kind simply does not occur at
 * the sizes those sheets draw tags, and the rule costs nothing where it has
 * nothing to do. Numbers in NOTES-scanned.md, "Training scans".
 *
 * ── WHAT THAT MEASUREMENT CORRECTED ──
 *
 * Against the sheets' own text layers, the runs truly sitting on words were
 * 72 ft of 4,191 ft of scan junk, nearly all title lettering a third of an
 * inch tall that OCR did not read at all. So this rule is the guard Chrome's
 * two sightings asked for, and it fires on none of the six training sheets.
 *
 * A text-like word: at least two non-space characters, letters and digits
 * and the punctuation a tag or a dimension carries, half of them
 * alphanumeric (a dimension is half punctuation: `12'-6"`), no bar characters (a "|" is a wall read as a glyph), no
 * taller than a room title, and no wider per character than a glyph can be.
 * Only OCR words count (`confidence` is set), so a vector sheet's text layer
 * is not read by this rule and the vector finder is byte-identical.
 */

export type OcrWord = { str: string; x: number; y: number; width: number; height: number; confidence?: number };

/** OCR words this rule trusts: below this the box is as likely noise as a word. */
export const WORD_CONFIDENCE = 50;
/** A letter stroke is at most this many glyph heights long (an ascender is the height; a little slack for the box). */
export const GLYPH_LENGTH_RATIO = 1.3;
/** A word box taller than this, in inches, is a title or a misread band, not a tag. */
export const WORD_MAX_HEIGHT_IN = 0.4;
/** A word box wider per character than this many glyph heights is a band, not lettering. */
export const WORD_MAX_ADVANCE = 1.2;
/** The box grows by this share of its own size on each side; OCR boxes are tight. */
export const WORD_SLACK = 0.1;

const TEXT_LIKE = /^[A-Za-z0-9'"\-./#&(),:+ ]+$/;

/** Whether an OCR line box is a word a drafter wrote, as opposed to a band of drawing read as glyphs. */
export function textLikeWord(t: OcrWord): boolean {
  const s = t.str.trim();
  const n = s.replace(/ /g, "").length;
  if (n < 2 || !TEXT_LIKE.test(s)) return false;
  let alnum = 0;
  for (const c of s) if (/[A-Za-z0-9]/.test(c)) alnum += 1;
  if (alnum < 0.5 * n) return false;
  const hIn = t.height / 72, wIn = t.width / 72;
  if (hIn > WORD_MAX_HEIGHT_IN) return false;
  return wIn / s.length <= WORD_MAX_ADVANCE * hIn;
}

/** The runs that are letter strokes of OCR words, with the word each one is. Empty when the sheet carries no OCR words. */
export function runsInOcrWords(
  walls: readonly WallCandidate[],
  textItems: readonly OcrWord[],
  widthPt: number,
): Map<WallCandidate, string> {
  const out = new Map<WallCandidate, string>();
  if (!(widthPt > 0)) return out;
  // Words in page-width units, y DOWN with the OCR box's top at `y - height`
  // (the raster stage reports the baseline, as the text layer does).
  const words = textItems
    .filter((t) => t.confidence !== undefined && t.confidence >= WORD_CONFIDENCE && textLikeWord(t))
    .map((t) => {
      const w = t.width / widthPt, h = t.height / widthPt;
      return { str: t.str.trim(), x0: t.x / widthPt - w * WORD_SLACK, x1: (t.x + t.width) / widthPt + w * WORD_SLACK, y0: (t.y - t.height) / widthPt - h * WORD_SLACK, y1: t.y / widthPt + h * WORD_SLACK, h };
    });
  if (words.length === 0) return out;
  for (const wall of walls) {
    const mx = (wall.x1 + wall.x2) / 2, my = (wall.y1 + wall.y2) / 2;
    const span = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
    const hit = words.find((w) => mx >= w.x0 && mx <= w.x1 && my >= w.y0 && my <= w.y1 && span <= GLYPH_LENGTH_RATIO * w.h);
    if (hit) out.set(wall, hit.str);
  }
  return out;
}

/** Runs starting this far across the sheet are in the title block: 360 ft junk, 9 ft real on six training scans. */
// ponytail: a fixed strip assumes a right-hand title block; read the block's own border if a bottom-titled scan appears.
export const TITLE_STRIP_FROM = 0.89;

/**
 * What only a scan needs after every other rule: the title-block strip, which
 * a sheet with no kept view is otherwise measured across, and one wall read
 * twice, which bands of a blurred line produce and a vector stroke cannot.
 */
export function scanOnlyAsides(runs: readonly WallCandidate[], feetPerUnit: number) {
  const titleStrip = runs.filter((w) => Math.min(w.x1, w.x2) >= TITLE_STRIP_FROM);
  const rest = runs.filter((w) => Math.min(w.x1, w.x2) < TITLE_STRIP_FROM);
  const asCandidates = rest.map((w, i) => ({ id: String(i), x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, lengthFeet: w.lengthFeet, thicknessIn: w.thicknessFeet * 12, from: "pair" as const, note: "" }));
  const drop = new Set(duplicatePairs(asCandidates, feetPerUnit).map((p) => Number(p.drop)));
  return { kept: rest.filter((_, i) => !drop.has(i)), titleStrip, twins: rest.filter((_, i) => drop.has(i)) };
}

/** The panel's sentence for the set-aside. */
export function ocrWordsSentence(words: readonly string[]): string {
  const sample = [...new Set(words)].slice(0, 3).map((w) => `"${w}"`).join(", ");
  return `lettering the scan's OCR read as words (${sample}${words.length > 3 ? ", …" : ""}) — a tag or a dimension, not a wall`;
}
