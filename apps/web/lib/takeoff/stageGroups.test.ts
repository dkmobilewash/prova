import { describe, expect, it } from "vitest";
import { groupsForStage, hatchedRuns, siblingPages, STAGE_CLUSTER_INCHES, tagsFromSibling } from "./stageGroups";
import { clusterByThickness, CLUSTER_INCHES } from "./wallVectors";
import { isSiblingTag, siblingTag } from "./planTextTags";
import { wallGroups } from "./wallGroups";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/** Page-width units; FPU 100 makes 0.01 one foot. */
const FPU = 100;
const run = (x1: number, y1: number, x2: number, y2: number, thicknessFeet = 0.5): WallCandidate => ({ x1, y1, x2, y2, thicknessFeet, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU });

describe("a hatched band", () => {
  // A 20 ft wall along y = 0.5, 6 in thick: faces at y 0.4975 and 0.5025.
  const wall = run(0.1, 0.5, 0.3, 0.5);
  // Diagonal strokes, a foot apart or closer, across the band at about 45°.
  const hatch: StrokeSegment[] = Array.from({ length: 24 }, (_, i) => ({ x1: 0.105 + i * 0.008, y1: 0.4978, x2: 0.105 + i * 0.008 + 0.0044, y2: 0.5022 }));
  it("is a run with short strokes across it, both ends inside, and not a run beside a hatch", () => {
    expect(hatchedRuns([wall], hatch, FPU).has(wall)).toBe(true);
    // The same strokes a foot off the wall are somebody else's hatch.
    const beside = hatch.map((s) => ({ ...s, y1: s.y1 + 0.01, y2: s.y2 + 0.01 }));
    expect(hatchedRuns([wall], beside, FPU).has(wall)).toBe(false);
    // Three strokes are a jamb and a door, not a fill.
    expect(hatchedRuns([wall], hatch.slice(0, 3), FPU).has(wall)).toBe(false);
    // Square-on strokes — jambs, end caps, witness lines — are not hatch however many.
    const square = Array.from({ length: 24 }, (_, i) => ({ x1: 0.105 + i * 0.008, y1: 0.4978, x2: 0.105 + i * 0.008, y2: 0.5022 }));
    expect(hatchedRuns([wall], square, FPU).has(wall)).toBe(false);
    // A stroke along the wall is a face, not hatch.
    const along = Array.from({ length: 12 }, (_, i) => ({ x1: 0.11 + i * 0.015, y1: 0.5, x2: 0.12 + i * 0.015, y2: 0.5 }));
    expect(hatchedRuns([wall], along, FPU).has(wall)).toBe(false);
  });

  it("is one or two families of lines all along it — not dimension ticks, fixture crosses or fittings at mixed angles", () => {
    // Cross-hatch: the same strokes plus their mirror, two families.
    const mirror = hatch.map((s) => ({ ...s, x1: s.x2, x2: s.x1 }));
    expect(hatchedRuns([wall], [...hatch, ...mirror], FPU).has(wall)).toBe(true);
    // Joplin's false hatch: as many oblique strokes, at five different angles.
    const slope = [0.6, 1, 1.7, -0.7, -1.3];
    const mixed = Array.from({ length: 24 }, (_, i) => {
      const dy = 0.0044, dx = dy / slope[i % slope.length]!;
      return { x1: 0.105 + i * 0.008, y1: 0.4978, x2: 0.105 + i * 0.008 + dx, y2: 0.4978 + dy };
    });
    expect(hatchedRuns([wall], mixed, FPU).has(wall)).toBe(false);
    // One family, but bunched in the first four feet where a dimension string lands.
    const bunched = Array.from({ length: 24 }, (_, i) => ({ x1: 0.105 + i * 0.0015, y1: 0.4978, x2: 0.105 + i * 0.0015 + 0.0044, y2: 0.5022 }));
    expect(hatchedRuns([wall], bunched, FPU).has(wall)).toBe(false);
  });

  it("never takes a drywall default, and takes a masonry one the legend names", () => {
    const a = { id: "a", code: "A", name: "A", hasParts: true, thicknessIn: 6 };
    const b = { id: "b", code: "B", name: "B", hasParts: true, thicknessIn: 6 };
    const hollow = run(0.1, 0.7, 0.3, 0.7);
    const clusters = [{ inches: 6, runs: [wall, hollow], feet: 40 }];
    const drywall = { type: a, note: "ALL INTERIOR DRYWALL PARTITIONS ARE TYPE 'A' U.N.O." };
    const got = wallGroups(clusters, new Map(), [a], drywall, new Set([wall]));
    expect(got.map((g) => [g.runs[0], g.source.kind])).toEqual([[hollow, "GENERAL_NOTE"], [wall, "REMAINDER"]]);
    const both = wallGroups(clusters, new Map(), [a, b], { ...drywall, others: [{ type: b, note: "ALL INTERIOR MASONRY PARTITIONS ARE TYPE 'B'" }] }, new Set([wall]));
    expect(both.map((g) => [g.runs[0], g.source.kind, g.candidates[0]?.code])).toEqual([[hollow, "GENERAL_NOTE", "A"], [wall, "GENERAL_NOTE", "B"]]);
  });
});

