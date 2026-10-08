import { describe, expect, it } from "vitest";
import { wallRunsFromStrokes } from "./wallRuns";
import { wallsInTheBuilding, wallsNotTheSheetBorder, clusterByThickness } from "./wallVectors";
import type { StrokeSegment } from "./wallVectors";

/**
 * THE ROOM ENGINE IN THE SHAPE THE APP TAKES.
 *
 * The point of this adapter is that NOTHING DOWNSTREAM CHANGES: the same
 * `WallCandidate`, so the same filters, the same grouping, the same overlay. So
 * these tests check the two things that could make that false — the shape it
 * returns, and whether the existing filters still bite on it — as well as the
 * engine's own claim, which is the one the line pairer cannot make: a wall drawn
 * as SOLID POCHÉ is found.
 *
 * One unit is one foot here, so a 0.5 unit wall is a 6in wall.
 */

const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2 });

/** A rectangle's four sides. */
function box(x: number, y: number, w: number, h: number): StrokeSegment[] {
  return [
    seg(x, y, x + w, y),
    seg(x + w, y, x + w, y + h),
    seg(x + w, y + h, x, y + h),
    seg(x, y + h, x, y),
  ];
}

/**
 * Two rooms side by side sharing one wall, inside an outer shell — the smallest
 * drawing with a real interior partition in it. Every wall is two faces 0.5ft
 * apart.
 */
function twoRooms(): StrokeSegment[] {
  const t = 0.5;
  return [
    ...box(0, 0, 40, 24),
    ...box(t, t, 40 - 2 * t, 24 - 2 * t),
    // The shared partition, running the full height between the two rooms.
    seg(20, t, 20, 24 - t),
    seg(20 + t, t, 20 + t, 24 - t),
  ];
}

/**
 * A 3x3 grid of rooms inside a shell: four partitions and four shell walls,
 * which the junctions cut into well over a dozen runs.
 *
 * `wallsInTheBuilding` refuses a group of fewer than ten walls — a box is not a
 * building — so the two-room fixture above is deliberately too small for it and
 * this one exists for the filter tests. That refusal is the filter working, and
 * it is the fourth time on this feature that the fixture was the thing that was
 * wrong rather than the code.
 */
function nineRooms(): StrokeSegment[] {
  const t = 0.5;
  const out = [...box(0, 0, 60, 60), ...box(t, t, 60 - 2 * t, 60 - 2 * t)];
  for (const at of [20, 40]) {
    out.push(seg(at, t, at, 60 - t), seg(at + t, t, at + t, 60 - t));
    out.push(seg(t, at, 60 - t, at), seg(t, at + t, 60 - t, at + t));
  }
  return out;
}

