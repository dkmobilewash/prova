import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `doorSeals` sat in the engine with no caller for two days. No test here can
// run a whole-set stage or a viewer Find, so this pins the two callers. Only a
// run proves a room closes; zzRoomsOpen.eval is that run.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const viewer = read("../../components/TakeoffPlanViewer.tsx");
const rooms = read("../plan-ingest/rooms.ts");
const walls = read("../plan-ingest/walls.ts");

describe("both room paths use the doors", () => {
  it("the viewer seals with roomSeals", () => {
    expect(viewer).toMatch(/roomSeals\(walls, detected\.segments\.map\(inPageWidthUnits\(detected\.widthPt\)\), feetPerUnit\)/);
    expect(viewer).toMatch(/roomsFromWalls\(\{ walls, feetPerUnit, text: wordsRef\.current, widthPt: pageSize\.widthPt, doorSeals \}\)/);
  });
  it("the whole-set stage uses the pairings and seals the detection just read", () => {
    expect(walls).toMatch(/onBoundary: \(seen\) => \{\s+boundary = seen;/);
    expect(walls).toMatch(/findRooms\(\{[^}]*boundary,/);
    expect(rooms).toContain("roomBoundary({ pairings: input.boundary?.pairings ?? [], runs, drawn: [] })");
    expect(rooms).toMatch(/roomsFromWalls\(\{ walls, feetPerUnit, text: text\.items, widthPt: text\.widthPt, doorSeals \}\)/);
  });
});
