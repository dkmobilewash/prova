import { describe, expect, it } from "vitest";

import { feetPerPageWidth, readScale } from "@/lib/takeoff-plan";
import { PICKABLE_SCALES, pickedScaleLine, suggestedScalePick } from "@/lib/takeoff-scale-picker";

/**
 * A STANDARD SCALE, PICKED FROM A LIST, HAS TO READ BACK AS ITSELF.
 *
 * A 30-year sub, on the slowest part of takeoff: "architect using 3/16, the
 * measure tools we're using are 1/8 or quarter, so you need to calculate." The
 * picker turns a scale NAME into the one thing a calibration stores — a line
 * and what that line is in feet — and nothing else. So the proof is that the
 * existing reader (`readScale`, the same function every saved calibration is
 * named back by) names the picked line back as the scale that was picked, on
 * real sheet sizes. A second scale computation would be free to disagree with
 * it; this asserts there is nothing to disagree with.
 */

const SHEETS = [
  { name: "ARCH D", widthPt: 36 * 72, heightPt: 24 * 72 },
  { name: "ARCH E1", widthPt: 42 * 72, heightPt: 30 * 72 },
  { name: "ANSI B", widthPt: 17 * 72, heightPt: 11 * 72 },
];

describe("the standard scale picker", () => {
  it("offers every scale the customer named, architectural and engineering", () => {
    const names = PICKABLE_SCALES.map((scale) => scale.name);
    for (const wanted of [
      '3/32" = 1\'-0"',
      '1/8" = 1\'-0"',
      '3/16" = 1\'-0"',
      '1/4" = 1\'-0"',
      '3/8" = 1\'-0"',
      '1/2" = 1\'-0"',
      '3/4" = 1\'-0"',
      '1" = 1\'-0"',
      '1-1/2" = 1\'-0"',
      '3" = 1\'-0"',
      '1" = 10\'',
      '1" = 20\'',
      '1" = 30\'',
      '1" = 40\'',
      '1" = 50\'',
      '1" = 60\'',
      '1" = 100\'',
    ]) {
      expect(names, `${wanted} is not offered`).toContain(wanted);
    }
  });

  for (const sheet of SHEETS) {
    it(`reads back as the picked scale at every size on ${sheet.name}`, () => {
      let checked = 0;
      for (const scale of PICKABLE_SCALES) {
        const line = pickedScaleLine(scale.name, sheet.widthPt, sheet.heightPt);
        expect(line, `${scale.name} produced no line`).not.toBeNull();
        if (line === null) continue;
        const stored = {
          x1: line.xs[0],
          y1: line.ys[0],
          x2: line.xs[1],
          y2: line.ys[1],
          declaredDistanceFeet: line.declaredDistanceFeet,
        };
        const reading = readScale(stored, sheet.widthPt);
        expect(reading?.name, `${scale.name} read back as something else`).toBe(scale.name);
        // Exact, not merely within readScale's 2% tolerance: the arithmetic is
        // two facts about the file multiplied, and nothing is rounded.
        expect(reading?.feetPerInch).toBeCloseTo(scale.feetPerInch, 9);
        // The line lies ON the page, so it draws where somebody can see it.
        expect(Math.min(...line.xs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...line.xs)).toBeLessThanOrEqual(1);
        expect(line.ys[0]).toBeLessThan(sheet.heightPt / sheet.widthPt);
        expect(feetPerPageWidth(stored)).toBeCloseTo((sheet.widthPt / 72) * scale.feetPerInch, 6);
        checked += 1;
      }
      // Size of the set, against a literal that cannot drift with it.
      expect(checked).toBe(PICKABLE_SCALES.length);
      expect(checked).toBeGreaterThanOrEqual(17);
    });
  }

  it("declines rather than guessing when the page width is unknown or the name is not a scale", () => {
    expect(pickedScaleLine('1/8" = 1\'-0"', 0, 792)).toBeNull();
    expect(pickedScaleLine('1/8" = 1\'-0"', Number.NaN, 792)).toBeNull();
    expect(pickedScaleLine("AS NOTED", 1224, 792)).toBeNull();
  });

  describe("what it pre-selects", () => {
    it("the scale this sheet's own reading found, first", () => {
      expect(suggestedScalePick({ prefillScale: '3/16" = 1\'-0"', printedScale: '1/4" = 1\'-0"', viewScales: [] })).toBe(
        '3/16" = 1\'-0"',
      );
    });

    it("the title block's printed scale, however it was typed, when there is no reading", () => {
      expect(suggestedScalePick({ prefillScale: null, printedScale: "3/16″ = 1′-0″", viewScales: [] })).toBe(
        '3/16" = 1\'-0"',
      );
    });

    it("a single drawing's caption, but never one of several", () => {
      expect(suggestedScalePick({ prefillScale: null, printedScale: null, viewScales: ['1" = 20\''] })).toBe('1" = 20\'');
      expect(
        suggestedScalePick({ prefillScale: null, printedScale: null, viewScales: ['1/8" = 1\'-0"', '1/4" = 1\'-0"'] }),
      ).toBeNull();
    });

    it("nothing when the sheet names no scale on the list", () => {
      expect(suggestedScalePick({ prefillScale: null, printedScale: "AS NOTED", viewScales: [] })).toBeNull();
      expect(suggestedScalePick({ prefillScale: null, printedScale: null, viewScales: [] })).toBeNull();
    });
  });
});
