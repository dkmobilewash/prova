import { describe, expect, it } from "vitest";
import type { DoorSymbol } from "./doorWindowSymbols";
import { DOOR_FEATURE_NAMES, doorFeatureRows, openingLabels, WINDOW_FEATURE_NAMES, windowFeatureRows } from "./openingFeatures";

// 1 unit = 1 ft, so distances read as feet.
const fpu = 1;
const quarter = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 2.12, y: 2.12 }, { x: 0, y: 3 }];

describe("openingLabels", () => {
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

  it("arcGrey: the share of the door's OWN strokes in grey pen — grey door 1, black door 0, no pen information -1", () => {
    // The leaf from the hinge to the open end (0,3), the arc from there to the strike (3,0).
    const arc = { chain: [{ x: 0, y: 3 }, { x: 2.12, y: 2.12 }, { x: 3, y: 0 }], fit: { cx: 0, cy: 0, r: 3, worst: 0 }, radiusFeet: 3, sweepDegrees: 90, reject: null, door };
    const strokes = (gray: number | undefined) => [
      { x1: 0, y1: 0, x2: 0, y2: 3, ...(gray === undefined ? {} : { gray }) },
      { x1: 0, y1: 3, x2: 2.12, y2: 2.12, curved: true, ...(gray === undefined ? {} : { gray }) },
      { x1: 2.12, y1: 2.12, x2: 3, y2: 0, curved: true, ...(gray === undefined ? {} : { gray }) },
    ];
    // A grey line elsewhere on the sheet is not the door's.
    const elsewhere = { x1: 20, y1: 20, x2: 30, y2: 20, gray: 0.8 };
    const grey = doorFeatureRows({ ...base, arcs: [arc], segments: [...strokes(0.6), elsewhere] })[0]!;
    const black = doorFeatureRows({ ...base, arcs: [arc], segments: [...strokes(0), elsewhere] })[0]!;
    const unread = doorFeatureRows({ ...base, arcs: [arc], segments: strokes(undefined) })[0]!;
    expect([col(grey, "arcGrey"), col(black, "arcGrey"), col(unread, "arcGrey")]).toEqual([1, 0, -1]);
    expect(DOOR_FEATURE_NAMES[DOOR_FEATURE_NAMES.length - 1], "appended at the END, so earlier columns keep their place").toBe("arcGrey");
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
