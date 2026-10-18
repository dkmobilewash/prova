import { ARCHITECTURAL_SCALES } from "./scaleFromDimensions";

/**
 * THE SCALE THE ARCHITECT PRINTED, turned into a calibration WITHOUT INVENTING A
 * DIMENSION — and a fallback only, never a first choice.
 *
 * ── WHY THIS EXISTS, SINCE #623 DECLINED IT ──
 *
 * That PR's reasoning stands and is worth restating rather than waved past: a
 * printed scale *"implies a factor and not a dimension"*, and a calibration *"is
 * the line somebody drew… so the printed scale cannot become one without
 * inventing a second calibration mechanism with different evidence behind it."*
 * The safety of that is real. Every scale `scaleFromDimensions` produces traces
 * to a figure printed on the drawing, drawn back over the dimension it came
 * from, so a wrong one is visible in two seconds.
 *
 * What changed is a measurement, not an opinion. A real 76-page bid set:
 * automatic scale reads **9** of ~30 drywall-relevant sheets from their
 * dimensions. **Sixteen more print their scale** and fail only because no
 * dimension on them can be read — six have their lettering saved as line work,
 * ten have dimensions that scatter past the vote's margin. Three geometry fixes
 * were built and measured at zero or worse; the tables are in
 * `scaleFromDimensions.ts` so nobody re-runs them. Diego's call, 2026-10-07: use
 * the printed scale, clearly marked unverified.
 *
 * ── AND IT INVENTS NO DIMENSION, WHICH IS WHAT KEEPS #623's RULE INTACT ──
 *
 * The temptation is to store a factor, or to pick a line and compute what it
 * "should" measure. Both put a number into `declaredDistanceFeet` that no
 * drawing states, which is exactly the mechanism that was declined.
 *
 * Instead the line is **the sheet's own width** and the distance is **what the
 * printed scale says that width is**. The page is 42 inches across and says
 * 1 inch = 8 feet, so it spans 336 feet. Two facts about the file, multiplied.
 * Nothing is read off a dimension that is not there.
 *
 * Verified to read back exactly at every architectural scale — 336ft over a
 * 3024pt page gives `feetPerPageWidth` 336, which `readScale` turns back into
 * 1in = 8.0000ft and names `1/8" = 1'-0"`. And at a span of 1.0 of the page it
 * is the LONGEST line available, so `MIN_CALIBRATION_SPAN` is untroubled and the
 * geometry is the least error-prone there is.
 *
 * ── THE COST, STATED RATHER THAN BURIED ──
 *
 * It depends on `pageWidthPt`, whose own comment calls it "A LABEL INPUT AND
 * NOTHING ELSE" — this makes a wall's length depend on it, which that comment
 * was written to prevent. A missing page width therefore declines rather than
 * guessing.
 *
 * And there is **nothing to look at**. An estimator cannot check a printed scale
 * against the drawing the way they can check a line sitting on `16' - 4 1/2"`.
 * So `source` records where the reading came from, the screen says it is
 * unconfirmed, and it is never applied silently. That is the whole trade and it
 * is the estimator's to accept.
 */

/** A printed scale, ready to store as a calibration. */
export type PrintedScaleReading = {
  /** The winning scale's name, as `ARCHITECTURAL_SCALES` spells it. */
  scaleName: string;
  /** The line: the sheet's full width, in page-width units — `sheet-geometry.ts`'s
   *  box, where x runs 0..1 and y is over that same width. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** What the printed scale says the sheet's width is, in feet. */
  declaredDistanceFeet: number;
  /** The characters the architect printed, so the screen can quote them. */
  declaredText: string;
};

/**
 * How far from a standard sheet size a page may be and still be trusted to be
 * printed at full size.
 *
 * THE HAZARD THIS GUARDS, and it is the one a printed scale cannot see for
 * itself: a 1/8" sheet printed at HALF SIZE still says `1/8" = 1'-0"` in its
 * title block, and every quantity taken from it would be half. A dimension-based
 * reading is immune — the dimension and the line shrink together, so the
 * derived scale comes out as the honest 1/16". A printed one is not, because the
 * characters do not shrink.
 *
 * The giveaway is the page: 42x30 is ARCH E1, and half of it is 21x15, which is
 * no standard sheet size at all. So a page that is not a standard size declines.
 * 0.02 is two percent, which admits a printer's margin and nothing like a 50%
 * reduction.
 */
const SHEET_SIZE_TOLERANCE = 0.02;

/**
 * The sheet sizes a construction drawing is printed at, in inches, long edge
 * first. ARCH A-E1 and ANSI A-E, which between them cover what a GC issues.
 */
const STANDARD_SHEETS: { long: number; short: number; name: string }[] = [
  { long: 12, short: 9, name: "ARCH A" },
  { long: 18, short: 12, name: "ARCH B" },
  { long: 24, short: 18, name: "ARCH C" },
  { long: 36, short: 24, name: "ARCH D" },
  { long: 48, short: 36, name: "ARCH E" },
  { long: 42, short: 30, name: "ARCH E1" },
  { long: 11, short: 8.5, name: "ANSI A" },
  { long: 17, short: 11, name: "ANSI B" },
  { long: 22, short: 17, name: "ANSI C" },
  { long: 34, short: 22, name: "ANSI D" },
  { long: 44, short: 34, name: "ANSI E" },
];

/** The standard sheet size this page is, or null if it is not one. */
export function standardSheetSize(widthPt: number, heightPt: number): string | null {
  if (!(widthPt > 0) || !(heightPt > 0)) return null;
  const long = Math.max(widthPt, heightPt) / 72;
  const short = Math.min(widthPt, heightPt) / 72;
  for (const sheet of STANDARD_SHEETS) {
    const longOff = Math.abs(long - sheet.long) / sheet.long;
    const shortOff = Math.abs(short - sheet.short) / sheet.short;
    if (longOff <= SHEET_SIZE_TOLERANCE && shortOff <= SHEET_SIZE_TOLERANCE) return sheet.name;
  }
  return null;
}

/**
 * A calibration from the scale printed on the sheet, or null with nothing
 * guessed.
 *
 * Declines when: no single scale is printed (none, or several — a sheet carrying
 * a plan and a detail has no one answer and #640 already warns about those); the
 * name is not a standard architectural scale; the page size is missing or is not
 * a standard sheet; or the arithmetic does not come out finite.
 */
export function scaleFromPrinted(
  printed: readonly string[],
  widthPt: number | null,
  heightPt: number | null,
): PrintedScaleReading | null {
  if (printed.length !== 1) return null;
  const name = printed[0];
  const scale = ARCHITECTURAL_SCALES.find((candidate) => candidate.name === name);
  if (scale === undefined) return null;
  if (widthPt === null || heightPt === null) return null;
  if (standardSheetSize(widthPt, heightPt) === null) return null;

  const paperInches = widthPt / 72;
  const across = paperInches * scale.feetPerInch;
  if (!Number.isFinite(across) || across <= 0) return null;

  return {
    scaleName: name,
    // The sheet's full width, at mid-height. In page-width units both axes are
    // over the WIDTH, so y = (heightPt / widthPt) / 2 is the middle of the page.
    x1: 0,
    y1: heightPt / widthPt / 2,
    x2: 1,
    y2: heightPt / widthPt / 2,
    declaredDistanceFeet: across,
    declaredText: name,
  };
}
