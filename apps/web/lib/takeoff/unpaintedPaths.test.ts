import { describe, expect, it } from "vitest";
import { segmentsFromOpenPage } from "./sheetStrokes";

/**
 * A path followed by a clip (`W n`, `W* n`) or a bare `n` paints nothing. It
 * is on the page and not on the sheet, and the reader must not turn it into
 * lines — the same position as an OFF layer. pdf.js is stubbed the way
 * `flattenCubic.test.ts` stubs it: an operator list handed straight in.
 */
const OPS = { moveTo: 13, lineTo: 14, rectangle: 19, constructPath: 91, stroke: 20, fill: 22, eoFill: 23, fillStroke: 24, endPath: 28, clip: 29, eoClip: 30, save: 10, restore: 11, setLineWidth: 2, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, setFillGray: 60, setStrokeGray: 59 };
const Util = {
  transform: (a: number[], b: number[]) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]],
  applyTransform: (p: number[], m: number[]) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]],
};
const line = (y: number) => [[OPS.moveTo, OPS.lineTo], [0, y, 100, y]];
function page(paintedBy: number[]) {
  const fnArray: number[] = []; const argsArray: unknown[] = [];
  paintedBy.forEach((op, i) => { fnArray.push(OPS.constructPath, op); argsArray.push(line(10 * (i + 1)), null); });
  return { getViewport: () => ({ transform: [1, 0, 0, 1, 0, 0], width: 100, height: 100 }), getOperatorList: async () => ({ fnArray, argsArray }) };
}

describe("a path that paints nothing was never on the sheet", () => {
  it("READS A STROKED AND A FILLED PATH, AND NOT A CLIPPED OR AN ENDED ONE", async () => {
    const out = await segmentsFromOpenPage(page([OPS.stroke, OPS.fill, OPS.clip, OPS.eoClip, OPS.endPath]), { OPS, Util }, 1);
    expect(out.segments.map((s) => s.y1)).toEqual([10, 20]);
    expect(out.unpaintedPaths).toBe(3);
    // the control still reports what the page carried
    expect(out.pathOperators).toBe(5);
  });

  it("a page with no clip paths counts none", async () => {
    const out = await segmentsFromOpenPage(page([OPS.stroke, OPS.stroke]), { OPS, Util }, 1);
    expect(out.unpaintedPaths).toBe(0);
    expect(out.segments).toHaveLength(2);
  });
});

describe("the edges of a FILLED path carry the fill's luminance", () => {
  it("marks a filled, an even-odd-filled and a fill-and-stroked path with the fill colour in force, and leaves a stroked one unmarked", async () => {
    // set fill grey 0.75 · fill · stroke · save · set fill grey 0.2 · eoFill · restore · fillStroke (back to 0.75)
    const fnArray: number[] = []; const argsArray: unknown[] = [];
    const push = (fn: number, args: unknown = null) => { fnArray.push(fn); argsArray.push(args); };
    push(OPS.setFillGray, [0.75]);
    push(OPS.constructPath, line(10)); push(OPS.fill);
    push(OPS.constructPath, line(20)); push(OPS.stroke);
    push(OPS.save); push(OPS.setFillGray, [0.2]);
    push(OPS.constructPath, line(30)); push(OPS.eoFill);
    push(OPS.restore);
    push(OPS.constructPath, line(40)); push(OPS.fillStroke);
    const pg = { getViewport: () => ({ transform: [1, 0, 0, 1, 0, 0], width: 100, height: 100 }), getOperatorList: async () => ({ fnArray, argsArray }) };
    const out = await segmentsFromOpenPage(pg, { OPS, Util }, 1);
    expect(out.segments.map((s) => [s.y1, s.fill])).toEqual([[10, 0.75], [20, undefined], [30, 0.2], [40, 0.75]]);
  });
  it("a filled path with no fill colour set is black, PDF's default", async () => {
    const out = await segmentsFromOpenPage(page([OPS.fill]), { OPS, Util }, 1);
    expect(out.segments[0].fill).toBe(0);
  });
});
