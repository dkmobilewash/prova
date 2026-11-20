import { describe, expect, it } from "vitest";
import { carriesInfill, existingWalls, newInfillLegend, textRows } from "./existingWalls";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * prereg-legend-new-infill.md, on invented geometry (no plan content in the repo). Page-width units,
 * a 1000 pt page, 100 ft across. The legend: an EMPTY "(E) PARTITION TO REMAIN" sample, a crosshatched
 * "(N) 6" MTL STUD …" sample — Jane Hahan A2.1's shape.
 */
const W = 1000, FPU = 100;
const seg = (x1: number, y1: number, x2: number, y2: number, extra: Partial<StrokeSegment> = {}): StrokeSegment => ({ x1, y1, x2, y2, width: 0.5, gray: 0, ...extra }) as StrokeSegment;
const box = (x0: number, y0: number, x1: number, y1: number, extra: Partial<StrokeSegment> = {}) => [seg(x0, y0, x1, y0, extra), seg(x0, y1, x1, y1, extra), seg(x0, y0, x0, y1, extra), seg(x1, y0, x1, y1, extra)];
const ticks = (x0: number, x1: number, yLo: number, yHi: number, n: number) => Array.from({ length: n }, (_, i) => { const x = x0 + ((x1 - x0) * (i + 0.5)) / n; return seg(x - 0.001, yLo, x + 0.001, yHi); });
const word = (str: string, y: number) => ({ str, x: 500, y, width: 120, height: 10 });

// Swatches sit left of their rows, within a text height: rows at y 100 and 140 pt -> centres 0.095 and 0.135.
const emptyExisting = box(0.38, 0.092, 0.49, 0.098, { fill: 1 });
const patternedNew = [...box(0.38, 0.132, 0.49, 0.138), ...ticks(0.38, 0.49, 0.1325, 0.1375, 12)];
const rows = textRows([word("(E) PARTITION TO REMAIN", 100), word('(N) 6" MTL STUD PLUMBING WALL W/ 5/8" WR TYPE X', 140)]);

describe("the legend draws its NEW types filled or patterned and its existing one empty", () => {
  it("reads so only when the existing sample is empty and a (N)/NEW sample carries a fill or a pattern", () => {
    expect(newInfillLegend(rows, "(E) PARTITION TO REMAIN", [...emptyExisting, ...patternedNew], W)).toBe(true);
    expect(newInfillLegend(rows, "(E) PARTITION TO REMAIN", [...emptyExisting, ...box(0.38, 0.132, 0.49, 0.138)], W), "the new sample is empty too").toBe(false);
    const patternedExisting = [...emptyExisting, ...ticks(0.38, 0.49, 0.0925, 0.0975, 12)];
    expect(newInfillLegend(rows, "(E) PARTITION TO REMAIN", [...patternedExisting, ...patternedNew], W), "existing drawn patterned: the pattern says nothing").toBe(false);
    const darkNew = box(0.38, 0.132, 0.49, 0.138, { fill: 0 });
    expect(newInfillLegend(rows, "(E) PARTITION TO REMAIN", [...emptyExisting, ...darkNew], W), "a solid black new sample").toBe(true);
  });

  // A 10 ft wall, 6 in thick, along y = 0.5: faces at ±0.0025.
  const wall = { x1: 0.1, y1: 0.5, x2: 0.2, y2: 0.5, thicknessFeet: 0.5, lengthFeet: 10 } as WallCandidate;
  const faces = [seg(0.1, 0.4975, 0.2, 0.4975, { fill: 1 }), seg(0.1, 0.5025, 0.2, 0.5025, { fill: 1 })];
  const pattern = ticks(0.1, 0.2, 0.4978, 0.5022, 15);

  it("a wall carries it when a pattern lies between its faces along it; an empty wall, a floor hatch crossing it, or a pattern on a quarter of it does not", () => {
    expect(carriesInfill(wall, [...faces, ...pattern], FPU)).toBe(true);
    expect(carriesInfill(wall, faces, FPU)).toBe(false);
    const floorHatch = ticks(0.1, 0.2, 0.48, 0.52, 15);
    expect(carriesInfill(wall, [...faces, ...floorHatch], FPU), "strokes running past the faces are the room's hatch").toBe(false);
    expect(carriesInfill(wall, [...faces, ...ticks(0.1, 0.125, 0.4978, 0.5022, 15)], FPU), "pattern on 2.5 of 10 ft").toBe(false);
  });

  it("behind the flag, the legend's existing pen no longer sets aside a patterned wall; off, it does — and an empty wall goes either way", () => {
    const empty = { x1: 0.1, y1: 0.6, x2: 0.2, y2: 0.6, thicknessFeet: 0.5, lengthFeet: 10 } as WallCandidate;
    // The sheet's ordinary walls, drawn heavier and unfilled, so the legend's existing pen is its own.
    const ordinary = [0.7, 0.75, 0.8].map((y) => ({ x1: 0.1, y1: y, x2: 0.5, y2: y, thicknessFeet: 0.5, lengthFeet: 40 }) as WallCandidate);
    const ordinaryFaces = ordinary.flatMap((o) => [seg(0.1, o.y1 - 0.0025, 0.5, o.y1 - 0.0025, { width: 1.5 }), seg(0.1, o.y1 + 0.0025, 0.5, o.y1 + 0.0025, { width: 1.5 })]);
    const segments = [...emptyExisting, ...patternedNew, ...faces, ...pattern, seg(0.1, 0.5975, 0.2, 0.5975, { fill: 1 }), seg(0.1, 0.6025, 0.2, 0.6025, { fill: 1 }), ...ordinaryFaces];
    const textItems = [word("(E) PARTITION TO REMAIN", 100), word('(N) 6" MTL STUD PLUMBING WALL W/ 5/8" WR TYPE X', 140)];
    const run = (newInfill: boolean) => existingWalls({ walls: [wall, empty, ...ordinary], segments, textItems, widthPt: W, feetPerUnit: FPU, newInfill }).map((e) => e.wall);
    expect(run(false)).toEqual([wall, empty]);
    expect(run(true)).toEqual([empty]);
  });
});
