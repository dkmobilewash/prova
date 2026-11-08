import { describe, expect, it } from "vitest";
import { ROOM_BOUNDARY_LABEL, isRoomBoundary, openRoomTags, snapToWallEnd, wallEnds } from "./roomClose";
import { readRoomTags } from "./roomTags";
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
    expect(openRoomTags(open).map((o) => o.tag.name), "an open room's tag reaches the outside").toEqual(["STORAGE"]);
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

  it("a tag boxed in a small closed cell (a schedule's text) is unplaced but not an open room", () => {
    const cell = [
      { x1: 30 * F, y1: 0, x2: 33 * F, y2: 0, thicknessFeet: 0.1 },
      { x1: 33 * F, y1: 0, x2: 33 * F, y2: 2 * F, thicknessFeet: 0.1 },
      { x1: 33 * F, y1: 2 * F, x2: 30 * F, y2: 2 * F, thicknessFeet: 0.1 },
      { x1: 30 * F, y1: 2 * F, x2: 30 * F, y2: 0, thicknessFeet: 0.1 },
    ];
    const text = [
      { str: "STANLEY", x: 31.5 * F * 1000, y: 0.7 * F * 1000, width: 20, height: 3 },
      { str: "632F", x: 31.5 * F * 1000, y: 1.3 * F * 1000, width: 10, height: 3 },
    ];
    const r = sheetRooms({ pairings: [], runs: [...walls, ...cell], drawn: [], segments: [], doorLeaves: [], feetPerUnit: 1 / F, text: [...tag, ...text], widthPt: 1000 });
    expect(r.unplacedTags.map((t) => t.name)).toContain("STANLEY");
    expect(openRoomTags(r).map((o) => o.tag.name)).toEqual(["STORAGE"]);
  });

  it("note words are not room names: ABOVE, BELOW, EXISTING, MARK", () => {
    const at = (str: string, y: number) => ({ str, x: 100, y, width: 30, height: 8 });
    for (const word of ["ABOVE", "BELOW", "EXISTING", "MARK"]) {
      expect(readRoomTags([at(word, 100), at("A1", 112)]).map((t) => t.name), word).toEqual([]);
    }
    expect(readRoomTags([at("RETAIL SALES", 100), at("101", 112)]).map((t) => t.name)).toEqual(["RETAIL SALES"]);
  });
});
