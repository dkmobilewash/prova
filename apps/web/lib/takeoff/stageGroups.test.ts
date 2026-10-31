import { describe, expect, it } from "vitest";
import { hatchedRuns } from "./stageGroups";
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
