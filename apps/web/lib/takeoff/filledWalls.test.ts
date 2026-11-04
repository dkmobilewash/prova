import { describe, expect, it } from "vitest";
import { existingWalls } from "./existingWalls";
import { filledBands, filledWallCandidates, UNREAD_SHARE } from "./filledWalls";
import { findWallsOnSheet } from "./findWallsOnSheet";
import type { StrokeSegment } from "./wallVectors";

/**
 * Units are feet / 100 (FPU = 100), so a coordinate of 0.5 is 50 ft. A ring
 * is emitted edge by edge, closed, the order `sheetStrokes` gives a path.
 */
const FPU = 100;
const ft = (n: number) => n / FPU;
const ring = (pts: [number, number][], fill: number): StrokeSegment[] =>
  pts.map(([x, y], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    return { x1: ft(x), y1: ft(y), x2: ft(x2), y2: ft(y2), width: 0, fill };
  });
const rect = (x0: number, y0: number, x1: number, y1: number, fill = 0): StrokeSegment[] =>
  ring([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fill);
const inches = (b: { thicknessFeet: number }) => Math.round(b.thicknessFeet * 120) / 10;

describe("a band of solid fill is a wall down its middle", () => {
  it("one 8 in band: its centreline, its length, its thickness from the fill", () => {
    const [band, ...rest] = filledBands(rect(10, 50, 40, 50 + 8 / 12), FPU);
    expect(rest).toHaveLength(0);
    expect(inches(band!)).toBe(8);
    expect(band!.lengthFeet).toBeCloseTo(30, 6);
    expect(band!.y1 * FPU).toBeCloseTo(50 + 4 / 12, 6);
    expect(band!.y2 * FPU).toBeCloseTo(50 + 4 / 12, 6);
  });

  it("a building drawn as ONE fill with the room as a hole gives its four walls, not the room", () => {
    // Even-odd: the room inside is not fill, so its walls are bands and the
    // room's own 20 ft width is never one.
    const t = 1;
    const bands = filledBands([...rect(0, 0, 40, 20), ...rect(t, t, 40 - t, 20 - t)], FPU);
    expect(bands.map(inches).sort()).toEqual([12, 12, 12, 12]);
    expect(bands.map((b) => Math.round(b.lengthFeet)).sort((a, b) => a - b)).toEqual([18, 18, 38, 38]);
  });

  it("grey poché is a wall; a light tint is not", () => {
    expect(filledBands(rect(10, 50, 40, 50.5, 0.75), FPU)).toHaveLength(1);
    expect(filledBands(rect(10, 50, 40, 50.5, 0.95), FPU)).toHaveLength(0);
  });
});

describe("what is not a band", () => {
  it("a column, and a stub shorter than four times its thickness", () => {
    expect(filledBands(rect(10, 10, 11, 11), FPU)).toHaveLength(0);
    expect(filledBands(rect(10, 10, 12.5, 11), FPU)).toHaveLength(0);
    expect(filledBands(rect(10, 10, 14.5, 11), FPU)).toHaveLength(1);
  });

  it("a fill outline cut into short pieces is still one face", () => {
    const pieces: [number, number][] = [];
    for (let x = 10; x <= 30; x += 1) pieces.push([x, 50]);
    for (let x = 30; x >= 10; x -= 1) pieces.push([x, 50.5]);
    const [band, ...rest] = filledBands(ring(pieces, 0), FPU);
    expect(rest).toHaveLength(0);
    expect(band!.lengthFeet).toBeCloseTo(20, 6);
  });

  it("a hatch field of thin strips, and an area wider than 16 in", () => {
    const strips = Array.from({ length: 20 }, (_, i) => rect(10, 10 + i * 0.3, 30, 10 + i * 0.3 + 1 / 12)).flat();
    expect(filledBands(strips, FPU)).toHaveLength(0);
    expect(filledBands(rect(10, 10, 30, 15), FPU)).toHaveLength(0);
    expect(filledBands(rect(10, 10, 30, 10 + 17 / 12), FPU)).toHaveLength(0);
  });

  it("two edges with fill BEYOND them are an area, not a band", () => {
    // A 10 ft slab cut by two thin slits 12 in apart: the strip between them
    // is fill, but so is everything past each slit.
    const slab = [...rect(0, 0, 30, 10), ...rect(5, 4, 25, 4.05), ...rect(5, 5.05, 25, 5.1)];
    expect(filledBands(slab, FPU)).toHaveLength(0);
    // Two rooms either side of the same strip: that is a wall.
    const rooms = [...rect(0, 0, 30, 10), ...rect(5, 1, 25, 4.05), ...rect(5, 5.05, 25, 9)];
    expect(filledBands(rooms, FPU).filter((b) => Math.abs(b.y1 * FPU - 4.55) < 0.01)).toHaveLength(1);
  });
});

describe("only what the pairer did not read, and only on a sheet where it read little", () => {
  const four = [...rect(0, 0, 30, 0.5), ...rect(0, 10, 30, 10.5), ...rect(0, 20, 30, 20.5), ...rect(0, 30, 30, 30.5)];
  const along = (y: number) => ({ x1: 0, y1: ft(y), x2: ft(30), y2: ft(y), thicknessFeet: 0.5 });

  it("a band the pairer found is not offered again, and the rest is", () => {
    const got = filledWallCandidates(four, FPU, [along(0.25)]);
    expect(got.map((w) => Math.round(w.y1 * FPU * 100) / 100)).toEqual([10.25, 20.25, 30.25]);
    expect(got.every((w) => w.fromFill === true)).toBe(true);
  });

  it(`nothing at all when the pairer read more than ${(1 - UNREAD_SHARE) * 100}% of the band footage`, () => {
    expect(filledWallCandidates(four, FPU, [along(0.25), along(10.25), along(20.25)])).toHaveLength(0);
  });

  it("a found wall's grey core is that wall, however thick the wall", () => {
    // A 12 in outlined wall whose 4 in core sits 4 in off its centreline.
    const core = rect(0, 0.5, 30, 0.5 + 4 / 12);
    expect(filledWallCandidates(core, FPU, [{ ...along(0.33), thicknessFeet: 1 }])).toHaveLength(0);
  });
});

describe("existing work stays set aside", () => {
  it("a filled band in the legend's EXISTING WALL grey is set aside; a black one is not", () => {
    const word = (str: string, xFt: number, yFt: number) => ({ str, x: xFt * 10 - 20, y: yFt * 10, width: 40, height: 8 });
    const legend = [word("EXISTING WALL", 62, 90), word("NEW WALL", 62, 92)];
    const swatch = [...rect(55, 89.4, 59, 89.6, 0.75), { x1: ft(55), y1: ft(91.6), x2: ft(59), y2: ft(91.6), gray: 0, width: 1.5 }, { x1: ft(55), y1: ft(91.62), x2: ft(59), y2: ft(91.62), gray: 0, width: 1.5 }];
    const plan = [...rect(10, 50, 40, 50.5, 0.75), ...rect(10, 60, 40, 60.5, 0)];
    const walls = filledWallCandidates(plan, FPU, []);
    expect(walls).toHaveLength(2);
    const aside = existingWalls({ walls, segments: plan, pageSegments: [...plan, ...swatch], textItems: legend, widthPt: 1000, feetPerUnit: FPU });
    expect(aside.map((e) => Math.round(e.wall.y1 * FPU))).toEqual([50]);
    expect(aside[0]!.why).toContain("filled grey 0.75");
  });
});

describe("through the finder", () => {
  // 1224 pt across at 136 ft: 9 pt is a foot. 16 in masonry drawn as one
  // solid fill with two rooms as holes. Thicker than the pairer reads (13 in),
  // which is a way to get a sheet it offers nothing on; WHY Washington Village
  // offers nothing was not examined, because that sheet is held out.
  const P = 1224 / 136;
  const pt = (x: number, y: number): [number, number] => [x * P, y * P];
  const ringPt = (pts: [number, number][], fill: number): StrokeSegment[] =>
    pts.map(([x, y], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length]!;
      return { x1: x, y1: y, x2, y2, width: 0, fill };
    });
  const t = 16 / 12;
  const building = [
    ...ringPt([pt(20, 20), pt(80, 20), pt(80, 60), pt(20, 60)], 0),
    ...ringPt([pt(20 + t, 20 + t), pt(50 - t / 2, 20 + t), pt(50 - t / 2, 60 - t), pt(20 + t, 60 - t)], 0),
    ...ringPt([pt(50 + t / 2, 20 + t), pt(80 - t, 20 + t), pt(80 - t, 60 - t), pt(50 + t / 2, 60 - t)], 0),
  ];
  const find = (filledBands?: boolean) =>
    findWallsOnSheet({ segments: building, textItems: [], pageSize: { widthPt: 1224, heightPt: 792 }, feetPerUnit: 136, wallTypes: [], sampledSheets: null, filledBands });

  it("offers the walls of a sheet drawn only in solid fill, at the fill's thickness", () => {
    const walls = find().walls;
    expect(walls.length).toBeGreaterThanOrEqual(7);
    expect(walls.every((w) => w.fromFill === true)).toBe(true);
    expect(walls.every((w) => Math.abs(w.thicknessFeet * 12 - 16) < 0.1)).toBe(true);
    // The perimeter (200 ft at the centreline, less the corners) and the 40 ft party wall.
    const feet = walls.reduce((s, w) => s + w.lengthFeet, 0);
    expect(feet).toBeGreaterThan(220);
    expect(feet).toBeLessThan(245);
  });

  it("and offered nothing before, which is the Washington Village report", () => {
    expect(find(false).walls).toHaveLength(0);
  });
});
