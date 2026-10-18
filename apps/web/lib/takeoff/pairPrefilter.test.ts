import { describe, expect, it } from "vitest";
import { DEFAULTS, wallsFromStrokes } from "./wallVectors";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── THE PREFILTER MUST ONLY EVER REMOVE PAIRS THAT WOULD HAVE FAILED ──
 *
 * The pairer's inner loop rejects a candidate in four comparisons when the two
 * segments' bounding boxes are more than a wall thickness apart. That is sound
 * because a pair is a wall only if it is within `maxThicknessFeet`
 * PERPENDICULAR *and* the faces OVERLAP along their length — together those
 * mean the nearest points of the two segments are within a thickness, so the
 * boxes are too.
 *
 * On Camp Bow Wow A101 it removes 99.8% of candidates — 136,744,453 down to
 * 286,783 — and the number that SUCCEED is identical at 6,938. That is the
 * claim; these are the cases where getting the margin wrong would show.
 *
 * ── WHY IT MATTERS MORE THAN A SPEEDUP ──
 *
 * The budget was `n*(n-1)/2 > MAX_PAIR_TESTS`, decided before any work. A101
 * scores 136.7 million on that and was REFUSED — a sheet that takes seven
 * seconds, turned away on a prediction. The counter that replaced it is only
 * honest if the thing it counts is the thing that matters, and that depends
 * entirely on this filter never dropping a real wall.
 */

/** 1/8" = 1'-0" on a 36in sheet. */
const feetPerPoint = 288 / 2592;

/** Two faces of one wall, `thicknessFeet` apart, `lengthFeet` long. */
function wall(thicknessFeet: number, lengthFeet = 20, atY = 100): StrokeSegment[] {
  const len = lengthFeet / feetPerPoint;
  const gap = thicknessFeet / feetPerPoint;
  return [
    { x1: 100, y1: atY, x2: 100 + len, y2: atY },
    { x1: 100, y1: atY + gap, x2: 100 + len, y2: atY + gap },
  ];
}

describe("the bounding-box prefilter keeps every pair that could be a wall", () => {
  it("finds a wall at the very TOP of the thickness band", () => {
    // The case a margin that is too tight loses first, and it would lose it
    // silently: the wall simply stops being reported.
    const found = wallsFromStrokes(wall(DEFAULTS.maxThicknessFeet - 0.001), { feetPerPoint });
    expect(found).toHaveLength(1);
    expect(found[0].thicknessFeet).toBeCloseTo(DEFAULTS.maxThicknessFeet - 0.001, 2);
  });

  it("finds a wall at the very BOTTOM of the band", () => {
    const found = wallsFromStrokes(wall(DEFAULTS.minThicknessFeet + 0.001), { feetPerPoint });
    expect(found).toHaveLength(1);
  });

  it("still refuses a pair beyond the band, which the filter must not rescue", () => {
    // The filter is a superset: it lets things through for the predicate to
    // reject. A pair just past the maximum must still be rejected, or the
    // margin has become a thickness band of its own.
    expect(wallsFromStrokes(wall(DEFAULTS.maxThicknessFeet + 0.2), { feetPerPoint })).toHaveLength(
      0,
    );
  });

  it("finds a LONG wall, where the boxes are large and the gap is small", () => {
    // A 200ft wall is 1800pt of bounding box against a 10pt thickness. If the
    // comparison were written on centres or lengths rather than box EDGES,
    // this is the shape that would break.
    const found = wallsFromStrokes(wall(0.5, 200), { feetPerPoint });
    expect(found).toHaveLength(1);
    expect(found[0].lengthFeet).toBeGreaterThan(190);
  });

  it("finds walls that are near each other without merging them", () => {
    // Two walls a few feet apart: all four faces are within each other's
    // neighbourhood, so the filter keeps all six pairs and the predicate has
    // to do the separating. The answer is two walls, not one wide one.
    const found = wallsFromStrokes([...wall(0.5, 20, 100), ...wall(0.5, 20, 130)], {
      feetPerPoint,
    });
    expect(found).toHaveLength(2);
  });

  it("DOES NOT PAIR two faces that never overlap, however close their lines", () => {
    // Collinear and end to end — perpendicular distance is zero, so only the
    // overlap test separates them. The prefilter sees boxes far apart in x and
    // skips the pair; the predicate would have rejected it anyway, and this
    // asserts the two agree.
    const len = 20 / feetPerPoint;
    const found = wallsFromStrokes(
      [
        { x1: 100, y1: 100, x2: 100 + len, y2: 100 },
        { x1: 100 + len * 3, y1: 100.1, x2: 100 + len * 4, y2: 100.1 },
      ],
      { feetPerPoint },
    );
    expect(found).toHaveLength(0);
  });
});
