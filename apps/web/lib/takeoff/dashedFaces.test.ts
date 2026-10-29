import { describe, expect, it } from "vitest";
import { bothFacesDashed, faceDash, isDashPattern } from "./dashedFaces";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

// 1 page-width unit = 100 ft, so a 20 ft wall is 0.2 units and a 6 in wall is 0.005 thick.
const FPU = 100;
const wall: WallCandidate = { x1: 0.1, y1: 0.5, x2: 0.3, y2: 0.5, lengthFeet: 20, thicknessFeet: 0.5 } as WallCandidate;
const faceY = (side: 1 | -1) => 0.5 + (side * (0.5 / 2)) / FPU;
function solid(side: 1 | -1): StrokeSegment[] {
  return [{ x1: 0.1, y1: faceY(side), x2: 0.3, y2: faceY(side) }];
}
function dashes(side: 1 | -1, pieceFeet: number, gapFeet: number): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let t = 0; t < 20; t += pieceFeet + gapFeet) out.push({ x1: 0.1 + t / FPU, y1: faceY(side), x2: 0.1 + Math.min(20, t + pieceFeet) / FPU, y2: faceY(side) });
  return out;
}

describe("a pair of dashed lines is not a wall to build", () => {
  it("reads a solid face as one piece and a dashed face as a pattern", () => {
    expect(faceDash(wall, 1, solid(1), FPU).pieces).toBe(1);
    const d = faceDash(wall, 1, dashes(1, 1, 1), FPU);
    expect(d.pieces).toBe(10);
    expect(d.cover).toBeCloseTo(0.5, 1);
    expect(isDashPattern(d)).toBe(true);
    expect(isDashPattern(faceDash(wall, 1, solid(1), FPU))).toBe(false);
  });

  it("SETS ASIDE A PAIR WHOSE BOTH FACES ARE DASHED, AND KEEPS ONE WITH A SOLID FACE", () => {
    expect(bothFacesDashed(wall, [...dashes(1, 1, 1), ...dashes(-1, 1, 1)], FPU)).toBe(true);
    expect(bothFacesDashed(wall, [...dashes(1, 1, 1), ...solid(-1)], FPU)).toBe(false);
    expect(bothFacesDashed(wall, [...solid(1), ...solid(-1)], FPU)).toBe(false);
  });

  it("a face broken by doors is not a dash pattern: long pieces", () => {
    expect(isDashPattern(faceDash(wall, 1, dashes(1, 6, 3), FPU))).toBe(false);
  });

  it("a dotted line — tiny pieces, tiny gaps — is a pattern too (the sweep said so: Bunkie A100)", () => {
    const dots = dashes(1, 0.05, 0.05);
    expect(isDashPattern(faceDash(wall, 1, dots, FPU))).toBe(true);
  });

  it("a dashed line on the OTHER side of the wall does not make this face dashed", () => {
    expect(isDashPattern(faceDash(wall, 1, dashes(-1, 1, 1), FPU))).toBe(false);
  });
});
