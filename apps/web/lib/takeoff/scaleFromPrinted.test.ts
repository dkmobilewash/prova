import { describe, expect, it } from "vitest";
import { scaleFromPrinted, standardSheetSize } from "./scaleFromPrinted";
import { ARCHITECTURAL_SCALES } from "./scaleFromDimensions";
import { readScale, type StoredCalibration } from "../takeoff-plan";

/**
 * Turning the scale an architect printed into a calibration, without inventing a
 * dimension.
 *
 * The property that matters most is the round trip: a calibration stored this
 * way must read BACK as the scale that was printed. If it does not, the sheet
 * would say one thing and every quantity taken off it would mean another, which
 * is the failure the whole feature exists to avoid.
 */

const ARCH_E1 = { widthPt: 42 * 72, heightPt: 30 * 72 };
const ARCH_D = { widthPt: 36 * 72, heightPt: 24 * 72 };

describe("the round trip, at every architectural scale", () => {
  for (const scale of ARCHITECTURAL_SCALES) {
    it(`${scale.name} stores and reads back as itself`, () => {
      const reading = scaleFromPrinted([scale.name], ARCH_E1.widthPt, ARCH_E1.heightPt);
      expect(reading, `${scale.name} declined`).not.toBeNull();
      if (reading === null) return;

      // Through the app's own reader, on the app's own calibration shape — not a
      // re-derivation here, because a test that recomputes what the code
      // computed proves only that both used the same formula.
      const calibration: StoredCalibration = {
        x1: reading.x1,
        y1: reading.y1,
        x2: reading.x2,
        y2: reading.y2,
        declaredDistanceFeet: reading.declaredDistanceFeet,
      };
      const read = readScale(calibration, ARCH_E1.widthPt);
      expect(read).not.toBeNull();
      expect(read?.name).toBe(scale.name);
      expect(read?.feetPerInch).toBeCloseTo(scale.feetPerInch, 6);
    });
  }

  it("reads back on a DIFFERENT sheet size too, since the maths uses the page", () => {
    const reading = scaleFromPrinted(['1/8" = 1\'-0"'], ARCH_D.widthPt, ARCH_D.heightPt);
    expect(reading).not.toBeNull();
    if (reading === null) return;
    // 36in at 8ft/in is 288ft, not the 336 an ARCH E1 spans.
    expect(reading.declaredDistanceFeet).toBeCloseTo(288, 6);
    const read = readScale(
      { x1: reading.x1, y1: reading.y1, x2: reading.x2, y2: reading.y2, declaredDistanceFeet: reading.declaredDistanceFeet },
      ARCH_D.widthPt,
    );
    expect(read?.name).toBe('1/8" = 1\'-0"');
  });
});

describe("the line it proposes", () => {
  it("IS THE SHEET'S FULL WIDTH, which is the longest line available", () => {
    const reading = scaleFromPrinted(['1/4" = 1\'-0"'], ARCH_E1.widthPt, ARCH_E1.heightPt)!;
    expect(reading.x1).toBe(0);
    expect(reading.x2).toBe(1);
    // A span of 1.0 against `MIN_CALIBRATION_SPAN`'s 0.05 floor: the geometry is
    // the least error-prone there is, which is the one advantage this path has
    // over a dimension read off the drawing.
    expect(Math.hypot(reading.x2 - reading.x1, reading.y2 - reading.y1)).toBeCloseTo(1, 6);
  });

  it("sits at mid-height in page-width units, not at a fraction of the height", () => {
    // `sheet-geometry.ts`'s box: both axes over the WIDTH, so y runs 0..H/W and
    // the middle of the page is half of that. Getting this wrong puts the line
    // off the sheet.
    const reading = scaleFromPrinted(['1/4" = 1\'-0"'], ARCH_E1.widthPt, ARCH_E1.heightPt)!;
    expect(reading.y1).toBeCloseTo(30 / 42 / 2, 6);
    expect(reading.y1).toBe(reading.y2);
  });

  it("quotes the characters the architect printed", () => {
    expect(scaleFromPrinted(['3/4" = 1\'-0"'], ARCH_E1.widthPt, ARCH_E1.heightPt)!.declaredText).toBe(
      '3/4" = 1\'-0"',
    );
  });
});

