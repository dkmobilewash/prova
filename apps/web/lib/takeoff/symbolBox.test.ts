import { describe, expect, it } from "vitest";
import { symbolsInBox } from "./symbolBox";
import type { StrokeSegment } from "./wallVectors";

// A circle of radius r at (cx, cy), as 16 chords: what a fixture symbol is on a sheet.
const circle = (cx: number, cy: number, r: number, n = 16): StrokeSegment[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI;
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
  it("leaves out grey ink, a ceiling grid's, when the box holds black", () => {
    const grey = circle(0.512, 0.5, 0.004).map((seg) => ({ ...seg, gray: 0.6 }));
    expect(symbolsInBox([...circle(0.5, 0.5, 0.004), ...grey], [], box(0.506, 0.5, 0.012)).kind).toBe("one");
  });
  it("finds nothing in an empty box", () => {
    expect(symbolsInBox(circle(0.5, 0.5, 0.004), [], box(0.2, 0.2, 0.01)).kind).toBe("none");
  });
  // A 2x4 troffer: a 0.014 x 0.007 rectangle with a small lamp in the middle.
  const troffer = (cx: number, cy: number): StrokeSegment[] => [
    { x1: cx - 0.007, y1: cy - 0.0035, x2: cx + 0.007, y2: cy - 0.0035 },
    { x1: cx - 0.007, y1: cy + 0.0035, x2: cx + 0.007, y2: cy + 0.0035 },
    { x1: cx - 0.007, y1: cy - 0.0035, x2: cx - 0.007, y2: cy + 0.0035 },
    { x1: cx + 0.007, y1: cy - 0.0035, x2: cx + 0.007, y2: cy + 0.0035 },
    ...circle(cx, cy, 0.0006),
  ];
  it("takes a box drawn inside a troffer's ends as the troffer, not two lines and a lamp", () => {
    // The box cuts the short sides off: the long sides are left as two lines.
    const found = symbolsInBox(troffer(0.5, 0.5), [], { x1: 0.494, y1: 0.4955, x2: 0.506, y2: 0.5045 });
    expect(found.kind).toBe("one");
    if (found.kind === "one") expect(found.box.x2 - found.box.x1).toBeGreaterThan(0.014);
  });
  it("counts the symbol wholly inside, not a bigger neighbour the box clips", () => {
    // Its strokes that reach into the box run on out of it, as a real neighbour's do.
    const ink = [...circle(0.5, 0.5, 0.002), ...circle(0.5085, 0.5, 0.0045, 8)];
    const found = symbolsInBox(ink, [], box(0.502, 0.5, 0.005));
    expect(found.kind).toBe("one");
    if (found.kind === "one") expect((found.box.x1 + found.box.x2) / 2).toBeCloseTo(0.5, 3);
  });
  it("drops a strip of lettering drawn as paths beside the symbol", () => {
    const letters = Array.from({ length: 20 }, (_, i) => ({ x1: 0.4935 + i * 0.0006, y1: 0.5045, x2: 0.4938 + i * 0.0006, y2: 0.5052 }));
    const found = symbolsInBox([...troffer(0.5, 0.5), ...letters], [], box(0.5, 0.501, 0.01));
    expect(found.kind).toBe("one");
    const plain = symbolsInBox(troffer(0.5, 0.5), [], box(0.5, 0.501, 0.01));
    expect(found).toEqual(plain);
  });
});
