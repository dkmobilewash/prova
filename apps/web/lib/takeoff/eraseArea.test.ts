import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { offeredCandidates } from "./offeredCandidates";
import { eraseInBoxes, userExclusionsFromRows } from "./userExclusions";
import type { WallCandidate } from "./wallVectors";

/**
 * "Erase walls in this area" (coordination/erase-area-tool.md, W2 item 2). E1: ONE predicate for the product and the
 * eval, the second's ceiling `inside()` (eval-out-second/erase-area/boxes.py): a run goes when its centreline points at
 * 25%, 50% and 75% are all inside a box (edges inclusive). Whole runs only — never clipped — because the ceiling's 14 ft
 * of real wall is a measurement of exactly that.
 */
const FPU = 100;
const ft = (n: number) => n / FPU;
const wall = (x1: number, y1: number, x2: number, y2: number): WallCandidate =>
  ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2), lengthFeet: Math.hypot(x2 - x1, y2 - y1), thicknessFeet: 0.5 }) as WallCandidate;
/** A box as the tool stores it: four corners, page units. */
const box = (x0: number, y0: number, x1: number, y1: number) => ({ xs: [ft(x0), ft(x1), ft(x1), ft(x0)], ys: [ft(y0), ft(y0), ft(y1), ft(y1)] });

describe("P1: the erase predicate (whole runs, 3 points)", () => {
  const box0 = box(0, 0, 50, 50);
  it("erases a run whose three points are inside", () => {
    const w = wall(10, 10, 40, 10);
    expect(eraseInBoxes([w], [box0]).erased).toEqual([w]);
  });
  it("keeps a run with only two of three points inside, in full and unclipped", () => {
    // 25% at x=25, 50% at x=40, 75% at x=55: the last is outside.
    const w = wall(10, 10, 70, 10);
    const got = eraseInBoxes([w], [box0]);
    expect(got.erased).toEqual([]);
    expect(got.kept).toEqual([w]);
    expect(got.kept[0]!.lengthFeet).toBe(60);
  });
  it("takes a run whole when its three points are inside, even with its ends past the edge; never cuts it", () => {
    // 25/50/75% at x = 15, 25, 35; the ends at -5 and 55 are outside the box.
    const w = wall(-5, 20, 55, 20);
    expect(eraseInBoxes([w], [box0]).erased).toEqual([w]);
    const w2 = wall(-30, 20, 30, 20); // 25% at x = -15: outside
    expect(eraseInBoxes([w2], [box0]).kept).toEqual([w2]);
  });
  it("counts a point on the edge as inside, as the ceiling did", () => {
    const w = wall(0, 0, 0, 40);
    expect(eraseInBoxes([w], [box0]).erased).toEqual([w]);
  });
  it("needs all three points in ONE box, not spread across two", () => {
    const w = wall(10, 10, 90, 10); // 25% x=30, 50% x=50, 75% x=70
    expect(eraseInBoxes([w], [box(0, 0, 45, 50), box(55, 0, 100, 50)]).erased).toEqual([]);
  });
  it("erases nothing with no box, and nothing with a box of no area", () => {
    const w = wall(10, 10, 40, 10);
    expect(eraseInBoxes([w], []).erased).toEqual([]);
    expect(eraseInBoxes([w], [box(10, 10, 40, 10)]).erased).toEqual([]);
  });
  it("reads ERASE_AREA rows into boxes, beside the other kinds", () => {
    const rows = [{ kind: "ERASE_AREA", ...box(0, 0, 50, 50) }, { kind: "WORK_AREA", ...box(0, 0, 90, 90) }];
    const got = userExclusionsFromRows(rows)!;
    expect(got.erase).toHaveLength(1);
    expect(got.workArea).toHaveLength(1);
    expect(userExclusionsFromRows([{ kind: "ERASE_AREA", xs: [0, 1, 1], ys: [0, 0, 1] }])).toBeNull();
  });
});

describe("P2: offeredCandidates with erase boxes", () => {
  const ws = [wall(10, 10, 40, 10), wall(10, 20, 40, 20), wall(60, 10, 90, 10), wall(60, 40, 90, 40)];
  const sheet = (user?: Parameters<typeof offeredCandidates>[0]["user"]) =>
    ({ walls: ws, segments: [], widthPt: 1000, feetPerUnit: FPU, planBoxes: null, textItems: [], user });

  it("drops the walls inside the box from the offer and names them in their own line", () => {
    const got = offeredCandidates(sheet({ erase: [box(0, 0, 50, 30)] }));
    expect(got.candidates).toHaveLength(2);
    expect(got.setAside).toEqual([{ kind: "erased-by-you", why: "inside an area you erased — 60 ft", n: 2, feet: expect.closeTo(60, 6) }]);
    expect(got.setAsideLines.filter((l) => l.kind === "erased-by-you")).toHaveLength(2);
  });
  it("acts on what the work area left: a wall already outside the work area is not erased twice", () => {
    const got = offeredCandidates(sheet({ workArea: [box(0, 0, 50, 50)], erase: [box(0, 0, 100, 15)] }));
    // Work area keeps the left two; the erase box then takes the left wall at y=10. The right one at y=10 was already outside.
    expect(got.candidates.map((c) => Math.round(c.y1 * FPU))).toEqual([20]);
    expect(got.setAside.find((a) => a.kind === "erased-by-you")).toMatchObject({ n: 1 });
    expect(got.setAside.find((a) => a.kind === "outside-work-area")).toMatchObject({ n: 2 });
  });
  it("with no erase box, nothing changes", () => {
    expect(offeredCandidates(sheet()).candidates).toHaveLength(4);
    expect(offeredCandidates(sheet({ erase: [] })).setAside).toEqual([]);
  });
});

describe("E4: the viewer previews with the shared predicate and writes what it previewed", () => {
  // A census: it proves the wiring is in the source, not that the browser honours it. The production proof does that.
  const viewer = readFileSync(join(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("counts the box with eraseInBoxes over the sheet's offered runs", () => {
    expect(viewer.match(/eraseInBoxes\(runsRef\.current, \[\{ xs, ys \}\]\)\.erased/g)).toHaveLength(1);
  });
  it("saves exactly the box it counted, as ERASE_AREA, only from Erase", () => {
    expect(viewer.match(/addExclusion\("ERASE_AREA", box\.xs, box\.ys\)/g)).toHaveLength(1);
    // The only write: no other path in the viewer stores an erase box.
    expect(viewer.match(/(?:addExclusion|addSheetExclusion)\([^)]*"ERASE_AREA"/g)).toHaveLength(1);
  });
});
