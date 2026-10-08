import { parseFeetInches } from "../feet-inches";
import type { DimensionLabel } from "../takeoff/scaleFromDimensions";
import { TITLE_BLOCK_RIGHT_FRACTION, TITLE_BLOCK_BOTTOM_FRACTION, type PlanPageText } from "./planPdf";

/**
 * THE DIMENSIONS AN ARCHITECT PRINTED ON THE DRAWING — `11' - 0"`, `15' - 3 7/16"`.
 *
 * `scaleFromDimensions.ts` turns these plus the sheet's own stroked lines into
 * the scale. This file's only job is finding them in the text layer, and the
 * two failures worth knowing about are both about what it MISSES rather than
 * what it gets wrong.
 *
 * ── A FIRST PASS FOUND 13 OF ~32, AND THE MISSING ONES WERE ALL FRACTIONS ──
 *
 * Measured on a real ARCH E1 export. A pattern requiring the whole string to be
 * `\d+'\s*-?\s*\d*"?` matched `11' - 0"` and silently skipped
 * `15' - 3 7/16"`, `8' - 7 3/4"` and `16' - 9 3/8"` — which are the LONGEST
 * dimensions on the sheet and therefore the most useful ones, since a longer
 * line carries less relative error.
 *
 * So the parse is delegated to `parseFeetInches`, which already handles
 * fractions, already rejects 18 inches in the inches slot as a typo for 1'-6",
 * and is the same parser the estimator's own typing goes through. Two parsers
 * for one notation is the defect this repo writes censuses to catch.
 *
 * ── THE SECOND MISS IS pdfjs SPLITTING STRINGS, AND IT IS NOT HANDLED HERE ──
 *
 * `scheduleTable.ts` records it in its own header: *"pdfjs reports "101",
 * "3'-0"", "7'-0"", "HM", "A" as five unrelated items that happen to share a
 * y."* So a dimension lettered as two items — `11'` and `- 0"` — is invisible to
 * this file.
 *
 * That is a KNOWN GAP rather than an oversight, and the reason it is acceptable
 * is that this reader does not need every dimension: it needs enough that agree.
 * The real sheet gave ~32 from whole items alone, where three are enough. If a
 * sheet ever declines for want of dimensions, recombining by position is the
 * first thing to try — `scheduleTable.ts`'s `ROW_TOLERANCE` and
 * `CELL_GAP_CHARS` are the prior art, tuned so `3'-0" x 7'-0"` stays one cell.
 */

/**
 * Looks like a dimension and nothing else.
 *
 * Anchored at both ends on purpose: `18" CLEAR` and
 * `18" DEEP ADJUSTABLE SHELVING ON STANDARDS.` are both on the real sheet, and
 * both are notes rather than dimensions. A note's figure is not beside a
 * dimension line, so an unanchored pattern would feed the vote strings whose
 * length means nothing.
 *
 * Feet are REQUIRED — a bare `18"` is admitted by `parseFeetInches` as a foot
 * and a half, but on a drawing it is almost always a note or a clearance call.
 * Dimensions under a foot carry too little length to be worth the risk.
 *
 * ── THE ANCHORING IS DEFENCE IN DEPTH AND NOT THE LOAD-BEARING GUARD, which a
 * mutation established rather than inspection ──
 *
 * Replacing this whole pattern with a bare `/\d{1,3}'/` leaves the suite GREEN.
 * Every string that then slips through — `3'-0" x 7'-0"` from a door schedule
 * (the example `scheduleTable.ts` quotes), `8' - 0" A.F.F.`, `9' - 0" CEILING
 * HEIGHT TYP.` — is rejected one line below by `parseFeetInches`, which will not
 * read `0 A.F.F.` as inches.
 *
 * So the real gate is the parser, and the anchoring only makes the intent
 * legible and saves a parse. That is worth knowing before anyone "simplifies"
 * either one: loosening the PARSER is what would actually let notes into the
 * vote, and there is no test here that would catch it, because this file's tests
 * can only prove what comes out.
 */
const DIMENSION = /^\d{1,3}'\s*-?\s*(?:\d{1,2}(?:\s+\d{1,2}\/\d{1,2})?\s*"?)?$/;

/** Longer than any room on a sheet: a figure this big is a note or a parse
 *  accident rather than a dimension somebody drew a line for. */
const MAX_PLAUSIBLE_FEET = 400;

/**
 * ── BARE FEET ARE OFTEN ELEVATIONS, AND REQUIRING THE INCHES CHANGES NOTHING.
 * MEASURED. DO NOT SPEND AN AFTERNOON HERE. ──
 *
 * Two sheets of a real bid set found 28 and 18 "dimensions" and still declined,
 * which looked like the vote failing. It was not. Their labels were
 * `100'  113'  121'  111'`, each repeated three or four times — **spot
 * ELEVATIONS above datum**, not lengths of anything, and not beside a dimension
 * line at all. So pairing them produces noise, and the one sheet whose labels
 * were ALL of that form correctly reported that nothing matched a standard
 * scale.
 *
 * A real dimension on these sheets is written `8'-0"` — an architect states the
 * inches even when they are zero — so making the inches REQUIRED would drop the
 * elevations and keep the dimensions. That was tried, on all 78 real pages
 * available:
 *
 *   | pattern                     | bid set | SCHD | Augusta |
 *   | --------------------------- | ------- | ---- | ------- |
 *   | inches optional — what ships| 9 read  | 1/8" | 1/4"    |
 *   | inches REQUIRED             | 9 read  | 1/8" | 1/4"    |
 *
 * Byte-identical. The elevations were never what stopped those two sheets: one
 * has three real dimensions and three cannot outvote anything, and the other has
 * none at all once they are excluded. So the diagnosis is right and it is not a
 * lever, and the change was reverted rather than kept for tidiness — `2'` does
 * appear as a genuine dimension on detail sheets, so requiring inches would cost
 * something eventually for a gain measured at zero.
 */

/**
 * Every printed dimension on a page, positioned in the same points
 * `sheetStrokes.ts` reports — which is the only reason the two can be compared.
 *
 * THE TITLE BLOCK IS EXCLUDED, and not as housekeeping: its own corner carries
 * the scale NAME, revision dates and sheet numbers, and a figure there sits
 * beside a ruled box rather than a dimension line. Reuses the region constants
 * from `planPdf.ts` rather than a second opinion about where a title block is.
 */
export function dimensionLabels(page: PlanPageText): DimensionLabel[] {
  const titleFromX = page.widthPt * TITLE_BLOCK_RIGHT_FRACTION;
  const titleFromY = page.heightPt * TITLE_BLOCK_BOTTOM_FRACTION;

  const out: DimensionLabel[] = [];
  for (const item of page.items) {
    const text = item.str.trim();
    if (!DIMENSION.test(text)) continue;
    if (item.x >= titleFromX && item.y >= titleFromY) continue;

    const parsed = parseFeetInches(text, { label: "A printed dimension", min: 0.5 });
    if (!parsed.ok) continue;
    if (parsed.n > MAX_PLAUSIBLE_FEET) continue;

    // The label's own centre, so distance to a dimension line is measured from
    // the middle of the lettering rather than its left edge.
    out.push({ text, feet: parsed.n, x: item.x + item.width / 2, y: item.y });
  }
  return out;
}
