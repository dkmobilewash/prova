import { describe, expect, it } from "vitest";
import {
  dashedFaceCount,
  FEATURE_NAMES,
  featuresFor,
  normaliseAcrossSheet,
  penPercentileFor,
  runsMeeting,
  SHEET_RELATIVE_NAMES,
  twinFaces,
  wordsBetween,
} from "./wallFeatures";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── THE PROPERTY THESE FEATURES EXIST FOR ──
 *
 * A model trained on absolute pen widths put 0.721 of its importance on one,
 * was strictly better than the rules on the three drafting styles it had seen,
 * and dropped 36% of ELEVEN03's footage including every interior partition.
 * It had learned "a wall is drawn at 0.5 points", which is a house convention
 * and not a fact about walls.
 *
 * So the test is not that the numbers are right in some absolute sense. It is
 * that the SAME DRAWING, re-drawn the way another office would draw it, gives
 * the same numbers.
 */
const at = (name: (typeof FEATURE_NAMES)[number]) => FEATURE_NAMES.indexOf(name);

/** One sheet: three walls of different thickness and a scatter of thin lines,
 *  with every length and pen width multiplied by the caller's factors. */
function sheet(penScale: number, sizeScale: number) {
  const faces: StrokeSegment[] = [];
  const pairs: { a: StrokeSegment; b: StrokeSegment; thickness: number }[] = [];
  for (const [i, thickness] of [0.4, 0.5, 0.9].entries()) {
    const y = i * 10 * sizeScale;
    const len = (30 + i * 10) * sizeScale;
    const a: StrokeSegment = { x1: 0, y1: y, x2: len, y2: y, width: 0.5 * penScale };
    const b: StrokeSegment = {
      x1: 0,
      y1: y + thickness * sizeScale,
      x2: len,
      y2: y + thickness * sizeScale,
      width: 0.5 * penScale,
    };
    faces.push(a, b);
    pairs.push({ a, b, thickness: thickness * sizeScale });
  }
  // Furniture: shorter, drawn at a lighter pen, which is true in every office
  // even though the weights themselves differ.
  for (let i = 0; i < 12; i += 1) {
    faces.push({
      x1: i * 2 * sizeScale,
      y1: 50 * sizeScale,
      x2: (i * 2 + 1.5) * sizeScale,
      y2: 50 * sizeScale,
      width: 0.18 * penScale,
    });
  }
  const penPercentile = penPercentileFor(faces);
  const rows = pairs.map(({ a, b, thickness }) => {
    const wall: WallCandidate = {
      x1: a.x1,
      y1: a.y1,
      x2: a.x2,
      y2: a.y2,
      thicknessFeet: thickness,
      lengthFeet: Math.hypot(a.x2 - a.x1, a.y2 - a.y1),
    };
    return featuresFor(a, b, wall, {
      faces,
      scheduledIn: [],
      inHatchSeries: false,
      sheetSpan: 100 * sizeScale,
      penPercentile,
    });
  });
  normaliseAcrossSheet(rows);
  return rows;
}

