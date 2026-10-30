import { describe, expect, it } from "vitest";
import { legendBoxes } from "./legendBoxes";

// One unit = one foot.
const fpu = 1;
const run = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
const frame = (x0: number, y0: number, x1: number, y1: number) => [run(x0, y0, x1, y0), run(x0, y1, x1, y1), run(x0, y0, x0, y1), run(x1, y0, x1, y1)];

describe("legendBoxes", () => {
  it("sets aside a framed block with a legend title, sides and the sample lines inside", () => {
    const box = frame(0, 0, 40, 20);
    const sample = run(5, 8, 12, 8); // the "NEW WALL" sample drawn inside the legend
    const words = [{ x: 20, y: 2, str: "FLOOR PLAN LEGEND" }, { x: 20, y: 8, str: "NEW WALL" }];
    const got = legendBoxes([...box, sample], words, fpu);
    expect(got.boxes).toHaveLength(1);
    expect(got.boxes[0].why).toContain("FLOOR PLAN LEGEND");
    expect(box.every((s) => got.sides.has(s))).toBe(true);
    expect(got.inside.has(sample)).toBe(true);
  });
  it("never a room: dense labels are not a schedule — nine kennel runs in a row stay walls", () => {
    const row = frame(0, 0, 56, 6);
    const words = Array.from({ length: 27 }, (_, i) => ({ x: 2 + (i % 9) * 6, y: 2 + Math.floor(i / 9) * 1.5, str: i < 9 ? `RUN ${i + 1}` : `label${i}`, h: 1 }));
    expect(legendBoxes(row, words, fpu).boxes).toHaveLength(0);
  });
  it("the title has to be a heading in large type, not a note in body type", () => {
    const room = frame(0, 0, 20, 15);
    const body = [{ x: 10, y: 2, str: "SEE NOTES", h: 1 }, { x: 10, y: 7, str: "OFFICE", h: 1 }, { x: 10, y: 8, str: "101", h: 1 }];
    expect(legendBoxes(room, body, fpu).boxes).toHaveLength(0);
    const heading = [{ x: 10, y: 2, str: "GENERAL PLAN NOTES", h: 3 }, ...body];
    expect(legendBoxes(room, heading, fpu).boxes).toHaveLength(1);
  });
  it("never a room: a name and a number are not a title and not dense", () => {
    const room = frame(0, 0, 20, 15);
    const words = [{ x: 10, y: 7, str: "OFFICE" }, { x: 10, y: 8.5, str: "101" }, { x: 4, y: 3, str: "TABLE" }];
    const got = legendBoxes(room, words, fpu);
    expect(got.boxes).toHaveLength(0);
    expect(got.sides.size).toBe(0);
  });
  it("closes on one rail: two uprights and a bottom are a frame, one upright is not", () => {
    const [top, bottom, left, right] = frame(0, 0, 40, 20);
    const words = [{ x: 20, y: 2, str: "KEYNOTES" }];
    const threeSided = legendBoxes([bottom, left, right], words, fpu);
    expect(threeSided.boxes).toHaveLength(1);
    expect(threeSided.sides.size).toBe(3);
    expect(legendBoxes([top, bottom, left], words, fpu).boxes).toHaveLength(0);
  });
});
