import { describe, expect, it } from "vitest";
import { demoDoors, demoForSheet, demoRuns, demoSheetTitle } from "./demoWalls";
import { existingWallSet } from "./existingWallSet";
import { recipeLines } from "../takeoff-recipes";
import type { StrokeSegment } from "./wallVectors";

const W = 2592, FPU = 288; // 36 in sheet at 1/8": 1 ft = 9 pt, 1 paper inch = 72 pt

/** A horizontal dashed line in points: 7 pt dash, 5 pt gap. */
function dashed(x0: number, x1: number, y: number, width = 0.5, offset = 0): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let x = x0 + offset; x + 7 <= x1; x += 12) out.push({ x1: x, y1: y, x2: x + 7, y2: y, width } as StrokeSegment);
  return out;
}
const solid = (x0: number, x1: number, y: number) => ({ x1: x0, y1: y, x2: x1, y2: y, width: 0.5 }) as StrokeSegment;

describe("demoRuns", () => {
  it("reads two dashed lines a wall apart as one run, with its length and thickness", () => {
    const runs = demoRuns([...dashed(100, 460, 300), ...dashed(100, 460, 303.75)], W, FPU);
    expect(runs).toHaveLength(1);
    expect(runs[0].lengthFeet).toBeGreaterThan(38);
    expect(runs[0].lengthFeet).toBeLessThanOrEqual(40);
    expect(runs[0].thicknessIn).toBeCloseTo(5, 0);
  });
  it("leaves out a lone dashed line, two solid lines, and dashes too far apart to be one wall", () => {
    expect(demoRuns(dashed(100, 460, 300), W, FPU)).toEqual([]);
    expect(demoRuns([solid(100, 460, 300), solid(100, 460, 303.75)], W, FPU)).toEqual([]);
    expect(demoRuns([...dashed(100, 460, 300), ...dashed(100, 460, 330)], W, FPU)).toEqual([]);
  });
  it("one wall drawn twice in two pens with offset dashes is still one run", () => {
    const pens = [...dashed(100, 460, 300, 0.96), ...dashed(100, 460, 303.75, 0.96), ...dashed(100, 460, 300, 0.48, 6), ...dashed(100, 460, 303.75, 0.48, 6)];
    expect(demoRuns(pens, W, FPU)).toHaveLength(1);
  });
  it("a strip with hatching across it is not a wall", () => {
    const hatch: StrokeSegment[] = [];
    for (let x = 100; x < 460; x += 6) hatch.push({ x1: x, y1: 299.5, x2: x + 4, y2: 304.25, width: 0.25 } as StrokeSegment);
    expect(demoRuns([...dashed(100, 460, 300), ...dashed(100, 460, 303.75), ...hatch], W, FPU)).toEqual([]);
  });
  it("a legend's sample beside its words is not a wall", () => {
    const sample = [...dashed(100, 160, 300), ...dashed(100, 160, 303.75)];
    expect(demoRuns(sample, W, FPU)).toHaveLength(1);
    expect(demoRuns(sample, W, FPU, [{ str: "REMOVE / DEMOLISH", x: 190, y: 305, height: 8 }])).toEqual([]);
  });
});

describe("demoDoors", () => {
  const word = (str: string, x: number, y: number) => ({ str, x, y, width: str.length * 5, height: 8 });
  const titleBlock = word("A101", 2400, 1700);
  it("counts the tags of the keynote that removes a door, and not one that keeps a door", () => {
    const items = [word("20", 1000, 100), word("REMOVE (E) DOOR AND FRAME", 1030, 100), word("11", 1000, 120), word("(E) DOOR TO REMAIN", 1030, 120), word("20", 300, 500), word("20", 600, 700), word("11", 400, 400), titleBlock];
    const { doors, typical } = demoDoors(items, W);
    expect(doors.map((d) => d.code)).toEqual(["20", "20"]);
    expect(typical).toBe(false);
  });
  it("does not count a border number or a revision list that happens to match the code", () => {
    const items = [word("2", 1000, 100), word("REMOVE EXISTING DOOR", 1030, 100), word("2", 300, 500), word("2", 1200, 10), word("2", 900, 1000), word("3", 900, 1012), word("1", 900, 988)];
    expect(demoDoors(items, W).doors.map((d) => Math.round(d.x * W))).toEqual([303]);
  });
  it("leaves door hardware out, and flags TYP. as an undercount", () => {
    expect(demoDoors([word("D9", 1000, 100), word("REMOVE EXISTING DOOR HARDWARE", 1030, 100), word("D9", 300, 500), titleBlock], W).doors).toEqual([]);
    expect(demoDoors([word("20", 1000, 100), word("REMOVE (E) DOOR", 1030, 100), word("20", 300, 500), word("TYP.", 300, 510), titleBlock], W).typical).toBe(true);
  });
});

describe("the rest of the demolition path", () => {
  it("a sheet says it is demolition by title or number", () => {
    expect(["A1.1 · DEMOLITION - FLOOR PLAN", "D100", "AD101", "D-1", "BASEMENT DEMO"].every(demoSheetTitle)).toBe(true);
    expect(["A101 · FLOOR PLAN", "E2.01", null].some(demoSheetTitle)).toBe(false);
  });
  it("a run inside a section view is left out", () => {
    const strokes = [...dashed(100, 460, 300), ...dashed(100, 460, 303.75)];
    const words = [{ str: "1 WALL SECTION - DEMOLITION", x: 100, y: 340, width: 200, height: 14 }];
    expect(demoForSheet({ segments: strokes, textItems: [], widthPt: W, heightPt: 1728, feetPerUnit: FPU }).runs).toHaveLength(1);
    expect(demoForSheet({ segments: strokes, textItems: words, widthPt: W, heightPt: 1728, feetPerUnit: FPU }).runs.length).toBeLessThanOrEqual(1);
  });
  it("the recipe posts demo lines by type, in lf and ea, and as labor", () => {
    expect(
      recipeLines("demolition", [{ kind: "linear", feet: 10, item: "Demo wall W1" }, { kind: "linear", feet: 5.5, item: "Demo wall W1" }, { kind: "linear", feet: 3 }, { kind: "count", count: 2, item: "Remove door and frame" }], {}),
    ).toEqual([
      { label: "Demo wall W1", quantity: 15.5, unit: "lf" },
      { label: "Demo wall", quantity: 3, unit: "lf" },
      { label: "Remove door and frame", quantity: 2, unit: "ea" },
    ]);
  });
  it("the existing set moves onto the new plan, and says when it could not", () => {
    const wall = (x: number, y: number, len: number) => ({ x1: x, y1: y, x2: x + len, y2: y, lengthFeet: len * FPU, thicknessIn: 5 });
    const remove = [wall(0.1, 0.1, 0.1), wall(0.1, 0.2, 0.15), wall(0.1, 0.3, 0.2)];
    const newPlan = remove.map((w) => ({ x1: w.x1 + 0.4, y1: w.y1 + 0.05, x2: w.x2 + 0.4, y2: w.y2 + 0.05 }));
    const aligned = existingWallSet({ level: "Level 1", remove, remain: [], newPlan, feetPerUnit: FPU });
    expect(aligned.shift?.dx).toBeCloseTo(0.4);
    expect(aligned.walls[0].x1).toBeCloseTo(0.5);
    expect(aligned.walls[0].fate).toBe("remove");
    const lost = existingWallSet({ level: null, remove, remain: [], newPlan: [], feetPerUnit: FPU });
    expect(lost.shift).toBeNull();
    expect(lost.walls[0].x1).toBeCloseTo(0.1);
  });
});
