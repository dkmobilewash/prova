import { describe, expect, it } from "vitest";
import { scalePrefillsFromReadings, type ScaleReadingRowForView } from "./takeoff-plan-view";

/**
 * Turning a stored scale reading into something the calibration form can offer.
 *
 * Every test here is about REFUSING to offer a half-written row, because the
 * cost is asymmetric: a missing prefill costs the estimator the two clicks they
 * do today, and a malformed one would draw a line with one end and a figure
 * nobody chose, on a form whose button writes a scale that multiplies through
 * every quantity on the sheet.
 */

const row = (over: Partial<ScaleReadingRowForView> = {}): ScaleReadingRowForView => ({
  pageNumber: 1,
  scaleName: '1/8" = 1\'-0"',
  x1: 0.1,
  y1: 0.2,
  x2: 0.15,
  y2: 0.2,
  declaredDistanceFeet: "16.3750",
  declaredText: `16' - 4 1/2"`,
  agreedText: `16' - 4 1/2"\n11' - 0"\n6' - 0"`,
  consideredCount: 30,
  inheritedError: 0.00315,
  ...over,
});

describe("what it offers", () => {
  it("carries the line, the figure and the evidence", () => {
    const byPage = scalePrefillsFromReadings([row()]);
    const prefill = byPage[1]!;
    expect(prefill.scaleName).toBe('1/8" = 1\'-0"');
    expect(prefill.xs).toEqual([0.1, 0.15]);
    expect(prefill.ys).toEqual([0.2, 0.2]);
    expect(prefill.declaredFeet).toBeCloseTo(16.375, 4);
    expect(prefill.declaredText).toBe(`16' - 4 1/2"`);
    expect(prefill.agreed).toEqual([`16' - 4 1/2"`, `11' - 0"`, `6' - 0"`]);
    expect(prefill.considered).toBe(30);
    expect(prefill.inheritedError).toBeCloseTo(0.00315, 5);
  });

  it("READS THE DECIMAL COLUMN WITHOUT LOSING A FRACTION OF AN INCH", () => {
    // `declaredDistanceFeet` is `Decimal(12,4)` and arrives as a string or a
    // Prisma Decimal, never a number. 16.375 is 16' 4 1/2" — a sixteenth lost
    // here is a sixteenth of error on every wall.
    expect(scalePrefillsFromReadings([row({ declaredDistanceFeet: "16.3750" })])[1]!.declaredFeet).toBe(16.375);
    expect(
      scalePrefillsFromReadings([row({ declaredDistanceFeet: { toString: () => "15.2865" } })])[1]!.declaredFeet,
    ).toBeCloseTo(15.2865, 4);
  });

  it("keys by page, keeping the newest row the query ordered first", () => {
    const byPage = scalePrefillsFromReadings([
      row({ pageNumber: 2, scaleName: '1/4" = 1\'-0"' }),
      row({ pageNumber: 2, scaleName: '1/8" = 1\'-0"' }),
    ]);
    expect(byPage[2]!.scaleName).toBe('1/4" = 1\'-0"');
  });
});

describe("what it refuses to offer", () => {
  it("offers nothing for a page that declined", () => {
    expect(scalePrefillsFromReadings([row({ scaleName: null })])).toEqual({});
  });

  it("offers nothing when an endpoint is missing — never a line with one end", () => {
    expect(scalePrefillsFromReadings([row({ x2: null })])).toEqual({});
    expect(scalePrefillsFromReadings([row({ y1: null })])).toEqual({});
  });

  it("offers nothing for a zero or negative distance", () => {
    expect(scalePrefillsFromReadings([row({ declaredDistanceFeet: "0" })])).toEqual({});
    expect(scalePrefillsFromReadings([row({ declaredDistanceFeet: "-4" })])).toEqual({});
  });

  it("offers nothing for a distance that is not a number", () => {
    expect(scalePrefillsFromReadings([row({ declaredDistanceFeet: null })])).toEqual({});
    expect(scalePrefillsFromReadings([row({ declaredDistanceFeet: "n/a" })])).toEqual({});
  });

  it("survives an empty evidence list rather than offering a blank sentence", () => {
    const prefill = scalePrefillsFromReadings([row({ agreedText: null })])[1]!;
    expect(prefill.agreed).toEqual([]);
    expect(prefill.scaleName).toBeTruthy();
  });

  it("drops blank lines out of the evidence", () => {
    const prefill = scalePrefillsFromReadings([row({ agreedText: `11' - 0"\n\n  \n6' - 0"` })])[1]!;
    expect(prefill.agreed).toEqual([`11' - 0"`, `6' - 0"`]);
  });

  it("offers nothing at all for no rows", () => {
    expect(scalePrefillsFromReadings([])).toEqual({});
  });
});
