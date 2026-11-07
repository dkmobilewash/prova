import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { angleOf, lengthOf, segmentGeometry, type StrokeSegment } from "./wallVectors";

describe("each stroke's direction and length, computed once per array (ELEVEN03: 1.6 s of a 7 s sheet)", () => {
  const strokes: StrokeSegment[] = [
    { x1: 0, y1: 0, x2: 3, y2: 4 },
    { x1: 10, y1: 5, x2: 2, y2: 5 },
    { x1: 1, y1: 1, x2: 1, y2: 1 },
    { x1: 0.123, y1: 0.456, x2: 0.789, y2: 0.012 },
  ];

  it("is exactly what angleOf and lengthOf give, bit for bit", () => {
    const g = segmentGeometry(strokes);
    strokes.forEach((s, k) => {
      expect(Object.is(g.length[k], lengthOf(s))).toBe(true);
      expect(Object.is(g.angle[k], angleOf(s))).toBe(true);
    });
    expect(segmentGeometry(strokes)).toBe(g);
  });

  it("is rebuilt when the array grows, never read stale", () => {
    const grown = [...strokes];
    const before = segmentGeometry(grown);
    grown.push({ x1: 0, y1: 0, x2: 0, y2: 7 });
    const after = segmentGeometry(grown);
    expect(after).not.toBe(before);
    expect(after.length[4]).toBe(7);
  });
});

describe("Run takeoff gives the server a turn between its heavy phases", () => {
  it("yields before the finder, before the set-asides and before the grouping", () => {
    const source = readFileSync(new URL("./detectWallsForCalibration.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    expect(source).toMatch(/await yieldToRequests\(\);\s*const detected = detectForSheet\(/);
    expect(source).toMatch(/await yieldToRequests\(\);\s*let offered = offer\(\);/);
    expect(source).toMatch(/await yieldToRequests\(\);\s*const found = \{ \.\.\.detected\.found/);
    expect(source).toMatch(/function yieldToRequests\(\): Promise<void> \{\s*return new Promise\(\(resolve\) => setImmediate\(resolve\)\);/);
  });
});
