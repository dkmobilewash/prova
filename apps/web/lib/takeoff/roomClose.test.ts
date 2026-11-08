import { describe, expect, it } from "vitest";
import { ROOM_BOUNDARY_LABEL, isRoomBoundary, snapToWallEnd, wallEnds } from "./roomClose";
import { sheetRooms } from "./sheetRooms";

// A 20 x 10 ft room, 0.01 units per foot, open on its whole top side: three walls, a tag inside.
const F = 0.01;
const walls = [
  { x1: 0, y1: 0, x2: 0, y2: 10 * F, thicknessFeet: 0.5 },
  { x1: 0, y1: 10 * F, x2: 20 * F, y2: 10 * F, thicknessFeet: 0.5 },
  { x1: 20 * F, y1: 10 * F, x2: 20 * F, y2: 0, thicknessFeet: 0.5 },
];
const tag = [
  { str: "STORAGE", x: 10 * F * 1000, y: 4 * F * 1000, width: 40, height: 8 },
  { str: "104", x: 10 * F * 1000, y: 5.2 * F * 1000, width: 18, height: 8 },
];
const roomsWith = (drawn: { kind: string; xs: number[]; ys: number[] }[]) =>
  sheetRooms({ pairings: [], runs: walls, drawn, segments: [], doorLeaves: [], feetPerUnit: 1 / F, text: tag, widthPt: 1000 });

describe("close room", () => {
  it("snaps to the nearest wall end in reach, and leaves a point with none in reach where it is", () => {
    const ends = wallEnds({ pairings: [], runs: walls, drawn: [] });
    expect(snapToWallEnd({ x: 0.002, y: -0.001 }, ends, 0.005)).toEqual({ x: 0, y: 0, snapped: true });
    expect(snapToWallEnd({ x: 0.1, y: 0.05 }, ends, 0.005)).toEqual({ x: 0.1, y: 0.05, snapped: false });
  });

  it("an open room's tag is unplaced; a boundary line across the open side closes it at its full area", () => {
    const open = roomsWith([]);
    expect(open.unplacedTags.map((t) => t.name)).toEqual(["STORAGE"]);
    const line = { kind: "LINEAR", label: ROOM_BOUNDARY_LABEL, xs: [0, 20 * F], ys: [0, 0] };
    expect(isRoomBoundary(line)).toBe(true);
    const closed = roomsWith([line]);
    expect(closed.unplacedTags).toEqual([]);
    const room = closed.rooms.find((r) => r.tag?.name === "STORAGE");
    // Measured to the walls' inside faces: a little under 20 x 10.
    expect(room?.squareFeet).toBeGreaterThan(180);
    expect(room?.squareFeet).toBeLessThan(200);
    expect(room?.perimeterFeet).toBeGreaterThan(55);
  });
});
