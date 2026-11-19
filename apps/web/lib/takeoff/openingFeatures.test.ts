import { describe, expect, it } from "vitest";
import type { DoorSymbol } from "./doorWindowSymbols";
import { DOOR_FEATURE_NAMES, doorFeatureRows, doorLabels, openingLabels, WINDOW_FEATURE_NAMES, windowFeatureRows } from "./openingFeatures";

// 1 unit = 1 ft, so distances read as feet.
const fpu = 1;
const quarter = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 2.12, y: 2.12 }, { x: 0, y: 3 }];

describe("doorLabels", () => {
  const fpu = 1;
  const leafA = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 2.1, y: 2.1 }, { x: 0, y: 3 }];
  const leafB = [{ x: 6, y: 0 }, { x: 6, y: 3 }, { x: 3.9, y: 2.1 }, { x: 3, y: 0 }];
  it("matches a two-leaf pair to both leaves' key points, and a single door to one", () => {
    const key = [{ x: 1, y: 1, kind: "door" as const }, { x: 5, y: 1, kind: "door" as const }];
    expect(doorLabels([{ polygons: [leafA, leafB] }], key, fpu)).toEqual({ real: [1], keys: [2] });
    expect(doorLabels([{ polygons: [leafA] }, { polygons: [leafB] }], key, fpu)).toEqual({ real: [1, 1], keys: [1, 1] });
    // One leaf keyed: the pair is real and takes one point; a pair with no key point near it is false.
    expect(doorLabels([{ polygons: [leafA, leafB] }], [key[0]!], fpu)).toEqual({ real: [1], keys: [1] });
    expect(doorLabels([{ polygons: [leafA, leafB] }], [{ x: 40, y: 40, kind: "door" }], fpu)).toEqual({ real: [0], keys: [0] });
  });
});

describe("openingLabels", () => {
  it("a key point on a door's hinge jamb matches its own swing, not a neighbour whose centre is nearer (Canton A101 121)", () => {
    // fpu 1: units are feet. Door A hinged at the origin, leaf up to (0, -3), its swing the quarter circle to (3, 0).
    const arc = Array.from({ length: 13 }, (_, k) => { const a = -Math.PI / 2 + (Math.PI / 2) * (k / 12); return { x: 3 * Math.cos(a), y: 3 * Math.sin(a) }; });
    const doorA = [{ x: 0, y: 0 }, ...arc];
    // A neighbour's swing below: its edge 1 ft from the key point, its centre nearer than door A's centre.
    const neighbour = [{ x: -0.5, y: 1 }, { x: 0.5, y: 1 }, { x: 0.5, y: 2 }, { x: -0.5, y: 2 }];
    const key = [{ x: -0.04, y: 0, kind: "door" as const }];
    expect(openingLabels([doorA, neighbour], key, 1)).toEqual([1, 0]);
  });

  it("takes a click anywhere in the swing, and one key point per opening", () => {
    // Inside the quarter circle, 1.5 ft from every edge: still this door.
    expect(openingLabels([quarter], [{ x: 1.2, y: 1.2, kind: "door" }], fpu)).toEqual([1]);
    // Two doors, one key point: only the nearer is real.
    const far = quarter.map((p) => ({ x: p.x + 10, y: p.y }));
    expect(openingLabels([quarter, far], [{ x: 1, y: 1, kind: "door" }], fpu)).toEqual([1, 0]);
    // 2 ft is the reach, 2.5 ft is not.
    expect(openingLabels([[{ x: 0, y: 0 }, { x: 4, y: 0 }]], [{ x: 2, y: 2.5, kind: "window" }], fpu)).toEqual([0]);
    expect(openingLabels([[{ x: 0, y: 0 }, { x: 4, y: 0 }]], [{ x: 2, y: 1.9, kind: "window" }], fpu)).toEqual([1]);
  });
});

describe("doorFeatureRows", () => {
  const door: DoorSymbol = { kind: "door", hinge: { x: 0, y: 0 }, strike: { x: 3, y: 0 }, widthFeet: 3, wall: null, leaves: 1, sweepDegrees: 90 };
  const base = { walls: [], words: [], feetPerUnit: fpu, widthPt: 100, renovation: false, doors: [door], arcs: [], marks: [], keptByProduct: new Set<DoorSymbol>() };
  const col = (row: number[], name: (typeof DOOR_FEATURE_NAMES)[number]) => row[DOOR_FEATURE_NAMES.indexOf(name)];

  it("reads a doorway as a gap and casework over a wall line as covered", () => {
    const gap = doorFeatureRows({ ...base, segments: [{ x1: -5, y1: 0, x2: 0, y2: 0 }, { x1: 3, y1: 0, x2: 8, y2: 0 }] })[0]!;
    const covered = doorFeatureRows({ ...base, segments: [{ x1: -5, y1: 0.1, x2: 8, y2: 0.1 }] })[0]!;
    expect(col(gap, "wallLinesAcross")).toBe(0);
    expect(col(covered, "wallLinesAcross")).toBeCloseTo(1, 5);
    expect(gap).toHaveLength(DOOR_FEATURE_NAMES.length);
  });

  it("says a mark beside the door, and a door the product drops", () => {
    const row = doorFeatureRows({ ...base, segments: [], marks: [{ text: "101", x: 1.5, y: 1 }] })[0]!;
    expect([col(row, "marked"), col(row, "markNumeric"), col(row, "droppedByMarkedShare")]).toEqual([1, 1, 1]);
  });
});

describe("windowFeatureRows", () => {
  it("one row per candidate, a tag placed with no frame included", () => {
    const rows = windowFeatureRows({
      segments: [], walls: [], words: [], feetPerUnit: fpu, widthPt: 100, renovation: false, doors: [], everyWindowTagged: true, scheduleInSet: false,
      tags: [{ text: "W1", x: 0, y: 1 }],
      windows: [
        { frame: { kind: "window", x1: 0, y1: 0, x2: 4, y2: 0, widthFeet: 4, wall: -1, lines: 3 }, at: { x: 2, y: 0 }, countedTag: "W1" },
        { frame: null, at: { x: 50, y: 50 }, countedTag: "W1" },
        { frame: { kind: "window", x1: 90, y1: 0, x2: 94, y2: 0, widthFeet: 4, wall: -1, lines: 4 }, at: { x: 92, y: 0 }, countedTag: "untagged" },
      ],
    });
    const col = (r: number[], n: (typeof WINDOW_FEATURE_NAMES)[number]) => r[WINDOW_FEATURE_NAMES.indexOf(n)];
    expect(rows.map((r) => [col(r, "hasFrame"), col(r, "glassLines"), col(r, "tagged"), col(r, "tagIsW")])).toEqual([[1, 1, 1, 1], [0, -1, 0, 0], [1, 2, 0, 0]]);
    // A window counted from its drawing (#1165) is not one counted by a tag.
    expect(rows.map((r) => [col(r, "countedByTag"), col(r, "countedDrawn")])).toEqual([[1, 0], [1, 0], [0, 1]]);
  });
});