describe("what it DECLINES, which is where the safety is", () => {
  it("declines when nothing is printed", () => {
    expect(scaleFromPrinted([], ARCH_E1.widthPt, ARCH_E1.heightPt)).toBeNull();
  });

  it("DECLINES A MULTI-SCALE SHEET rather than picking one", () => {
    // A plan at 1/8" with details at 3/4" has no single answer, and #640 already
    // warns about such sheets. Six of a real bid set's pages are this.
    expect(scaleFromPrinted(['1/8" = 1\'-0"', '3/4" = 1\'-0"'], ARCH_E1.widthPt, ARCH_E1.heightPt)).toBeNull();
  });

  it("declines an engineering scale — a site plan is not drywall work", () => {
    expect(scaleFromPrinted([`1" = 30'`], ARCH_E1.widthPt, ARCH_E1.heightPt)).toBeNull();
  });

  it("declines a name that is not a standard scale at all", () => {
    expect(scaleFromPrinted(["AS NOTED"], ARCH_E1.widthPt, ARCH_E1.heightPt)).toBeNull();
    expect(scaleFromPrinted(["NTS"], ARCH_E1.widthPt, ARCH_E1.heightPt)).toBeNull();
  });

  it("declines a missing page size rather than guessing one", () => {
    // `pageWidthPt` is nullable and documented as a label input. Without it
    // there is no arithmetic to do.
    expect(scaleFromPrinted(['1/8" = 1\'-0"'], null, ARCH_E1.heightPt)).toBeNull();
    expect(scaleFromPrinted(['1/8" = 1\'-0"'], ARCH_E1.widthPt, null)).toBeNull();
    expect(scaleFromPrinted(['1/8" = 1\'-0"'], 0, 0)).toBeNull();
  });

  it("DECLINES A HALF-SIZE PRINT, which is the hazard a printed scale cannot see", () => {
    // A 1/8" ARCH E1 sheet printed at half size still SAYS `1/8" = 1'-0"`, and
    // every quantity off it would be half. A dimension-based reading is immune —
    // the dimension and its line shrink together, so it reads the honest 1/16".
    // A printed one is not, because characters do not shrink. The page is the
    // only giveaway: half of 42x30 is 21x15, which is no standard sheet.
    expect(scaleFromPrinted(['1/8" = 1\'-0"'], 21 * 72, 15 * 72)).toBeNull();
  });

  it("declines any other non-standard page size", () => {
    expect(scaleFromPrinted(['1/8" = 1\'-0"'], 30 * 72, 20 * 72)).toBeNull();
  });
});

describe("the standard sheet sizes", () => {
  it("names the ones a GC actually issues", () => {
    expect(standardSheetSize(42 * 72, 30 * 72)).toBe("ARCH E1");
    expect(standardSheetSize(36 * 72, 24 * 72)).toBe("ARCH D");
    expect(standardSheetSize(24 * 72, 18 * 72)).toBe("ARCH C");
    expect(standardSheetSize(34 * 72, 22 * 72)).toBe("ANSI D");
  });

  it("names them whichever way round the page is", () => {
    // A portrait sheet is the same sheet. `/Rotate` and plain portrait exports
    // both happen.
    expect(standardSheetSize(30 * 72, 42 * 72)).toBe("ARCH E1");
  });

  it("admits a printer's margin and nothing like a reduction", () => {
    expect(standardSheetSize(42 * 72 * 1.01, 30 * 72 * 1.01)).toBe("ARCH E1");
    expect(standardSheetSize(42 * 72 * 0.5, 30 * 72 * 0.5)).toBeNull();
  });

  it("answers null for a size nobody prints drawings at", () => {
    expect(standardSheetSize(100 * 72, 100 * 72)).toBeNull();
    expect(standardSheetSize(0, 0)).toBeNull();
  });

  it("CONTAINS THE SIZES THE REAL SHEETS ACTUALLY WERE, measured not assumed", () => {
    // Every real drawing seen so far: three ARCH E1 and one ARCH D. A list that
    // did not cover these would decline every sheet available.
    expect(standardSheetSize(3024, 2160)).toBe("ARCH E1");
    expect(standardSheetSize(2592, 1728)).toBe("ARCH D");
  });
});