describe("a floor plan with no wall tags reads them off its sibling sheet (Green Bay A3.1 / A3.2)", () => {
  // Paper 1000 pt wide at 100 ft per width: 1 pt = 0.1 ft. One building, its
  // walls as face pairs 5 pt apart; the sibling draws it 30 pt right and 20 pt
  // down, with one square tag "B" beside the third wall.
  const W = 1000;
  const walls: [number, number, number, number][] = [[100, 100, 400, 100], [100, 100, 100, 330], [180, 220, 400, 220], [260, 100, 260, 220], [100, 330, 300, 330], [400, 100, 400, 330], [300, 260, 300, 330]];
  const faces = (dx: number, dy: number): StrokeSegment[] =>
    walls.flatMap(([x1, y1, x2, y2]) => (y1 === y2 ? [[0, -2.5], [0, 2.5]] : [[-2.5, 0], [2.5, 0]]).map(([ox, oy]) => ({ x1: x1 + ox! + dx, y1: y1 + oy! + dy, x2: x2 + ox! + dx, y2: y2 + oy! + dy })));
  const square = (cx: number, cy: number): StrokeSegment[] => [[cx - 9, cy - 9, cx + 9, cy - 9], [cx + 9, cy - 9, cx + 9, cy + 9], [cx + 9, cy + 9, cx - 9, cy + 9], [cx - 9, cy + 9, cx - 9, cy - 9]].map(([x1, y1, x2, y2]) => ({ x1: x1!, y1: y1!, x2: x2!, y2: y2! }));
  const found = { walls: walls.map(([x1, y1, x2, y2]) => run(x1 / W, y1 / W, x2 / W, y2 / W)) } as never;
  const types = ["A", "B"].map((code) => ({ id: code, code, name: code, hasParts: true, thicknessIn: null }));
  const sibling = { segmentsPt: [...faces(30, 20), ...square(320, 252)], textItems: [{ str: "B", x: 315, y: 256, width: 10, height: 8 }], widthPt: W };

  it("types the wall under the sibling's tag, marked as read elsewhere", () => {
    const got = tagsFromSibling({ found, segmentsPt: faces(0, 0), widthPt: W, feetPerUnit: FPU, wallTypes: types, legendCodes: ["A", "B"], sibling });
    expect(got).not.toBeNull();
    const third = (found as unknown as { walls: WallCandidate[] }).walls[2]!;
    expect(got!.byRun.get(third)).toBe(siblingTag("B"));
    expect(isSiblingTag(got!.byRun.get(third)!)).toBe(true);
  });

  it("reads nothing from a sheet that does not line up, or is another paper size", () => {
    expect(tagsFromSibling({ found, segmentsPt: faces(0, 0), widthPt: W, feetPerUnit: FPU, wallTypes: types, legendCodes: ["A", "B"], sibling: { ...sibling, segmentsPt: square(320, 252) } })).toBeNull();
    expect(tagsFromSibling({ found, segmentsPt: faces(0, 0), widthPt: W, feetPerUnit: FPU, wallTypes: types, legendCodes: ["A", "B"], sibling: { ...sibling, widthPt: 1200 } })).toBeNull();
  });

  it("finds the siblings by sheet number, never a demolition plan", () => {
    const sheets = [
      { pageNumber: 9, sheetNumber: "A3.1", title: "FLOOR PLAN" },
      { pageNumber: 10, sheetNumber: "A3.2", title: "DIMENSION PLAN" },
      { pageNumber: 11, sheetNumber: "A3.3", title: "DEMOLITION PLAN" },
      { pageNumber: 12, sheetNumber: "A4.1", title: "RCP" },
      { pageNumber: 13, sheetNumber: "A101", title: "FLOOR PLAN" },
    ];
    expect(siblingPages(sheets, 9)).toEqual([10]);
    expect(siblingPages(sheets, 13)).toEqual([]);
  });
});

describe("the groups an estimator confirms are wider than the finder's (the new-customer walk's 20 groups on A101)", () => {
  it("puts walls drawn 4.6\" and 5.6\" thick in one group to confirm, where the finder keeps them apart", () => {
    const walls = [run(0.1, 0.1, 0.3, 0.1, 4.6 / 12), run(0.1, 0.2, 0.3, 0.2, 5.6 / 12), run(0.1, 0.3, 0.3, 0.3, 8 / 12)];
    expect(clusterByThickness(walls, CLUSTER_INCHES)).toHaveLength(3);
    const staged = groupsForStage({ found: { walls, inUnits: [] } as never, segmentsPt: [], textItems: [], widthPt: 1000, feetPerUnit: FPU, wallTypes: [], legendCodes: null });
    expect(staged.groups.map((g) => g.runs.length).sort()).toEqual([1, 2]);
    expect(STAGE_CLUSTER_INCHES).toBeGreaterThan(CLUSTER_INCHES);
  });
});
