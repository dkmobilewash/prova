import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `doorSeals` sat in the engine with no caller for two days. No test here can
// run a whole-set stage or a viewer Find, so this pins the two callers. Only a
// run proves a room closes; zzRoomsOpen.eval is that run.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const viewer = read("../../components/TakeoffPlanViewer.tsx");
const rooms = read("../plan-ingest/rooms.ts");
const walls = read("../plan-ingest/walls.ts");
const sheet = read("./sheetRooms.ts");

describe("both room paths use the doors", () => {
  it("the viewer and the whole-set stage both find rooms through sheetRooms", () => {
    expect(viewer).toMatch(/sheetRooms\(\{\s+pairings: pairingsRef\.current,/);
    expect(rooms).toMatch(/sheetRooms\(\{\s+pairings: input\.boundary\?\.pairings \?\? \[\],/);
    expect(sheet).toMatch(/roomSeals\(walls, segments, feetPerUnit\)/);
  });
  it("the whole-set stage keeps what the detection just read", () => {
    expect(walls).toMatch(/onBoundary: \(seen\) => \{\s+boundary = seen;/);
    expect(walls).toMatch(/findRooms\(\{[^}]*boundary,/);
  });
});
