import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COUNTER_GATE_LEAF_FEET, counterGate, doorCount, doorsAndWindowsForSheet, scheduledOpenings, toiletStallDoors } from "./doorsWindows";
import type { DoorSymbol } from "./doorWindowSymbols";
import type { WallCandidate } from "./wallVectors";

describe("scheduled openings from stored rows", () => {
  it("reads the width out of the size column and drops rows with no mark", () => {
    const rows = scheduledOpenings([
      { mark: "101", size: `3'-0" x 7'-0"`, description: "CONFERENCE to HALLWAY" },
      { mark: "108", size: `6'-0" x 7'-0"` },
      { mark: " ", size: `3'-0"` },
      { mark: "E105A", size: `3' - 6" x 6' - 8"`, description: null },
    ]);
    expect(rows.map((r) => [r.mark, r.widthFt])).toEqual([["101", 3], ["108", 6], ["E105A", 3.5]]);
    expect(rows[0]!.heightFt).toBe(7);
  });
});

describe("a sheet's doors against its schedule", () => {
  // Page 1000 pt wide, 1/8 in scale: 1 ft = 1.5 pt = 0.0015 page widths.
  const W = 1000;
  const FPU = W / 1.5;
  const ft = 1 / FPU;
  const wall = (x1: number, y1: number, x2: number, y2: number): WallCandidate =>
    ({ x1, y1, x2, y2, thicknessFeet: 0.5, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU }) as WallCandidate;
  const noSegments = { segments: [], segmentsPt: [] };

  it("places a scheduled door from a mark printed LOOSE beside a run, lists the rows no door carries, and counts both kinds", () => {
    // "K108D" is printed in a pill the symbol pass does not see (Bunkie),
    // 1 ft off the run; "E101" is a row with no mark on this sheet at all.
    const text = [{ str: "K108D", x: 0.5 * W - 10, y: (0.5 + 1 * ft) * W + 4, width: 20, height: 8 }];
    const got = doorsAndWindowsForSheet({
      ...noSegments,
      textPt: text,
      widthPt: W,
      walls: [wall(0.3, 0.5, 0.7, 0.5)],
      feetPerUnit: FPU,
      scheduleRows: [
        { mark: "K108D", size: `10' - 0" x 12' - 0"`, description: "overhead" },
        { mark: "E101", size: `3' - 0" x 6' - 8"` },
      ],
    });
    expect(got.join?.placedByMark).toBe(1);
    expect(got.join?.openings[0]?.mark).toBe("K108D");
    expect(got.join?.openings[0]?.widthFt).toBe(10);
    expect(got.unplacedMarks).toEqual(["E101"]);
    expect(got.doors).toHaveLength(0);
    expect(doorCount(got)).toBe(1);
  });

  it("says nothing about a schedule when there is none", () => {
    const got = doorsAndWindowsForSheet({ ...noSegments, textPt: [], widthPt: W, walls: [], feetPerUnit: FPU, scheduleRows: [] });
    expect(got.join).toBeNull();
    expect(got.unplacedMarks).toEqual([]);
    expect(doorCount(got)).toBe(0);
  });
});

describe("a 2 ft leaf in no wall is a counter gate (S1)", () => {
  const door = (widthFeet: number, wall: number | null, leaves: 1 | 2 = 1) => ({ kind: "door", hinge: { x: 0.5, y: 0.5 }, strike: { x: 0.52, y: 0.5 }, widthFeet, wall, leaves, sweepDegrees: 90 }) as DoorSymbol;
  it("drops Sloans A1.1's 2'-0\" counter gates, which hang in no wall", () => {
    expect(counterGate(door(2.01, null))).toBe(true);
    expect(counterGate(door(COUNTER_GATE_LEAF_FEET, null))).toBe(true);
  });
  it("is applied where the sheet's doors are counted (doorsInScope)", () => {
    expect(readFileSync(new URL("./doorsWindows.ts", import.meta.url), "utf8")).toMatch(/\.filter\(\(d\) => d\.widthFeet \/ d\.leaves <= WIDEST_DOOR_LEAF_FEET\)\s*\.filter\(\(d\) => !counterGate\(d\)\)/);
  });
  it("keeps a 2'-0\" closet door in a wall, a 2'-6\" leaf anywhere, and a pair", () => {
    expect(counterGate(door(2.0, 3))).toBe(false);
    expect(counterGate(door(2.5, null))).toBe(false);
    expect(counterGate(door(4.0, null, 2))).toBe(false);
  });
});

describe("S2: a toilet stall's door is not a door (prereg-S2.md)", () => {
  // fpu 1 and a 1-pt page, so units are feet and points alike. A room 20 ft wide between boundary walls at y -5 and y 10.
  const door = (hx: number, hy: number, w = 2, wall: number | null = null): DoorSymbol => ({ kind: "door", hinge: { x: hx, y: hy }, strike: { x: hx + w, y: hy }, open: { x: hx, y: hy + w }, widthFeet: w, wall, leaves: 1, sweepDegrees: 90 });
  const walls = [
    { x1: -10, y1: -5, x2: 12, y2: -5, thicknessFeet: 0.5 }, { x1: -10, y1: 10, x2: 12, y2: 10, thicknessFeet: 0.5 },
    { x1: -10, y1: -5, x2: -10, y2: 10, thicknessFeet: 0.5 }, { x1: 12, y1: -5, x2: 12, y2: 10, thicknessFeet: 0.5 },
  ] as unknown as WallCandidate[];
  const label = [{ str: "WOMENS", x: 1.5, y: 4.5, width: 1, height: 1 }];
  const stallA = door(0, 0), stallB = door(2.5, 0);
  const entry = door(6, -5, 3, 0), lone = door(-8, 3), outsideA = door(0, -8), outsideB = door(2.5, -8);
  const run = (doors: DoorSymbol[], marks: { x: number; y: number }[] = [], textPt = label) => toiletStallDoors({ doors, walls, marks, textPt, widthPt: 1, feetPerUnit: 1 });

  it("drops the untagged row inside the toilet room, and only that row", () => {
    expect([...run([stallA, stallB, entry, lone, outsideA, outsideB])]).toEqual([stallA, stallB]);
  });
  it("spares a row with a tagged door (the tagged one, and so its partner), and every door with no toilet label", () => {
    expect([...run([stallA, stallB], [{ x: 3.5, y: 0.5 }])]).toEqual([]);
    expect([...run([stallA, stallB], [], [{ str: "OFFICE", x: 1.5, y: 4.5, width: 1, height: 1 }])]).toEqual([]);
  });
  it("spares a pair of different widths and a pair not in a row", () => {
    expect([...run([stallA, door(2.5, 0, 3)])]).toEqual([]);
    // Within 1.5 widths of A (1.8 ft) but 1.5 ft off its leaf line: not a row.
    expect([...run([stallA, door(1, 1.5)])]).toEqual([]);
  });
  it("spares two doors in a row ON the room's boundary wall (a double entry)", () => {
    expect([...run([door(6, -5, 2, 0), door(8.5, -5, 2, 0)])]).toEqual([]);
  });
});
