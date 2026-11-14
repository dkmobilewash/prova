import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIDE_OFFSET, wallSideRooms } from "./wallSides";

const square = (x0: number, y0: number, x1: number, y1: number, name: string) => ({ xs: [x0, x1, x1, x0], ys: [y0, y0, y1, y1], name });

describe("the rooms either side of a wall", () => {
  const left = square(0.1, 0.1, 0.2, 0.3, "left"), right = square(0.2, 0.1, 0.3, 0.3, "right");
  it("finds the room on each side of the wall's longest segment, null where there is none", () => {
    // A two-segment wall: the long vertical segment between the rooms decides, not the short stub.
    const wall = { xs: [0.2, 0.2, 0.205], ys: [0.1, 0.3, 0.3] };
    expect(wallSideRooms(wall, [left, right]).map((r) => r?.name ?? null).sort()).toEqual(["left", "right"]);
    expect(wallSideRooms(wall, [left]).map((r) => r?.name ?? null).sort()).toEqual(["left", null].sort());
    expect(wallSideRooms({ xs: [0.2, 0.2], ys: [0.2, 0.2] }, [left, right]), "a wall with no length").toEqual([]);
  });
  it("probes past the wall by the product's offset, so a room further away is not this wall's", () => {
    const far = square(0.2 + 2 * SIDE_OFFSET, 0.1, 0.3, 0.3, "far");
    expect(wallSideRooms({ xs: [0.2, 0.2], ys: [0.1, 0.3] }, [far])).toEqual([null, null]);
  });
  it("is the probe the product and the zoned-heights eval both use", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    expect(read("./wallHeightsAssign.ts")).toContain("const sideRooms = wallSideRooms(wall, rooms);");
    expect(read("./realplan/zzZonedHeights.eval.ts")).toContain("wallSideRooms({ xs: [w.x1, w.x2], ys: [w.y1, w.y2] }, found.rooms)");
  });
});
