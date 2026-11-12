import { describe, expect, it } from "vitest";
import { planTextTagByRun } from "./planTextTags";
import type { WallCandidate } from "./wallVectors";

// The switch reaches the tag reader the stage uses (`groupsForStage` → `planTextTagByRun` → `tagByRun`).
const FOOT = 1 / 288;
const wall = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * 288, thicknessFeet: 4.75 / 12 }) as WallCandidate;
const along = wall(0.2, 0.5, 0.3, 0.5);
const around = wall(0.3, 0.5 + 1.5 * FOOT, 0.3, 0.6);
const read = (midSpan?: boolean) =>
  planTextTagByRun({ segments: [], text: [], widthPt: 2592, walls: [along, around], feetPerUnit: 288, legendCodes: ["3B"], textTags: [{ name: "3B", x: 0.3 - 1.2 * FOOT, y: 0.5 + FOOT }], wallTypes: [], ...(midSpan === undefined ? {} : { midSpan }) });

describe("planTextTagByRun passes the mid-span switch on", () => {
  it("off by default; on, the tag at the corner names the run it falls beside", () => {
    expect(read().byRun.size).toBe(0);
    expect(read(true).byRun.get(along)).toBe("3B");
  });
});
