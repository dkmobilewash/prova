import { describe, expect, it } from "vitest";
import { keynoteItems, printedTagCodes } from "./planTextTags";
import type { StrokeSegment } from "./wallVectors";

// A symbol drawn as a closed polygon of `sides` around (cx, cy), in points.
const polygon = (cx: number, cy: number, sides: number, r = 9, turn = Math.PI / sides): StrokeSegment[] =>
  Array.from({ length: sides }, (_, k) => {
    const a = turn + (2 * Math.PI * k) / sides, b = turn + (2 * Math.PI * (k + 1)) / sides;
    return { x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b) } as StrokeSegment;
  });
// A text item whose centre is (cx, cy): `y` the baseline, as the page text gives it.
const word = (str: string, cx: number, cy: number) => ({ str, x: cx - 3, y: cy + 3.5, width: 6, height: 7 });
// A sheet's numbered list: 1..n down one column.
const list = (n: number) => Array.from({ length: n }, (_, k) => word(String(k + 1), 40, 100 + 18 * k));

describe("keynotes are not wall tags (no legend)", () => {
  it("Bunkie's shape: a list 1–5 and hexagons holding 1–5 on the plan, wall tags in squares → 1–5 dropped, the tags kept", () => {
    const plan = [1, 2, 3, 4, 5].map((n) => [n, 300 + 60 * n, 400] as const);
    const segments = [...plan.flatMap(([, x, y]) => polygon(x, y, 6)), ...polygon(300, 600, 4, 9, Math.PI / 4), ...polygon(400, 600, 4, 9, Math.PI / 4)];
    const text = [...list(5), ...plan.map(([n, x, y]) => word(String(n), x, y)), word("P8", 300, 600), word("P8", 400, 600)];
    expect(keynoteItems(text, segments).size).toBe(10);
    expect(printedTagCodes(text, segments)).toEqual(["P8"]);
    // Without the line work nothing is known about the shapes, and the old count stands.
    expect(printedTagCodes(text)).toEqual(["1", "2", "3", "4", "5", "P8"]);
  });
  it("numbers in the SAME shape as the sheet's wall tags are not keynotes: kept", () => {
    const sq = (x: number, y: number) => polygon(x, y, 4, 9, Math.PI / 4);
    const plan = [1, 2, 3, 4, 5].map((n) => [n, 300 + 60 * n, 400] as const);
    const segments = [...plan.flatMap(([, x, y]) => sq(x, y)), ...sq(300, 600), ...sq(400, 600)];
    const text = [...list(5), ...plan.map(([n, x, y]) => word(String(n), x, y)), word("P8", 300, 600), word("P8", 400, 600)];
    expect(keynoteItems(text, segments).size).toBe(0);
  });
  it("Totem's shape: 1–3 listed and in pentagons — three listed numbers is not a keynote shape, so they stay", () => {
    const plan = [1, 2, 3].map((n) => [n, 300 + 60 * n, 400] as const);
    const segments = plan.flatMap(([, x, y]) => polygon(x, y, 5));
    const text = [...list(4), ...plan.map(([n, x, y]) => word(String(n), x, y))];
    expect(keynoteItems(text, segments).size).toBe(0);
    expect(printedTagCodes(text, segments)).toEqual(["1", "2", "3"]);
  });
});
