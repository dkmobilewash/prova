import { describe, expect, it } from "vitest";
import { reducedPrint, setSheetWidth, printedScaleForSheet } from "./reducedPrint";

/**
 * THE PAGE THIS EXISTS FOR, IN THE NUMBERS IT WAS MEASURED WITH.
 *
 * School answer key, three half-size prints of an ARCH D original, divided by
 * whether the dimension path happened to work:
 *
 *   p11: 18in, 20 labels, dimensions 16.00 ft/in -> app uses 16.00, key 66%
 *   p17: 18in, 32 labels, dimensions 16.00 ft/in -> app uses 16.00, key 66%
 *   p50: 18in,  0 labels, dimensions DECLINED    -> app uses 8.00 FROM THE NAME,
 *                                                   key 32% — worst of 60 pages
 *
 * The set is issued at 2592pt (ARCH D, 36in) and the three reduced pages are
 * 1296pt (18in). Those are the numbers in the fixtures below.
 *
 * Two detectors were measured and scored identically — page width, and the
 * title-block lettering, which was 30.0pt on every full-size page and 15.0pt on
 * all three reduced ones. Width is used because it is already stored. See the
 * module header.
 */

/** The key's own measurements. */
const SET_PT = 2592;
const REDUCED_PT = 1296;
/** 1/8" = 1'-0" as the title block prints it, and the 1/16" it really is. */
const PRINTED = 8;
const REAL = 16;

describe("spotting a reduced print", () => {
  it("CATCHES THE HALF-SIZE PAGE, at the measured heights", () => {
    expect(reducedPrint(REDUCED_PT, SET_PT).factor).toBe(2);
  });

  it("LEAVES A FULL-SIZE PAGE ALONE", () => {
    expect(reducedPrint(SET_PT, SET_PT).factor).toBe(1);
  });

  it("catches a quarter-size print", () => {
    expect(reducedPrint(SET_PT / 4, SET_PT).factor).toBe(4);
  });

  it("REFUSES A RATIO THAT IS NOT A WHOLE REDUCTION", () => {
    // The case that keeps this honest: a sheet whose lettering is merely
    // smallish is not a reduction of anything. Nothing between the factors is
    // accepted and rounded.
    expect(reducedPrint(SET_PT / 1.5, SET_PT).factor).toBe(1);
    expect(reducedPrint(SET_PT / 3, SET_PT).factor).toBe(1);
    expect(reducedPrint(SET_PT / 2.4, SET_PT).factor).toBe(1);
  });

  it("absorbs the rounding in a reported page box but not more", () => {
    expect(reducedPrint(1295.4, 2592).factor).toBe(2);
    expect(reducedPrint(1420, 2592).factor).toBe(1);
  });

  it("never treats a LARGER sheet as a reduction", () => {
    // Enlargements are not a thing anyone issues, and admitting them would
    // double what this has to tell apart.
    expect(reducedPrint(SET_PT * 2, SET_PT).factor).toBe(1);
  });

  it("LEAVES THE REAL CORPUS ALONE — eight sets, 513 pages, zero flags", () => {
    // Every set in the measured corpus is uniform, so no page of it is a clean
    // fraction of its own set. These are the two real widths.
    for (const set of [2592, 3024]) {
      expect(reducedPrint(set, set).factor).toBe(1);
    }
    // And the one mixed set, which is the only source of true positives.
    expect(reducedPrint(2592, 2592).factor).toBe(1);
    expect(reducedPrint(1296, 2592).factor).toBe(2);
  });

  it("says factor 1 rather than throwing on a missing measurement", () => {
    expect(reducedPrint(0, SET_PT).factor).toBe(1);
    expect(reducedPrint(REDUCED_PT, 0).factor).toBe(1);
  });
});

describe("the size the set is issued at", () => {
  it("takes the MODAL width, not the biggest", () => {
    // The whole reason for the mode: one oversized sheet in a set would
    // otherwise make every real sheet read as a reduction of it.
    expect(setSheetWidth([3456, 2592, 2592, 2592, 2592, 1296, 1296])).toBe(2592);
  });

  it("is unmoved by a handful of odd sheets", () => {
    expect(setSheetWidth([2592, 2592, 2592, 2592, 2592, 612, 3024, 792])).toBe(2592);
  });

  it("buckets widths that are the same sheet", () => {
    expect(setSheetWidth([2591.6, 2592.0, 2592.4, 1296])).toBe(2592);
  });

  it("PREFERS THE LARGER SIZE ON A TIE, because a reduction is done to an original", () => {
    expect(setSheetWidth([2592, 2592, 1296, 1296])).toBe(2592);
  });

  it("matches the corpus: the real sets measure 2592 and 3024", () => {
    // Five sets in the measured corpus are ARCH D (2592pt) and four are 3024pt.
    expect(setSheetWidth([2592, 2592, 2592, 1296])).toBe(2592);
    expect(setSheetWidth([3024, 3024, 3024])).toBe(3024);
  });

  it("returns 0 for nothing to measure", () => {
    expect(setSheetWidth([])).toBe(0);
    expect(setSheetWidth([0, -1])).toBe(0);
  });
});

describe("correcting the printed scale", () => {
  it("CORRECTS p50 TO WHAT ITS SISTER PAGES MEASURE", () => {
    // The assertion that matters: p11 and p17 measure 16.00 from their own
    // dimensions, and this reaches the same answer on a page with no dimensions
    // at all, from the lettering alone.
    const result = printedScaleForSheet(PRINTED, reducedPrint(REDUCED_PT, SET_PT));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feetPerInch).toBe(REAL);
    expect(result.scaleName).toBe('1/16" = 1\'-0"');
    expect(result.corrected).toBe(true);
  });

  it("says plainly on screen that it corrected, and why", () => {
    const result = printedScaleForSheet(PRINTED, reducedPrint(REDUCED_PT, SET_PT));
    expect(result.ok && result.corrected && result.caution).toMatch(/half-size print/i);
    expect(result.ok && result.corrected && result.caution).toContain("18in");
    expect(result.ok && result.corrected && result.caution).toContain("36in");
    // It must say what goes wrong if it is ignored, not just what it did.
    expect(result.ok && result.corrected && result.caution).toMatch(/half\b/i);
  });

  it("leaves a full-size sheet's printed scale exactly as it is", () => {
    const result = printedScaleForSheet(PRINTED, reducedPrint(SET_PT, SET_PT));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feetPerInch).toBe(PRINTED);
    expect(result.corrected).toBe(false);
  });

  it("DECLINES when the correction lands on no standard scale", () => {
    // Both readings cannot be right, so neither is offered. 1/32in = 1'-0" is
    // the coarsest architectural scale, so doubling it leaves the list.
    const result = printedScaleForSheet(32, reducedPrint(REDUCED_PT, SET_PT));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not a standard\s+one/i);
    expect(result.reason).toMatch(/clicking a known distance/i);
  });

  it("declines a printed scale that is not a distance at all", () => {
    expect(printedScaleForSheet(0, reducedPrint(SET_PT, SET_PT)).ok).toBe(false);
  });

  it("corrects a quarter-size print the same way", () => {
    // 1/4in = 1'-0" printed at quarter size is 1in = 1'-0"... which is 1 ft per
    // inch, a real scale. 4 ft/in x 4 = 16, which is also real.
    const result = printedScaleForSheet(4, reducedPrint(SET_PT / 4, SET_PT));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feetPerInch).toBe(16);
  });
});
