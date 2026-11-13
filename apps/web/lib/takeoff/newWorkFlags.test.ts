import { describe, expect, it } from "vitest";
import { flaggedRuns } from "./newWorkFlags";
import type { StrokeSegment } from "./wallVectors";

// Page 1000 pt wide; 1 page-width unit = 100 ft, so 1 pt = 0.1 ft.
const W = 1000, FPU = 100;
const wall = { x1: 0.2, y1: 0.1, x2: 0.2, y2: 0.5, thicknessFeet: 0.5 }; // vertical wall at x = 200 pt, 5 pt thick
const other = { x1: 0.6, y1: 0.1, x2: 0.6, y2: 0.5, thicknessFeet: 0.5 };
/** A filled bar from x0 to x1 at height y, 4.5 pt thick. */
const bar = (x0: number, x1: number, y: number): StrokeSegment[] => [
  { x1: x0, y1: y - 2.25, x2: x1, y2: y - 2.25, fill: 0 },
  { x1: x1, y1: y + 2.25, x2: x0, y2: y + 2.25, fill: 0 },
];
const code = (str: string, x: number, y: number) => ({ str, x, y: y + 4, width: 11, height: 9 });

describe("flaggedRuns", () => {
  it("names the wall a bar touches, with the code beyond its outer end", () => {
    const got = flaggedRuns([wall, other], bar(202.5, 220, 300), [code("F2", 235, 296)], W, FPU);
    expect([...got]).toEqual([wall]);
  });
  it("names nothing without a code on the bar's line", () => {
    expect(flaggedRuns([wall], bar(202.5, 220, 300), [code("F2", 235, 360)], W, FPU).size).toBe(0);
    expect(flaggedRuns([wall], bar(202.5, 220, 300), [code("118", 235, 296)], W, FPU).size).toBe(0);
  });
  it("names nothing when the bar does not touch a wall, or is not filled", () => {
    expect(flaggedRuns([wall], bar(230, 248, 300), [code("F2", 262, 296)], W, FPU).size).toBe(0);
    const open = bar(202.5, 220, 300).map((s) => ({ ...s, fill: undefined }));
    expect(flaggedRuns([wall], open, [code("F2", 235, 296)], W, FPU).size).toBe(0);
  });
  it("ignores a bar running along the wall", () => {
    const along: StrokeSegment[] = [{ x1: 197.75, y1: 300, x2: 197.75, y2: 318, fill: 0 }, { x1: 202.25, y1: 318, x2: 202.25, y2: 300, fill: 0 }];
    expect(flaggedRuns([wall], along, [{ str: "F2", x: 194.5, y: 340, width: 11, height: 9 }], W, FPU).size).toBe(0);
  });
});
