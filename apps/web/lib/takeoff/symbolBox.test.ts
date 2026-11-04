import { describe, expect, it } from "vitest";
import { symbolsInBox } from "./symbolBox";
import type { StrokeSegment } from "./wallVectors";

// A circle of radius r at (cx, cy), as 16 chords: what a fixture symbol is on a sheet.
const circle = (cx: number, cy: number, r: number): StrokeSegment[] =>
  Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * 2 * Math.PI, b = ((i + 1) / 16) * 2 * Math.PI;
    return { x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b) };
  });
const box = (cx: number, cy: number, h: number) => ({ x1: cx - h, y1: cy - h, x2: cx + h, y2: cy + h });

describe("the symbol in a box", () => {
  it("is the same tight box however loosely it was drawn", () => {
    const ink = circle(0.5, 0.5, 0.004);
    const tight = [0.006, 0.01, 0.02].map((h) => symbolsInBox(ink, [], box(0.5 + h / 3, 0.5 - h / 4, h)));
    for (const t of tight) expect(t.kind).toBe("one");
    const boxes = tight.map((t) => (t.kind === "one" ? t.box : null));
    expect(new Set(boxes.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(boxes[0]!.x2 - boxes[0]!.x1).toBeLessThan(0.012);
  });
  it("ignores a wall running through the box and a speck beside the symbol", () => {
    const ink = [...circle(0.5, 0.5, 0.004), { x1: 0.4, y1: 0.51, x2: 0.6, y2: 0.51 }, { x1: 0.512, y1: 0.49, x2: 0.5125, y2: 0.49 }];
    const found = symbolsInBox(ink, [], box(0.5, 0.5, 0.015));
    expect(found.kind).toBe("one");
    if (found.kind === "one") expect(found.box.x2 - found.box.x1).toBeLessThan(0.012);
  });
  it("ignores the lettering in the box", () => {
    const ink = [...circle(0.5, 0.5, 0.004), ...circle(0.512, 0.5, 0.001)];
    const text = [{ x: 0.5105, y: 0.4985, width: 0.003, height: 0.003, str: "a" }];
    expect(symbolsInBox(ink, text, box(0.505, 0.5, 0.012)).kind).toBe("one");
  });
  it("asks which when the box holds two symbols, nearest the middle first", () => {
    const ink = [...circle(0.5, 0.5, 0.004), ...circle(0.515, 0.5, 0.004)];
    const found = symbolsInBox(ink, [], box(0.512, 0.5, 0.012));
    expect(found.kind).toBe("several");
    if (found.kind === "several") {
      expect(found.boxes).toHaveLength(2);
      expect((found.boxes[0]!.x1 + found.boxes[0]!.x2) / 2).toBeCloseTo(0.515, 3);
    }
  });
  it("finds nothing in an empty box", () => {
    expect(symbolsInBox(circle(0.5, 0.5, 0.004), [], box(0.2, 0.2, 0.01)).kind).toBe("none");
  });
});
