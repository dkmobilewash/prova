import { describe, expect, it } from "vitest";
import { DRAWN_COVERAGE_MIN, drawnCoverage, wallsActuallyDrawn } from "./drawnCoverage";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── THE RULE THAT REMOVES HATCHING MUST NOT REMOVE AN ANGLED WALL ──
 *
 * These two cases are the whole argument and they are deliberately side by
 * side: a 45° WALL drawn as two continuous lines, and a 45° HATCH of ticks at
 * the same angle whose faces the pairer has assembled into a long run. If one
 * rule keeps the first and drops the second, a diagonal wall still works and
 * A120's X patterns do not.
 *
 * The mutation that matters is making the rule ANGLE-AWARE — "distrust a
 * diagonal run" would pass the hatch case and fail the wall. It is written out
 * in the last test rather than described, so the claim is checked rather than
 * asserted in a comment.
 */

/** A page-width-units sheet where one unit of length is one foot. */
const FEET_PER_UNIT = 1;

function wall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thicknessFeet: number,
): WallCandidate {
  return {
    x1,
    y1,
    x2,
    y2,
    thicknessFeet,
    lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FEET_PER_UNIT,
  };
}

function seg(x1: number, y1: number, x2: number, y2: number): StrokeSegment {
  return { x1, y1, x2, y2 };
}

/** The two faces of a wall from `from` to `to`, `thickness` apart. */
function faces(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  thickness: number,
): StrokeSegment[] {
  const len = Math.hypot(toX - fromX, toY - fromY);
  const nx = (-(toY - fromY) / len) * (thickness / 2);
  const ny = ((toX - fromX) / len) * (thickness / 2);
  return [
    seg(fromX + nx, fromY + ny, toX + nx, toY + ny),
    seg(fromX - nx, fromY - ny, toX - nx, toY - ny),
  ];
}

describe("a wall that is actually drawn", () => {
  it("reads 1.0 for a horizontal wall drawn end to end", () => {
    const run = wall(0, 10, 20, 10, 0.5);
    const cover = drawnCoverage(run, faces(0, 10, 20, 10, 0.5), 0.25);
    expect(cover).toBeGreaterThan(0.99);
  });

  it("reads 1.0 for a 45-degree wall drawn end to end — the case that must survive", () => {
    const run = wall(0, 0, 14.14, 14.14, 0.5);
    const cover = drawnCoverage(run, faces(0, 0, 14.14, 14.14, 0.5), 0.25);
    expect(cover).toBeGreaterThan(0.99);
  });

  it("reads near zero for a 45-degree run assembled from hatch ticks", () => {
    // ── THE A120 SHAPE, BUILT FROM THE MEASURED SHEET ──
    //
    // 20 ft of run with a 1-inch tick every 11 inches along each face. The
    // tick length is A120's own median (0.08 ft) and the spacing is what its
    // measured 0.09 coverage implies — not a number picked to pass: a first
    // version of this fixture used the 1.85in PERPENDICULAR pitch as the
    // along-spacing, which makes a 54%-covered DASHED LINE rather than a
    // hatch, and it correctly survived the filter.
    //
    // THAT IS A REAL BOUND ON THIS RULE and is left stated rather than fixed:
    // a run assembled from closely-spaced collinear dashes is not caught here.
    // Nothing on A120 has that shape, and a rule for it would have to tell a
    // dashed hatch from the dashed line a drafter uses for an overhead or a
    // wall to be demolished — a different question from this one.
    const run = wall(0, 0, 14.14, 14.14, 0.64);
    const ticks: StrokeSegment[] = [];
    const pitch = 11 / 12;
    const tick = 1 / 12;
    const ux = 1 / Math.SQRT2;
    const uy = 1 / Math.SQRT2;
    for (let along = 0; along < 20; along += pitch) {
      for (const side of [-0.32, 0.32]) {
        const ox = -uy * side;
        const oy = ux * side;
        ticks.push(
          seg(ux * along + ox, uy * along + oy, ux * (along + tick) + ox, uy * (along + tick) + oy),
        );
      }
    }
    const cover = drawnCoverage(run, ticks, 0.32);
    expect(cover).toBeLessThan(0.2);
    expect(cover).toBeLessThan(DRAWN_COVERAGE_MIN);
  });

  it("keeps a wall broken by two doorways, which is the threshold's real constraint", () => {
    // 15 ft of wall with two 3 ft openings: 0.6 covered, and it must survive.
    const run = wall(0, 0, 15, 0, 0.5);
    const drawn: StrokeSegment[] = [];
    for (const [from, to] of [
      [0, 4],
      [7, 10],
      [13, 15],
    ] as const) {
      drawn.push(...faces(from, 0, to, 0, 0.5));
    }
    const cover = drawnCoverage(run, drawn, 0.25);
    expect(cover).toBeCloseTo(0.6, 1);
    expect(cover).toBeGreaterThan(DRAWN_COVERAGE_MIN);
  });

  it("does not let two faces at one place add up past 1", () => {
    // Both faces lie along the whole run, so a SUM would report 2.0. The union
    // is what makes the number a fraction of the run rather than of the ink.
    const run = wall(0, 0, 10, 0, 0.5);
    expect(drawnCoverage(run, faces(0, 0, 10, 0, 0.5), 0.25)).toBeLessThanOrEqual(1);
  });

  it("ignores a stroke that is parallel but outside the run's own thickness", () => {
    // A dimension line 2 ft below a 6in wall is parallel and the full length,
    // and it is not what is drawing this wall.
    const run = wall(0, 0, 10, 0, 0.5);
    const cover = drawnCoverage(run, [seg(0, -2, 10, -2)], 0.25);
    expect(cover).toBe(0);
  });

  it("ignores a stroke crossing the run at a right angle", () => {
    const run = wall(0, 0, 10, 0, 0.5);
    expect(drawnCoverage(run, [seg(5, -3, 5, 3)], 0.25)).toBe(0);
  });
});

