import { describe, expect, it } from "vitest";
import { roomsFromWalls, roomsSplitAtDrawnWalls, type FoundWall } from "./roomsFromWalls";

/**
 * Two 10x10 ft rooms side by side, 6-inch walls, a 3-ft doorway in the wall
 * between them. Areas are to the inside faces, so each room is 100 sf and 40
 * ft round, by arithmetic rather than by measurement.
 */
const T = 0.5;
const W = 100; // feet per page-width unit: the page is 100 ft wide
const ft = (n: number) => n / W;
const wall = (x1: number, y1: number, x2: number, y2: number): FoundWall => ({
  x1: ft(x1),
  y1: ft(y1),
  x2: ft(x2),
  y2: ft(y2),
  thicknessFeet: T,
});
// Centrelines sit half a thickness outside each 10 ft interior.
const c = T / 2;
const walls: FoundWall[] = [
  wall(-c, -c, 20 + 3 * c, -c), // top
  wall(-c, 10 + c, 20 + 3 * c, 10 + c), // bottom
  wall(-c, -c, -c, 10 + c), // left
  wall(20 + 3 * c, -c, 20 + 3 * c, 10 + c), // right
  wall(10 + c, -c, 10 + c, 3), // shared, above the door
  wall(10 + c, 6, 10 + c, 10 + c), // shared, below the door
];
const text = (str: string, xFt: number, yFt: number) => ({ str, x: xFt * 10 - 20, y: yFt * 10, width: 40, height: 6 });

