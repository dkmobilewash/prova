import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FoundOnSheet } from "./findWallsOnSheet";
import { stageTypeGroups } from "./stageGroups";
import type { MatchableWallType } from "./wallTypeMatch";
import type { WallCandidate } from "./wallVectors";

// The WALLS stage's type groups and the types table's are one function, so the exam scores what is posted.
const FPU = 288, W = 2592, FOOT = 1 / FPU;
const run = wall(0.2, 0.5, 0.3, 0.5);
function wall(x1: number, y1: number, x2: number, y2: number) {
  return { x1, y1, x2, y2, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU, thicknessFeet: 4.75 / 12 } as WallCandidate;
}
const types: MatchableWallType[] = [{ id: "A1", code: "A1", name: "A1", hasParts: true, thicknessIn: 4.75 }, { id: "A2", code: "A2", name: "A2", hasParts: true, thicknessIn: 4.75 }];
const found = { walls: [run], inUnits: [], groups: [] } as unknown as FoundOnSheet;
const tagAt = (str: string) => ({ str, x: 0.25 * W, y: (0.5 + 0.5 * FOOT) * W, width: 0, height: 0 });
const base = { found, segmentsPt: [], widthPt: W, feetPerUnit: FPU, wallTypes: types, legendCodes: ["A1", "A2"], vocabulary: ["A1", "A2"], fromText: false, scanned: false };

describe("stageTypeGroups", () => {
  it("a sheet that prints no tag reads them off its sibling, marked as read elsewhere; a sheet with tags never asks", async () => {
    let asked = 0;
    const sibling = { segmentsPt: [], textItems: [tagAt("A2")], widthPt: W };
    const noTags = await stageTypeGroups({ ...base, textItems: [], siblings: async () => { asked += 1; return [7]; }, readSibling: async () => sibling });
    expect(asked).toBe(1);
    // No views to align on (no strokes), so the sibling is refused and the run stays untyped: never a guess.
    expect(noTags.some((g) => g.source.kind === "TAG")).toBe(false);
    const tagged = await stageTypeGroups({ ...base, textItems: [tagAt("A1")], siblings: async () => { asked += 1; return [7]; }, readSibling: async () => sibling });
    expect(asked).toBe(1);
    expect(tagged.find((g) => g.runs.includes(run))?.source).toEqual({ kind: "TAG", tag: "A1" });
  });

  it("a scanned sheet and the finder's own grouping never read a sibling", async () => {
    let asked = 0;
    const siblings = async () => { asked += 1; return [7]; };
    await stageTypeGroups({ ...base, textItems: [], scanned: true, siblings, readSibling: async () => null });
    await stageTypeGroups({ ...base, textItems: [], finderGroups: [], siblings, readSibling: async () => null });
    expect(asked).toBe(0);
  });

  it("a text-read legend's code the sheet prints beside a wall is trusted and tags it, as with a model-read legend", async () => {
    const read = (fromText: boolean) => stageTypeGroups({ ...base, fromText, textItems: [tagAt("A1")], siblings: async () => [], readSibling: async () => null });
    for (const fromText of [false, true]) expect((await read(fromText)).find((g) => g.runs.includes(run))?.source).toEqual({ kind: "TAG", tag: "A1" });
  });

  it("is what both the WALLS stage and the types table call", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    for (const file of ["./detectWallsForCalibration.ts", "./realplan/zzTypeTable.eval.ts"]) expect(read(file), file).toMatch(/await stageTypeGroups\(\{/);
    // The table groups the runs the product offers (set-asides, the demolition compare), not the finder's raw runs.
    expect(read("./realplan/zzTypeTable.eval.ts")).toMatch(/productSheetRuns\(\{ detected/);
  });
});