describe("the filter over a set of runs", () => {
  const drawnWall = wall(0, 0, 20, 0, 0.5);
  const hatchWall = wall(0, 5, 14.14, 19.14, 0.64);
  const strokes = [
    ...faces(0, 0, 20, 0, 0.5),
    // one lone tick near the diagonal, so it is not merely strokeless
    seg(0.1, 5.1, 0.2, 5.2),
  ];

  it("keeps the drawn wall and drops the one with nothing along it", () => {
    const kept = wallsActuallyDrawn([drawnWall, hatchWall], strokes, FEET_PER_UNIT);
    expect(kept).toHaveLength(1);
    expect(kept[0].x2).toBe(20);
  });

  it("keeps a curved run untouched, because its length is an arc and not its chord", () => {
    const bay: WallCandidate = { ...hatchWall, curved: true };
    const kept = wallsActuallyDrawn([bay], strokes, FEET_PER_UNIT);
    expect(kept).toHaveLength(1);
  });

  it("filters nothing when there is no calibration to measure a thickness in", () => {
    const kept = wallsActuallyDrawn([drawnWall, hatchWall], strokes, 0);
    expect(kept).toHaveLength(2);
  });

  /**
   * ── THE MUTATION, WRITTEN OUT ──
   *
   * The rule this replaces would have been "a diagonal run is suspect". Both
   * assertions below hold for the real rule; the second is the one that fails
   * under that mutation, which is why it is here rather than in a comment.
   */
  it("treats a 45-degree wall and a horizontal wall identically", () => {
    const horizontal = wall(0, 0, 14.14, 0, 0.5);
    const diagonal = wall(0, 0, 10, 10, 0.5);
    const both = wallsActuallyDrawn(
      [horizontal, diagonal],
      [...faces(0, 0, 14.14, 0, 0.5), ...faces(0, 0, 10, 10, 0.5)],
      FEET_PER_UNIT,
    );
    expect(both).toHaveLength(2);
  });
});