describe("roomsFromWalls", () => {
  it("finds both rooms, seals the doorway, measures to the inside face and names them", () => {
    const { rooms, unplacedTags } = roomsFromWalls({
      walls,
      feetPerUnit: W,
      widthPt: 1000, // 10 points per foot
      text: [text("OFFICE", 5, 4), text("101", 5, 5), text("STORAGE", 15, 4), text("102", 15, 5), text("OUTSIDE", 40, 40), text("999", 40, 41)],
    });
    expect(rooms).toHaveLength(2);
    for (const room of rooms) {
      expect(room.squareFeet).toBeGreaterThan(96);
      expect(room.squareFeet).toBeLessThan(104);
      expect(room.perimeterFeet).toBeGreaterThan(39);
      expect(room.perimeterFeet).toBeLessThan(41.5);
    }
    expect(rooms.map((r) => r.tag?.name).sort()).toEqual(["OFFICE", "STORAGE"]);
    expect(unplacedTags.map((t) => t.name)).toEqual(["OUTSIDE"]);
  });

  it("seals a door hinged in the corner ONLY when asked: wall stands on one side only", () => {
    // The shared wall stops 3 ft short of the top wall: a door in the corner.
    const corner = walls.slice(0, 4).concat([wall(10 + c, 3, 10 + c, 10 + c)]);
    expect(roomsFromWalls({ walls: corner, feetPerUnit: W }).rooms).toHaveLength(1);
    const { rooms } = roomsFromWalls({ walls: corner, feetPerUnit: W, sealCornerDoors: true });
    expect(rooms).toHaveLength(2);
    for (const room of rooms) {
      expect(room.squareFeet).toBeGreaterThan(96);
      expect(room.squareFeet).toBeLessThan(104);
    }
  });

  it("does not seal a corridor that runs into a room: the gap is bounded by a wall END, not a face", () => {
    // Two parallel corridor walls end 5 ft short of a room's wall... no: they
    // end facing OPEN space. The ray from each end hits nothing perpendicular
    // within a door's width, so nothing is drawn.
    const corridor = [wall(0, 0, 20, 0), wall(0, 6, 20, 6)];
    const { rooms } = roomsFromWalls({ walls: corridor, feetPerUnit: W, sealCornerDoors: true });
    expect(rooms).toHaveLength(0);
  });

  it("ignores the little box drawn round a tag, so the tag still names its room", () => {
    // A 1.5 ft box round the number "101", as a tag symbol is drawn.
    const b = [wall(4.25, 4.75, 5.75, 4.75), wall(5.75, 4.75, 5.75, 5.75), wall(5.75, 5.75, 4.25, 5.75), wall(4.25, 5.75, 4.25, 4.75)].map((w) => ({ ...w, thicknessFeet: 0.05 }));
    const { rooms, unplacedTags } = roomsFromWalls({
      walls: walls.concat(b),
      feetPerUnit: W,
      widthPt: 1000,
      text: [text("OFFICE", 5, 4), text("101", 5, 5), text("STORAGE", 15, 4), text("102", 15, 5)],
    });
    expect(unplacedTags).toEqual([]);
    expect(rooms.map((r) => r.tag?.name).sort()).toEqual(["OFFICE", "STORAGE"]);
  });

  it("does not let toilet partitions split a room", () => {
    // Three 1-inch, 5-ft stall panels across the first room.
    const stalls = [3, 6, 9].map((x) => ({ ...wall(x, 0, x, 5), thicknessFeet: 0.08 }));
    const { rooms } = roomsFromWalls({ walls: walls.concat(stalls), feetPerUnit: W });
    expect(rooms).toHaveLength(2);
    for (const room of rooms) expect(room.squareFeet).toBeGreaterThan(96);
    // The same panels at a real wall's thickness DO divide it — the rule is thickness, not length alone.
    const thin = roomsFromWalls({ walls: walls.concat([3, 6, 9].map((x) => wall(x, 0, x, 10 + c))), feetPerUnit: W });
    expect(thin.rooms.length).toBeGreaterThan(2);
  });

  it("bridges a drawn sidelight between two wall ends, so the door beside it seals; a counter does not bridge", () => {
    // Joplin's shape: room A's whole corridor side is a door hinged in the
    // left corner (0..3.5) and a sidelight (3.5..10.25) to the partition. No
    // wall on that line at all; room B's bottom wall is intact.
    const open = walls.filter((_, i) => i !== 1).concat([wall(10 + c, 10 + c, 20 + 3 * c, 10 + c)]);
    const without = roomsFromWalls({ walls: open, feetPerUnit: W });
    expect(without.rooms).toHaveLength(1);
    // The sidelight's glazing line, jamb to corner.
    const glass = { x1: ft(3.5), y1: ft(10 + c), x2: ft(10 + c), y2: ft(10 + c) };
    const withGlass = roomsFromWalls({ walls: open, feetPerUnit: W, strokes: [glass], bridgeSidelights: true });
    expect(withGlass.rooms).toHaveLength(2);
    // A door leaf drawn open: 3 ft from the jamb (a wall end) into the room, at a right angle. Not a bridge.
    const leaf = { x1: ft(10 + c), y1: ft(10 + c), x2: ft(10 + c), y2: ft(7) };
    const withLeaf = roomsFromWalls({ walls: open, feetPerUnit: W, strokes: [glass, leaf], bridgeSidelights: true });
    expect(withLeaf.rooms).toHaveLength(2);
    for (const room of withLeaf.rooms) expect(room.squareFeet).toBeGreaterThan(90);
    // A counter edge 2 ft off the top wall, touching the side walls mid-body: no bridge, still two rooms of ~100 sf.
    const counter = { x1: ft(0), y1: ft(2), x2: ft(10), y2: ft(2) };
    const withCounter = roomsFromWalls({ walls, feetPerUnit: W, strokes: [counter], bridgeSidelights: true });
    expect(withCounter.rooms).toHaveLength(2);
    for (const room of withCounter.rooms) expect(room.squareFeet).toBeGreaterThan(96);
  });

  it("merges the rooms when the doorway is too wide to be a door, and says which tags merged", () => {
    const open = walls.slice(0, 4).concat([wall(10 + c, -c, 10 + c, 1)]);
    const { rooms, mergedTags } = roomsFromWalls({
      walls: open,
      feetPerUnit: W,
      widthPt: 1000,
      text: [text("OFFICE", 5, 4), text("101", 5, 5), text("STORAGE", 15, 4), text("102", 15, 5)],
    });
    expect(rooms).toHaveLength(1);
    expect(rooms[0].squareFeet).toBeGreaterThan(195);
    expect(rooms[0].tag).toBeNull();
    expect(mergedTags.map((t) => t.name).sort()).toEqual(["OFFICE", "STORAGE"]);
    expect(rooms.flatMap((r) => r.sharedTags ?? []).map((t) => t.name).sort()).toEqual(["OFFICE", "STORAGE"]);
  });
  it("a framed legend is not a room, and body text saying NOTES does not make one", () => {
    const words = [...Array.from({ length: 9 }, (_, i) => text(`w${i}`, 1 + i, 30))];
    const heading = { str: "FLOOR PLAN LEGEND", x: 20, y: 30, width: 40, height: 14 };
    expect(roomsFromWalls({ walls, feetPerUnit: W, text: [...words, heading], widthPt: 1000 }).rooms).toHaveLength(1);
    const body = { str: "SEE NOTES", x: 20, y: 30, width: 40, height: 6 };
    expect(roomsFromWalls({ walls, feetPerUnit: W, text: [...words, body], widthPt: 1000 }).rooms).toHaveLength(2);
  });
  describe("a leaked region split at a drawn wall", () => {
    const open = walls.slice(0, 4);
    const tags = [text("OFFICE", 5, 4), text("101", 5, 5), text("STORAGE", 15, 4), text("102", 15, 5)];
    const base = { walls: open, feetPerUnit: W, text: tags, widthPt: 1000 };
    it("splits where the sheet draws the wall, naming both rooms", () => {
      expect(roomsFromWalls(base).rooms.filter((r) => r.sharedTags)).toHaveLength(1);
      const split = roomsSplitAtDrawnWalls(base, [{ x1: ft(10 + c), y1: ft(-c), x2: ft(10 + c), y2: ft(10 + c) }]);
      expect(split.rooms.map((r) => r.tag?.number).sort()).toEqual(["101", "102"]);
      expect(split.mergedTags).toEqual([]);
    });
    it("stays one region when no drawn line separates the tags, or the line is short", () => {
      expect(roomsSplitAtDrawnWalls(base, []).rooms.filter((r) => r.sharedTags)).toHaveLength(1);
      const pieces = [0, 3, 6, 9].map((y) => ({ x1: ft(10 + c), y1: ft(y - c), x2: ft(10 + c), y2: ft(y + 3) }));
      expect(roomsSplitAtDrawnWalls(base, pieces).rooms.filter((r) => r.sharedTags)).toHaveLength(1);
    });
    it("does not split when the line leaves every tag on one side", () => {
      const left = { ...base, text: [text("OFFICE", 2, 4), text("101", 2, 5), text("STORAGE", 7, 4), text("102", 7, 5)] };
      const split = roomsSplitAtDrawnWalls(left, [{ x1: ft(10 + c), y1: ft(-c), x2: ft(10 + c), y2: ft(10 + c) }]);
      expect(split.rooms).toHaveLength(1);
      expect(split.rooms[0]?.squareFeet).toBeGreaterThan(180);
    });
    it("gives an open room's tag to an unnamed room beside it, and only one", () => {
      const beside = roomsSplitAtDrawnWalls({ walls: open, feetPerUnit: W, text: [text("OFFICE", 5, 12), text("101", 5, 13)], widthPt: 1000 }, []);
      expect(beside.rooms[0]?.tag?.number).toBe("101");
      expect(beside.unplacedTags).toEqual([]);
      const far = roomsSplitAtDrawnWalls({ walls: open, feetPerUnit: W, text: [text("OFFICE", 5, 30), text("101", 5, 31)], widthPt: 1000 }, []);
      expect(far.rooms[0]?.tag).toBeNull();
      expect(far.unplacedTags).toHaveLength(1);
    });
  });
});

