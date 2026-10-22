import { describe, expect, it } from "vitest";
import { drawingRegions, insideRegions, segmentsInRegions, type Region } from "./planRegion";
import type { StrokeSegment } from "./wallVectors";

const W = 1000;

/** `n` strokes scattered inside a region, in POINT coordinates. */
function fill(region: Region, n: number): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i + 0.5) / n;
    const x = (region.from + (region.to - region.from) * t) * W;
    const y = (region.fromY + (region.toY - region.fromY) * t) * W;
    out.push({ x1: x, y1: y, x2: x + 2, y2: y + 2 });
  }
  return out;
}

const drawing: Region = { from: 0.068, to: 0.897, fromY: 0, toY: 0.667 };
const titleBlock: Region = { from: 0.897, to: 1, fromY: 0, toY: 0.667 };
const dimensionStrip: Region = { from: 0, to: 0.068, fromY: 0, toY: 0.667 };

describe("which part of a one-drawing sheet is the drawing", () => {
  it("KEEPS THE DRAWING AND DROPS THE TITLE BLOCK", () => {
    // A102's own proportions: 135,042 strokes against 8,395 and 1.
    const segments = [
      ...fill(drawing, 1350),
      ...fill(titleBlock, 84),
      ...fill(dimensionStrip, 1),
    ];
    const kept = drawingRegions([dimensionStrip, drawing, titleBlock], segments, W);
    expect(kept).toHaveLength(1);
    expect(kept[0].from).toBeCloseTo(0.068, 3);
  });

  it("keeps a plan split in two by an internal gutter", () => {
    // A courtyard or a wide corridor of white space cuts a plan in two, and
    // both halves are the drawing. This is why the test is relative rather
    // than "keep the biggest".
    const left: Region = { from: 0.05, to: 0.45, fromY: 0, toY: 0.667 };
    const right: Region = { from: 0.55, to: 0.95, fromY: 0, toY: 0.667 };
    const segments = [...fill(left, 600), ...fill(right, 500)];
    expect(drawingRegions([left, right], segments, W)).toHaveLength(2);
  });

  it("returns everything when there is only one region to choose from", () => {
    const only: Region = { from: 0, to: 1, fromY: 0, toY: 0.667 };
    expect(drawingRegions([only], fill(only, 100), W)).toEqual([only]);
  });

  it("returns everything when nothing is drawn, rather than nothing", () => {
    // A filter that cannot tell must not pretend to: returning no regions
    // would measure an empty sheet and report zero feet with no explanation.
    expect(drawingRegions([dimensionStrip, drawing], [], W)).toHaveLength(2);
  });

  it("never returns an empty set", () => {
    const tiny = [...fill(drawing, 1)];
    expect(drawingRegions([dimensionStrip, drawing, titleBlock], tiny, W).length).toBeGreaterThan(0);
  });

  it("clips the strokes to what it kept", () => {
    const segments = [...fill(drawing, 100), ...fill(titleBlock, 2)];
    const kept = drawingRegions([drawing, titleBlock], segments, W);
    const clipped = segmentsInRegions(segments, kept, W);
    expect(clipped.length).toBe(100);
  });

  it("treats no regions as no clipping", () => {
    const segments = fill(drawing, 10);
    expect(segmentsInRegions(segments, [], W)).toHaveLength(10);
    expect(insideRegions([], 0.99, 0.5)).toBe(true);
  });
});