describe("features that no office can set", () => {
  it("THE SAME DRAWING AT A HEAVIER PEN GIVES THE SAME NUMBERS", () => {
    const light = sheet(1, 1);
    const heavy = sheet(3, 1);
    expect(heavy).toEqual(light);
  });

  it("the same drawing at a different scale gives the same numbers", () => {
    // Every length doubled: a larger sheet, or the same building at 1/4"
    // instead of 1/8". Nothing about which lines are walls has changed.
    const small = sheet(1, 1);
    const large = sheet(1, 2);
    for (const name of FEATURE_NAMES) {
      const i = at(name);
      for (let row = 0; row < small.length; row += 1) {
        expect(large[row][i], `${name} moved with the scale`).toBeCloseTo(small[row][i], 9);
      }
    }
  });

  it("NO ABSOLUTE PEN WIDTH SURVIVES INTO THE VECTOR", () => {
    // The direct check on the defect: 0.5 and 1.5 are the two pens, and
    // neither should appear anywhere in the numbers a model sees.
    const rows = sheet(3, 1);
    for (const row of rows) {
      for (const value of row) {
        expect(Math.abs(value - 1.5), "a raw pen width reached the vector").toBeGreaterThan(1e-9);
      }
    }
  });

  it("a thicker wall still ranks above a thinner one", () => {
    // Relative must not mean blind: within one sheet the ordering is the whole
    // signal, and flattening it would make the features useless rather than
    // portable.
    const rows = sheet(1, 1);
    const pct = rows.map((r) => r[at("thicknessPercentile")]);
    expect(pct[0]).toBeLessThan(pct[1]);
    expect(pct[1]).toBeLessThan(pct[2]);
    expect(rows[2][at("thicknessVsCommon")]).toBeGreaterThan(1);
    expect(rows[0][at("thicknessVsCommon")]).toBeLessThan(1);
  });

  it("a wall ranks above the furniture on its own sheet, at any pen", () => {
    for (const penScale of [0.5, 1, 4]) {
      const rows = sheet(penScale, 1);
      for (const row of rows) {
        expect(row[at("penPercentile")], `at pen x${penScale}`).toBeGreaterThan(0.5);
      }
    }
  });

  it("every sheet-relative column is named and normalised", () => {
    // Anti-vacuity: if a column were dropped from the normaliser it would
    // silently carry a raw value — a thickness in feet — into the model.
    for (const name of SHEET_RELATIVE_NAMES) {
      expect(FEATURE_NAMES).toContain(name);
    }
    const rows = sheet(1, 1);
    for (const name of SHEET_RELATIVE_NAMES) {
      for (const row of rows) {
        expect(row[at(name as (typeof FEATURE_NAMES)[number])], name).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe("the four signals from the junk census", () => {
  // 1 page unit = 100 ft; a 20 ft run at y = 0.5, 6 in thick, faces at ±0.0025.
  const wall = { x1: 0.1, y1: 0.5, x2: 0.3, y2: 0.5, lengthFeet: 20, thicknessFeet: 0.5 } as WallCandidate;
  const faceA: StrokeSegment = { x1: 0.1, y1: 0.5025, x2: 0.3, y2: 0.5025 };
  const faceB: StrokeSegment = { x1: 0.1, y1: 0.4975, x2: 0.3, y2: 0.4975 };
  const dashes = (y: number): StrokeSegment[] => Array.from({ length: 10 }, (_, k) => ({ x1: 0.1 + k * 0.02, y1: y, x2: 0.1 + k * 0.02 + 0.01, y2: y }));

  it("wordsBetween counts the words inside the band and not the dimensions or the words beside it", () => {
    const words = [
      { str: "HINGE", x: 0.15, y: 0.5 }, { str: "PULL", x: 0.2, y: 0.5 }, { str: "CLOSER", x: 0.25, y: 0.5 },
      { str: "3'-0\"", x: 0.28, y: 0.5 }, { str: "HALLWAY", x: 0.2, y: 0.53 },
    ];
    expect(wordsBetween(wall, words)).toBe(3);
    expect(wordsBetween(wall, [])).toBe(0);
  });

  it("dashedFaces is 2 for two dashed faces, 1 for one, 0 for solid or with no strokes", () => {
    expect(dashedFaceCount(wall, [...dashes(0.5025), ...dashes(0.4975)])).toBe(2);
    expect(dashedFaceCount(wall, [...dashes(0.5025), faceB])).toBe(1);
    expect(dashedFaceCount(wall, [faceA, faceB])).toBe(0);
    expect(dashedFaceCount(wall, [])).toBe(0);
  });

  it("runsMeeting counts perpendicular faces ending on the run, not parallel ones or ticks", () => {
    const partition: StrokeSegment = { x1: 0.2, y1: 0.5, x2: 0.2, y2: 0.7 };
    const tick: StrokeSegment = { x1: 0.15, y1: 0.5, x2: 0.15, y2: 0.505 };
    const parallel: StrokeSegment = { x1: 0.1, y1: 0.6, x2: 0.3, y2: 0.6 };
    expect(runsMeeting(wall, [faceA, faceB, partition, tick, parallel], faceA, faceB)).toBe(1);
  });

  it("twinFaces counts parallel faces of the same length elsewhere on the sheet", () => {
    const twins: StrokeSegment[] = [0.6, 0.7, 0.8].map((y) => ({ x1: 0.1, y1: y, x2: 0.3, y2: y }));
    const longer: StrokeSegment = { x1: 0.1, y1: 0.9, x2: 0.35, y2: 0.9 };
    // faceB is the pair's own other face, 6 in away: not a twin. The three at 10, 20 and 30 ft are.
    expect(twinFaces(wall, faceA, [faceA, faceB, ...twins, longer])).toBe(3);
  });
});
