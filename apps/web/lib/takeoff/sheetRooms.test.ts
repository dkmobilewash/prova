import { describe, expect, it } from "vitest";
import { sheetRooms } from "./sheetRooms";
import { splitLinesFrom } from "./userExclusions";

// One 20 x 10 ft room, with no wall between its two tags.
const W = 100, ft = (n: number) => n / W, T = 0.5;
const wall = (x1: number, y1: number, x2: number, y2: number) => ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2), thicknessFeet: T, lengthFeet: Math.hypot(x2 - x1, y2 - y1) });
const runs = [wall(0, 0, 20, 0), wall(0, 10, 20, 10), wall(0, 0, 0, 10), wall(20, 0, 20, 10)] as never;
const tag = (str: string, xFt: number, yFt: number) => ({ str, x: xFt * 10 - 20, y: yFt * 10, width: 40, height: 6 });
const text = [tag("DINING", 5, 4), tag("137", 5, 5), tag("KITCHEN", 15, 4), tag("135", 15, 5)];
const go = (splits: { x1: number; y1: number; x2: number; y2: number }[] = []) => sheetRooms({ pairings: [], runs, drawn: [], segments: [], doorLeaves: [], splits, feetPerUnit: W, text, widthPt: 1000 });

describe("Split area", () => {
  it("leaves an open area as one region until a line is drawn", () => {
    const { rooms } = go();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.sharedTags?.map((t) => t.number).sort()).toEqual(["135", "137"]);
  });
  it("gives each part the tag inside it, even from a line stopped short of the walls", () => {
    const { rooms, mergedTags } = go([{ x1: ft(10), y1: ft(0.6), x2: ft(10), y2: ft(9.4) }]);
    expect(rooms.map((r) => r.tag?.number).sort()).toEqual(["135", "137"]);
    expect(mergedTags).toEqual([]);
    for (const room of rooms) expect(room.squareFeet).toBeGreaterThan(80);
  });
  // A plan-sized open area, so the grid's cells are coarse enough to lose the
  // strip under a split the way Joplin's dining room did (1,643.6 sf became 1,641.1).
  const big = (splits: { x1: number; y1: number; x2: number; y2: number }[] = []) => {
    const B = (n: number) => n / W;
    const bw = (x1: number, y1: number, x2: number, y2: number) => ({ x1: B(x1), y1: B(y1), x2: B(x2), y2: B(y2), thicknessFeet: T, lengthFeet: Math.hypot(x2 - x1, y2 - y1) });
    const bigText = [tag("DINING", 60, 40), tag("137", 60, 50), tag("KITCHEN", 300, 40), tag("135", 300, 50)];
    return sheetRooms({ pairings: [], runs: [bw(0, 0, 400, 0), bw(0, 120, 400, 120), bw(0, 0, 0, 120), bw(400, 0, 400, 120)] as never, drawn: [], segments: [], doorLeaves: [], splits, feetPerUnit: W, text: bigText, widthPt: 1000 });
  };
  it("cuts the room itself, so the parts add up to the whole", () => {
    const whole = big().rooms[0]!.squareFeet;
    const parts = big([{ x1: ft(150), y1: ft(1), x2: ft(150), y2: ft(119) }]).rooms.map((r) => r.squareFeet);
    expect(parts).toHaveLength(2);
    expect(Math.abs(parts[0]! + parts[1]! - whole)).toBeLessThan(1);
  });
  it("cuts with two lines, a slanted one among them", () => {
    const whole = big().rooms[0]!.squareFeet;
    const parts = big([{ x1: ft(120), y1: ft(1), x2: ft(120), y2: ft(119) }, { x1: ft(200), y1: ft(1), x2: ft(240), y2: ft(119) }]).rooms.map((r) => r.squareFeet);
    expect(parts.length).toBe(3);
    expect(Math.abs(parts.reduce((a, b) => a + b, 0) - whole)).toBeLessThan(1);
  });
  it("reads only split rows from a sheet's exclusions", () => {
    expect(splitLinesFrom([{ kind: "ROOM_SPLIT", xs: [0, 1], ys: [0, 1] }, { kind: "EXCLUDE_LIKE", xs: [0, 1], ys: [0, 1] }])).toHaveLength(1);
  });
});
