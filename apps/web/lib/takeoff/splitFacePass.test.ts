import { describe, expect, it } from "vitest";
import { wallsFromStrokes, type StrokeSegment } from "./wallVectors";

// One page-width unit = 100 ft; a 6 in wall is 0.005 apart.
const FPU = 100;
const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2 });
const long = seg(0.1, 0.5, 0.7, 0.5); // 60 ft

describe("a long face serves the pieces of its other face", () => {
  it("PAIRS EACH PIECE when the pieces together cover half the long face", () => {
    // Three pieces of 12, 8 and 16 ft, 4 ft apart (door openings), on one side at 6 in: 36 of 60 ft.
    const pieces = [seg(0.14, 0.505, 0.26, 0.505), seg(0.3, 0.505, 0.38, 0.505), seg(0.42, 0.505, 0.58, 0.505)];
    const walls = wallsFromStrokes([long, ...pieces], { feetPerPoint: FPU });
    expect(walls.map((w) => Math.round(w.lengthFeet)).sort((a, b) => a - b)).toEqual([8, 12, 16]);
    for (const w of walls) expect(w.thicknessFeet * 12).toBeCloseTo(6, 0);
  });

  it("STILL REFUSES A GRID LINE WITH ONE STRAY PARTNER — a door leaf is not a face", () => {
    const walls = wallsFromStrokes([long, seg(0.3, 0.505, 0.42, 0.505)], { feetPerPoint: FPU });
    expect(walls).toEqual([]);
  });

  it("refuses pieces that cover less than half, and pieces at two different thicknesses do not add up", () => {
    const sparse = [seg(0.14, 0.505, 0.22, 0.505), seg(0.5, 0.505, 0.58, 0.505)]; // 16 of 60 ft
    expect(wallsFromStrokes([long, ...sparse], { feetPerPoint: FPU })).toEqual([]);
    const mixed = [seg(0.14, 0.505, 0.34, 0.505), seg(0.38, 0.508, 0.58, 0.508)]; // 20 ft at 6 in + 20 ft at 9.6 in
    expect(wallsFromStrokes([long, ...mixed], { feetPerPoint: FPU })).toEqual([]);
  });

  it("counts a stretch drawn twice once, so duplicates neither add up nor disqualify", () => {
    // Two copies of a 20 ft stretch (at thicknesses 6 and 6.6 in, which is one face) plus a 14 ft one: 34 of 60 ft.
    const doubled = [seg(0.14, 0.505, 0.34, 0.505), seg(0.14, 0.5055, 0.34, 0.5055), seg(0.44, 0.505, 0.58, 0.505)];
    const walls = wallsFromStrokes([long, ...doubled], { feetPerPoint: FPU });
    expect(walls.map((w) => Math.round(w.lengthFeet)).sort((a, b) => a - b)).toEqual([14, 20]);
    // The same two copies alone cover 20 of 60 ft, not 40, and are refused.
    expect(wallsFromStrokes([long, doubled[0], doubled[1]], { feetPerPoint: FPU })).toEqual([]);
  });

  it("refuses a filled band handed over as a stroke a foot wide, and pieces shorter than a stretch of face", () => {
    const band = { ...long, width: 1877 };
    const pieces = [seg(0.14, 0.505, 0.26, 0.505), seg(0.3, 0.505, 0.38, 0.505), seg(0.42, 0.505, 0.58, 0.505)];
    expect(wallsFromStrokes([band, ...pieces], { feetPerPoint: FPU })).toEqual([]);
    const ticks: StrokeSegment[] = [];
    for (let x = 0.14; x < 0.58; x += 0.06) ticks.push(seg(x, 0.505, x + 0.03, 0.505)); // 3 ft pieces, 3 ft apart: 24 of 60 ft but each under 4 ft
    expect(wallsFromStrokes([long, ...ticks], { feetPerPoint: FPU })).toEqual([]);
  });

  it("leaves a wall the loop already found alone", () => {
    // A balanced partner the loop pairs as before; the pass adds nothing on top of it.
    const partner = seg(0.1, 0.505, 0.7, 0.505);
    const walls = wallsFromStrokes([long, partner], { feetPerPoint: FPU });
    expect(walls).toHaveLength(1);
    expect(Math.round(walls[0].lengthFeet)).toBe(60);
  });
});
