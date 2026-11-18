import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COUNTER_GATE_LEAF_FEET, counterGate, doorCount, doorsAndWindowsForSheet, scheduledOpenings } from "./doorsWindows";
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
