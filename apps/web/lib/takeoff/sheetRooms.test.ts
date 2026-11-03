import { describe, expect, it } from "vitest";
import { sheetRooms } from "./sheetRooms";
import { splitLinesFrom } from "./userExclusions";
import { pointInRing } from "./drawTools";

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

// ── ANY LINE, NOT JUST THE ONE A TEST THOUGHT OF ──
// A U-shaped room (the concave case the old one-cut version gave up on) and many
// random lines between points on its walls: the floor total must not move, and no
// piece may be smaller than a room. A seeded generator, so a failure repeats.
describe("Split area, any line", () => {
  const U = (n: number) => n / W;
  const uw = (x1: number, y1: number, x2: number, y2: number) => ({ x1: U(x1), y1: U(y1), x2: U(x2), y2: U(y2), thicknessFeet: T, lengthFeet: Math.hypot(x2 - x1, y2 - y1) });
  // 60 x 40 ft with a 20 x 25 ft notch out of the top middle.
  const uRuns = [uw(0, 0, 20, 0), uw(20, 0, 20, 25), uw(20, 25, 40, 25), uw(40, 25, 40, 0), uw(40, 0, 60, 0), uw(60, 0, 60, 40), uw(60, 40, 0, 40), uw(0, 40, 0, 0)] as never;
  const uText = [tag("DINING", 10, 30), tag("137", 10, 31), tag("KITCHEN", 50, 30), tag("135", 50, 31)];
  const run = (splits: { x1: number; y1: number; x2: number; y2: number }[] = []) => sheetRooms({ pairings: [], runs: uRuns, drawn: [], segments: [], doorLeaves: [], splits, feetPerUnit: W, text: uText, widthPt: 1000 });
  const floor = (rs: { squareFeet: number }[]) => rs.reduce((n, r) => n + r.squareFeet, 0);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const onWall = () => {
    const outline = [[0, 0], [20, 0], [20, 25], [40, 25], [40, 0], [60, 0], [60, 40], [0, 40]] as const;
    const k = Math.floor(rand() * outline.length), a = outline[k]!, b = outline[(k + 1) % outline.length]!, t = rand();
    return { x: U(a[0] + (b[0] - a[0]) * t), y: U(a[1] + (b[1] - a[1]) * t) };
  };

  it("keeps the floor total for 300 random wall-to-wall lines", () => {
    const before = run().rooms;
    expect(before).toHaveLength(1);
    const whole = floor(before);
    let split = 0;
    const room = before[0]!;
    // Wall to wall: the line stays in the room.
    const staysInside = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Array.from({ length: 19 }, (_, k) => (k + 1) / 20).every((t) => pointInRing(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, room.xs, room.ys));
    for (let i = 0; i < 300; i += 1) {
      let a = onWall(), b = onWall();
      while (!staysInside(a, b)) (a = onWall()), (b = onWall());
      const after = run([{ x1: a.x, y1: a.y, x2: b.x, y2: b.y }]).rooms;
      if (after.length > 1) split += 1;
      expect(Math.abs(floor(after) - whole), `line ${i}`).toBeLessThan(0.01);
      for (const r of after) expect(r.squareFeet, `line ${i}`).toBeGreaterThanOrEqual(9);
    }
    // The property is only worth something if most lines really divided the room.
    expect(split).toBeGreaterThan(150);
  });
  it("does not cut off a sliver smaller than a room, so nothing is lost to it", () => {
    // Along the base wall, a twentieth of a foot inside it: the strip would be 3 sf.
    const rooms = run([{ x1: U(0.5), y1: U(39.7), x2: U(59.5), y2: U(39.7) }]).rooms;
    expect(rooms).toHaveLength(1);
    expect(Math.abs(floor(rooms) - floor(run().rooms))).toBeLessThan(0.01);
  });
  it("cuts a line that crosses the room twice, both times", () => {
    // Across both legs of the U, through the notch: two stretches inside the room.
    // It crosses the notch outside as well, and closes nothing there: a split divides.
    const parts = run([{ x1: U(-1), y1: U(10), x2: U(61), y2: U(10) }]).rooms;
    expect(parts).toHaveLength(3);
    expect(Math.abs(floor(parts) - floor(run().rooms))).toBeLessThan(0.01);
  });
});