describe("finding walls by finding rooms", () => {
  it("finds the shared partition between two rooms", () => {
    const walls = wallRunsFromStrokes(twoRooms(), 44, 28, { feetPerPoint: 1 });
    const upright = walls.filter((w) => Math.abs(w.x2 - w.x1) < 1 && w.lengthFeet > 15);
    expect(upright.length).toBeGreaterThan(0);
    expect(upright[0].x1).toBeGreaterThan(19);
    expect(upright[0].x1).toBeLessThan(22);
  });

  it("reports a thickness near the drawn one", () => {
    const walls = wallRunsFromStrokes(twoRooms(), 44, 28, { feetPerPoint: 1 });
    expect(walls.length).toBeGreaterThan(0);
    for (const w of walls) {
      expect(w.thicknessFeet).toBeGreaterThan(0.2);
      expect(w.thicknessFeet).toBeLessThan(1.2);
    }
  });

  it("RETURNS THE SAME SHAPE THE LINE PAIRER DOES, which is the whole point", () => {
    // If this drifts, every filter and the viewer's overlay stop working — and
    // they would stop SILENTLY, since a missing field reads as undefined.
    const [wall] = wallRunsFromStrokes(twoRooms(), 44, 28, { feetPerPoint: 1 });
    expect(wall).toBeDefined();
    expect(Object.keys(wall).sort()).toEqual(
      ["lengthFeet", "thicknessFeet", "x1", "x2", "y1", "y2"].sort(),
    );
    for (const v of Object.values(wall)) expect(Number.isFinite(v)).toBe(true);
  });

  it("STILL FEEDS THE EXISTING FILTERS — they are not reimplemented here", () => {
    // The whole design decision in one test: the engine changed and the filters
    // did not. If this reds, something downstream has been quietly duplicated.
    const walls = wallRunsFromStrokes(nineRooms(), 64, 64, { feetPerPoint: 1 });
    expect(walls.length).toBeGreaterThanOrEqual(10);
    expect(wallsInTheBuilding(walls, 1).length).toBeGreaterThan(0);
    expect(wallsNotTheSheetBorder(walls, 64, 1).length).toBeGreaterThan(0);
    expect(clusterByThickness(walls).length).toBeGreaterThan(0);
  });

  it("measures a length in feet, not in units", () => {
    // Half a foot per unit halves every length. A wall reported in the wrong
    // unit prices a bid at double or half.
    const atOne = wallRunsFromStrokes(twoRooms(), 44, 28, { feetPerPoint: 1 });
    const atHalf = wallRunsFromStrokes(twoRooms(), 44, 28, { feetPerPoint: 0.5 });
    const longest = (ws: typeof atOne) => Math.max(...ws.map((w) => w.lengthFeet));
    expect(longest(atHalf)).toBeLessThan(longest(atOne));
  });

  it("splits a run that turns a corner into TWO walls", () => {
    // An L is two walls meeting, and that is both what the type can express and
    // what an estimator prices.
    const t = 0.5;
    const drawing = [
      ...box(0, 0, 40, 40),
      ...box(t, t, 40 - 2 * t, 40 - 2 * t),
      seg(20, t, 20, 20),
      seg(20 + t, t, 20 + t, 20 + t),
      seg(20, 20, 39.5, 20),
      seg(20 + t, 20 + t, 39.5, 20 + t),
    ];
    const walls = wallRunsFromStrokes(drawing, 44, 44, { feetPerPoint: 1 });
    const upright = walls.filter((w) => Math.abs(w.x2 - w.x1) < 1.5 && w.lengthFeet > 8);
    const flat = walls.filter((w) => Math.abs(w.y2 - w.y1) < 1.5 && w.lengthFeet > 8);
    expect(upright.length).toBeGreaterThan(0);
    expect(flat.length).toBeGreaterThan(0);
  });

  it("KNOWN LIMIT: a wall drawn as ink so dense it fills solid is NOT found", () => {
    // Recorded as a limit rather than left as a claim, because the claim was
    // made first and was wrong. This engine finds a wall as the ENCLOSED REGION
    // between its faces, so a wall that is solid INK has no region to find.
    //
    // It does not follow that poché is unsupported. A poché wall in a PDF is
    // normally a FILLED PATH, and `sheetStrokes` emits that path's OUTLINE — so
    // the fill's interior is an enclosed region and it is found like any other
    // wall. What fails is the degenerate case below: hatching drawn at a spacing
    // finer than the grid, which rasterises to a solid band.
    //
    // Nobody has yet checked which form the real sheets use. Until somebody
    // does, this test states the boundary rather than guessing where it sits.
    const t = 0.5;
    const filled: StrokeSegment[] = [];
    for (let i = 0; i <= 20; i += 1) {
      const x = 20 + (i * t) / 20;
      filled.push(seg(x, t, x, 24 - t));
    }
    const walls = wallRunsFromStrokes(
      [...box(0, 0, 40, 24), ...box(t, t, 40 - 2 * t, 24 - 2 * t), ...filled],
      44,
      28,
      { feetPerPoint: 1 },
    );
    const throughTheBand = walls.filter((w) => w.x1 > 15 && w.x1 < 26 && w.lengthFeet > 15);
    expect(throughTheBand).toHaveLength(0);
  });

  it("finds that same wall when it arrives as a filled path's OUTLINE", () => {
    // Which is how a PDF fill reaches us, and is why the limit above is narrow.
    const t = 0.5;
    const walls = wallRunsFromStrokes(
      [...box(0, 0, 40, 24), ...box(t, t, 40 - 2 * t, 24 - 2 * t), ...box(20, t, t, 24 - 2 * t)],
      44,
      28,
      { feetPerPoint: 1 },
    );
    const upright = walls.filter((w) => Math.abs(w.x2 - w.x1) < 1 && w.lengthFeet > 15 && w.x1 > 15 && w.x1 < 26);
    expect(upright.length).toBeGreaterThan(0);
  });

  it("returns nothing rather than throwing on an empty sheet", () => {
    expect(wallRunsFromStrokes([], 44, 28, { feetPerPoint: 1 })).toEqual([]);
  });

  it("returns nothing when the sheet has no scale", () => {
    // A thickness bound in feet is meaningless without one, and a zero would
    // divide by zero into a grid of infinite size.
    expect(wallRunsFromStrokes(twoRooms(), 44, 28, { feetPerPoint: 0 })).toEqual([]);
  });

  it("rejects a gap far too wide to be a wall", () => {
    // Two rooms with nothing between them but 8ft of corridor: a wall bound is
    // what stops a corridor being billed as a shaft wall.
    const walls = wallRunsFromStrokes(twoRooms(), 44, 28, { feetPerPoint: 1, maxThicknessFeet: 0.3 });
    expect(walls.every((w) => w.thicknessFeet <= 0.3)).toBe(true);
  });
});