describe("door seals from the swing symbols", () => {
  // Two 20 x 20 ft rooms side by side, the party wall cut by a 14 ft opening —
  // wider than `openingsInWalls` will ever close (WIDEST_DOOR_FEET is 12), so
  // without a seal the two are one region.
  const FPU = 100;
  const walls = [
    { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.1, thicknessFeet: 0.5 },
    { x1: 0.5, y1: 0.1, x2: 0.5, y2: 0.3, thicknessFeet: 0.5 },
    { x1: 0.5, y1: 0.3, x2: 0.1, y2: 0.3, thicknessFeet: 0.5 },
    { x1: 0.1, y1: 0.3, x2: 0.1, y2: 0.1, thicknessFeet: 0.5 },
    { x1: 0.3, y1: 0.1, x2: 0.3, y2: 0.13, thicknessFeet: 0.5 },
    { x1: 0.3, y1: 0.27, x2: 0.3, y2: 0.3, thicknessFeet: 0.5 },
  ];
  it("closes an opening the gap rule cannot, exactly along the leaf", () => {
    const before = roomsFromWalls({ walls, feetPerUnit: FPU });
    expect(before.rooms).toHaveLength(1);
    const after = roomsFromWalls({ walls, feetPerUnit: FPU, doorSeals: [{ x1: 0.3, y1: 0.13, x2: 0.3, y2: 0.27 }] });
    expect(after.rooms).toHaveLength(2);
  });

});
