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
  it("refuses a grey face, a grey partner, and a band marked existing", () => {
    expect(bandedFillWall({ ...face, gray: 0.6 }, [face, partner, ...fill(12)], [], fpu)).toBeNull();
    expect(bandedFillWall(face, [face, { ...partner, gray: 0.6 }, ...fill(12)], [], fpu)).toBeNull();
    expect(bandedFillWall(face, [face, partner, ...fill(12)], [{ x: 10, y: -1, str: "(E)" }], fpu)).toBeNull();
    expect(bandedFillWall(face, [face, partner, ...fill(12)], [{ x: 10, y: -1, str: "EXIST. CMU" }], fpu)).toBeNull();
    // the same word four feet away is about something else
    expect(bandedFillWall(face, [face, partner, ...fill(12)], [{ x: 10, y: -4, str: "(E)" }], fpu)).not.toBeNull();
    // a black 20 in masonry band is a wall
    const wide = seg(0, 20 / 12, 20, 20 / 12);
    expect(bandedFillWall(face, [face, wide, ...fill(12, 0.1, 20 / 12 - 0.1)], [], fpu)?.thicknessFeet).toBeCloseTo(20 / 12, 2);
  });
  it("needs an end at a found wall when walls are given: masonry attaches, a gondola floats", () => {
    const strokes = [face, partner, ...fill(12)];
    const corridor = { x1: -0.5, y1: -5, x2: -0.5, y2: 5 };
    expect(bandedFillWall(face, strokes, [], fpu, [corridor])).not.toBeNull();
    const farAway = { x1: 40, y1: -5, x2: 40, y2: 5 };
    expect(bandedFillWall(face, strokes, [], fpu, [farAway])).toBeNull();
    expect(bandedFillWall(face, strokes, [], fpu, [])).toBeNull();
  });
  it("refuses a notes panel: rules with lettering between them", () => {
    expect(bandedFillWall(face, [face, partner, ...fill(12)], [{ x: 5, y: 0.5 }], fpu)).toBeNull();
  });
  it("needs a partner inside the band's bounds and something filling it", () => {
    // 36 in is past the widest masonry this admits
    expect(bandedFillWall(face, [face, seg(0, 3, 20, 3), ...fill(12, 0.1, 2.9)], [], fpu)).toBeNull();
    expect(bandedFillWall(face, [face, partner, ...fill(2)], [], fpu)).toBeNull();
  });
});
