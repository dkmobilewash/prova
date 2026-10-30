import { describe, expect, it } from "vitest";
import { bandedFillWall } from "./bandedFill";
import type { StrokeSegment } from "./wallVectors";

// One unit = one foot, so a 14 in band is 14/12 units wide.
const fpu = 1;
const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2 });
const face = seg(0, 0, 20, 0);
const partner = seg(0, 14 / 12, 20, 14 / 12);
/** Diagonal hatch strokes between y=0 and y=14/12 along the face. */
const fill = (count: number, from = 0.1, to = 14 / 12 - 0.1) =>
  Array.from({ length: count }, (_, i) => { const x = 1 + (i * 18) / count; return seg(x, from, x + 0.6, to); });

describe("bandedFillWall", () => {
  it("reads a hatched band between two faces as a wall of that thickness", () => {
    const wall = bandedFillWall(face, [face, partner, ...fill(12)], [], fpu);
    expect(wall).not.toBeNull();
    expect(wall!.thicknessFeet).toBeCloseTo(14 / 12, 2);
    expect(wall!.y1).toBeCloseTo(7 / 12, 2);
    expect(wall!.lengthFeet).toBe(20);
  });
  it("refuses a hatch field that continues beyond the far face or across the near one", () => {
    const beyond = Array.from({ length: 8 }, (_, i) => seg(2 + i * 2, 14 / 12 + 0.2, 2.6 + i * 2, 14 / 12 + 0.9));
    expect(bandedFillWall(face, [face, partner, ...fill(12), ...beyond], [], fpu)).toBeNull();
    const across = Array.from({ length: 8 }, (_, i) => seg(2 + i * 2, -0.2, 2.6 + i * 2, -0.9));
    expect(bandedFillWall(face, [face, partner, ...fill(12), ...across], [], fpu)).toBeNull();
  });
  it("refuses a notes panel: rules with lettering between them", () => {
    expect(bandedFillWall(face, [face, partner, ...fill(12)], [{ x: 5, y: 0.5 }], fpu)).toBeNull();
  });
  it("needs a partner inside the band's bounds and something filling it", () => {
    expect(bandedFillWall(face, [face, seg(0, 2, 20, 2), ...fill(12, 0.1, 1.9)], [], fpu)).toBeNull();
    expect(bandedFillWall(face, [face, partner, ...fill(2)], [], fpu)).toBeNull();
  });
});
