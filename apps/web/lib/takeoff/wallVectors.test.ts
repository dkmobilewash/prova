import { describe, expect, it } from "vitest";
import { wallFromPair, wallsFromStrokes, type StrokeSegment, type WallFinderOptions,
  clusterByThickness,
  CLUSTER_INCHES,
  type WallCandidate,
} from "./wallVectors";

/**
 * Wall detection from vector strokes, with no PDF and no model involved.
 *
 * Every number here is a real one at a real scale. At 1/8" = 1'-0" one foot of
 * building is 9 page points, so `feetPerPoint` is 1/9 — and a 4-7/8" partition
 * (0.406 ft) is 3.66pt of paper. The cases are built in points because that is
 * what a PDF gives us, and asserted in feet because that is what a bid is in.
 */

/** 1/8" = 1'-0": 1 ft of building = 9 pt of paper. */
const EIGHTH: WallFinderOptions = { feetPerPoint: 1 / 9 };

/** A horizontal segment at `y`, from `x` for `len` points. */
const h = (x: number, y: number, len: number): StrokeSegment => ({ x1: x, y1: y, x2: x + len, y2: y });
/** A vertical segment at `x`, from `y` for `len` points. */
const v = (x: number, y: number, len: number): StrokeSegment => ({ x1: x, y1: y, x2: x, y2: y + len });

/** A 4-7/8" partition is 3.66pt at this scale. */
const PARTITION_PT = 0.40625 * 9;

describe("two faces a wall-thickness apart are a wall", () => {
  it("finds a 20ft partition from its two faces", () => {
    // 20 ft at 9pt/ft is 180pt.
    const wall = wallFromPair(h(100, 500, 180), h(100, 500 + PARTITION_PT, 180), EIGHTH);
    expect(wall).not.toBeNull();
    expect(wall?.lengthFeet).toBeCloseTo(20, 1);
    expect(wall?.thicknessFeet).toBeCloseTo(0.406, 2);
  });

  it("puts the centreline between the faces, where somebody tracing would", () => {
    const wall = wallFromPair(h(100, 500, 180), h(100, 500 + PARTITION_PT, 180), EIGHTH);
    // Halfway between y=500 and y=503.66.
    expect(wall?.y1).toBeCloseTo(500 + PARTITION_PT / 2, 1);
    expect(wall?.y2).toBeCloseTo(500 + PARTITION_PT / 2, 1);
  });

  it("works vertically as well as horizontally", () => {
    const wall = wallFromPair(v(100, 300, 180), v(100 + PARTITION_PT, 300, 180), EIGHTH);
    expect(wall?.lengthFeet).toBeCloseTo(20, 1);
  });

  it("finds an 18in shaft wall, the thickest thing still a wall", () => {
    const wall = wallFromPair(h(100, 500, 180), h(100, 500 + 1.5 * 9, 180), EIGHTH);
    expect(wall).not.toBeNull();
    expect(wall?.thicknessFeet).toBeCloseTo(1.5, 1);
  });
});

describe("what is NOT a wall, which is most of a drawing", () => {
  it("rejects two lines across a CORRIDOR — too far apart to be one wall", () => {
    // A 5ft corridor: 45pt. Two walls, not one.
    expect(wallFromPair(h(100, 500, 180), h(100, 545, 180), EIGHTH)).toBeNull();
  });

  it("rejects two lines a HATCH apart — too close to be a wall", () => {
    // Poché strokes sit a point or two apart: 0.17ft, under the 0.2 floor.
    expect(wallFromPair(h(100, 500, 180), h(100, 501.5, 180), EIGHTH)).toBeNull();
  });

  it("rejects lines that are not parallel", () => {
    const slanted: StrokeSegment = { x1: 100, y1: 503, x2: 280, y2: 530 };
    expect(wallFromPair(h(100, 500, 180), slanted, EIGHTH)).toBeNull();
  });

  it("REJECTS A DIMENSION STRING, which is the case the overlap test exists for", () => {
    // A dimension string's witness lines are parallel to the wall and the right
    // distance from it — but they sit END TO END with it rather than beside it,
    // offset along the wall's own direction. Only the overlap test can tell
    // those apart, and without it every dimensioned wall would yield a phantom.
    const wall = h(100, 500, 180);
    const witness = h(300, 500 + PARTITION_PT, 180);
    expect(wallFromPair(wall, witness, EIGHTH)).toBeNull();
  });

  it("rejects a pair that barely overlaps", () => {
    // 20% overlap is two walls meeting at a corner, not one wall.
    expect(wallFromPair(h(100, 500, 180), h(244, 500 + PARTITION_PT, 180), EIGHTH)).toBeNull();
  });

  it("rejects a JAMB STUB — correct thickness, too short to be a wall", () => {
    // 1 ft of two-sided line at a door jamb. Real geometry, not a wall.
    expect(wallFromPair(h(100, 500, 9), h(100, 500 + PARTITION_PT, 9), EIGHTH)).toBeNull();
  });

  it("rejects a zero-length stroke rather than dividing by it", () => {
    const point: StrokeSegment = { x1: 100, y1: 500, x2: 100, y2: 500 };
    expect(wallFromPair(point, h(100, 503, 180), EIGHTH)).toBeNull();
    expect(wallFromPair(h(100, 500, 180), point, EIGHTH)).toBeNull();
  });

  it("rejects one line on its own", () => {
    expect(wallsFromStrokes([h(100, 500, 180)], EIGHTH)).toEqual([]);
  });
});

describe("the centreline spans only the two-sided part", () => {
  it("measures the OVERLAP, not the longer face", () => {
    // One face runs 30ft, its partner 20ft. Only 20ft of this is two-sided; the
    // rest is another wall's face or a drafting artefact, and claiming it would
    // overstate the footage on every sheet.
    const wall = wallFromPair(h(100, 500, 270), h(100, 500 + PARTITION_PT, 180), EIGHTH);
    expect(wall?.lengthFeet).toBeCloseTo(20, 1);
  });
});

describe("a plan's worth of strokes", () => {
  it("finds every wall of a four-sided room and no more", () => {
    const t = PARTITION_PT;
    const walls = wallsFromStrokes(
      [
        // North and south, 30ft each.
        h(100, 500, 270),
        h(100, 500 + t, 270),
        h(100, 320, 270),
        h(100, 320 + t, 270),
        // East and west, 20ft each.
        v(100, 320, 180),
        v(100 + t, 320, 180),
        v(370 - t, 320, 180),
        v(370, 320, 180),
      ],
      EIGHTH,
    );
    expect(walls).toHaveLength(4);
    const total = walls.reduce((sum, wall) => sum + wall.lengthFeet, 0);
    // 30 + 30 + 20 + 20.
    expect(total).toBeCloseTo(100, 0);
  });

  it("USES EACH FACE ONCE, so a shared wall is not counted twice", () => {
    // Two rooms sharing a middle wall: three parallel lines. That is ONE wall
    // between them plus whatever the outer faces pair with — never two walls
    // claiming the same middle face.
    const t = PARTITION_PT;
    const walls = wallsFromStrokes([h(100, 500, 180), h(100, 500 + t, 180), h(100, 500 + 2 * t, 180)], EIGHTH);
    expect(walls).toHaveLength(1);
  });

  it("does not report a wall twice when the strokes arrive in any order", () => {
    const t = PARTITION_PT;
    const forwards = wallsFromStrokes([h(100, 500, 180), h(100, 500 + t, 180)], EIGHTH);
    const backwards = wallsFromStrokes([h(100, 500 + t, 180), h(100, 500, 180)], EIGHTH);
    expect(forwards).toHaveLength(1);
    expect(backwards).toHaveLength(1);
    expect(forwards[0].lengthFeet).toBeCloseTo(backwards[0].lengthFeet, 3);
  });

  it("finds nothing on an empty sheet", () => {
    expect(wallsFromStrokes([], EIGHTH)).toEqual([]);
  });
});

describe("the scale is the caller's, not a constant here", () => {
  it("reads the SAME geometry as a different wall at a different scale", () => {
    // 3.66pt apart is a 4-7/8" partition at 1/8" scale and a 2-1/2" furring
    // wall at 1/4" — and at 1" = 1'-0" it is barely a quarter inch and not a
    // wall at all. A thickness tolerance in POINTS would have been silently
    // wrong on every sheet but one.
    const faces: [StrokeSegment, StrokeSegment] = [h(100, 500, 180), h(100, 500 + PARTITION_PT, 180)];
    const eighth = wallFromPair(faces[0], faces[1], { feetPerPoint: 1 / 9 });
    const quarter = wallFromPair(faces[0], faces[1], { feetPerPoint: 1 / 18 });
    const detail = wallFromPair(faces[0], faces[1], { feetPerPoint: 1 / 72 });
    expect(eighth?.thicknessFeet).toBeCloseTo(0.406, 2);
    expect(quarter?.thicknessFeet).toBeCloseTo(0.203, 2);
    // Below the 0.2ft floor: at detail scale these two lines are not a wall.
    expect(detail).toBeNull();
  });
});

/**
 * GROUPING THE WALLS A SHEET GAVE UP, which is what turns a list of 542 lines
 * into a decision an estimator can actually make.
 *
 * Shaped by measurement rather than by guesswork: seven real sheets returned
 * 15-21 thickness clusters each, not the three anybody would assume, with the
 * top three holding about half the footage. Both facts are in these tests.
 */
const run = (thicknessInches: number, lengthFeet: number): WallCandidate => ({
  x1: 0,
  y1: 0,
  x2: lengthFeet,
  y2: 0,
  thicknessFeet: thicknessInches / 12,
  lengthFeet,
});

describe("grouping walls by thickness", () => {
  it("merges the SAME wall drawn with CAD's own variation", () => {
    // Measured on a real sheet: 4.92" and 4.64" came back as separate values
    // holding 739ft and 682ft. They are one 4-7/8" partition.
    const clusters = clusterByThickness([run(4.92, 10), run(4.64, 10), run(4.88, 10)]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].runs).toHaveLength(3);
    expect(clusters[0].inches).toBeCloseTo(4.813, 2);
  });

  it("KEEPS TWO REAL WALL TYPES APART, which is the whole constraint", () => {
    // A 3-5/8" stud wall and a 4-7/8" partition are different material. Merging
    // them would add one type's footage to the other's — a wrong number on a
    // bid, with nothing on screen looking wrong.
    const clusters = clusterByThickness([run(3.625, 10), run(4.875, 10)]);
    expect(clusters).toHaveLength(2);
  });

  it("does not let a chain of near-misses walk a cluster across that gap", () => {
    // Each step is under the width; the span is 1.2", wider than the gap
    // between two real types. Clustering against the running MEAN would let
    // this drift into one group — it compares against the cluster's first
    // member for exactly this reason.
    const clusters = clusterByThickness([run(3.6, 1), run(4.0, 1), run(4.4, 1), run(4.8, 1)]);
    expect(clusters.length).toBeGreaterThan(1);
  });

  it("sorts by FOOTAGE, not by how many runs there are", () => {
    // The number a bid turns on is feet. Twenty short stubs are not a bigger
    // scope than four long corridor walls, and must not be offered as one.
    const clusters = clusterByThickness([
      ...Array.from({ length: 20 }, () => run(2.5, 3)), //  60 ft over 20 runs
      ...Array.from({ length: 4 }, () => run(4.875, 40)), // 160 ft over 4 runs
    ]);
    expect(clusters[0].inches).toBeCloseTo(4.875, 2);
    expect(clusters[0].feet).toBeCloseTo(160, 5);
    expect(clusters[0].runs).toHaveLength(4);
  });

  it("totals the footage of each group", () => {
    const clusters = clusterByThickness([run(6, 12.5), run(6, 7.5)]);
    expect(clusters[0].feet).toBeCloseTo(20, 5);
  });

  it("returns nothing for no walls, rather than an empty group", () => {
    expect(clusterByThickness([])).toEqual([]);
  });

  it("keeps every run — a wall cannot be lost between the groups", () => {
    // The property that matters most: this is presentation, and presentation
    // must not change the quantities. An estimator accepting every group must
    // get every wall that was found.
    const walls = [run(4.875, 10), run(2.5, 4), run(8, 20), run(4.9, 6), run(15.5, 3)];
    const clusters = clusterByThickness(walls);
    expect(clusters.reduce((n, c) => n + c.runs.length, 0)).toBe(walls.length);
    expect(clusters.reduce((f, c) => f + c.feet, 0)).toBeCloseTo(43, 5);
  });

  it("uses a width that is wider than CAD noise and narrower than a real gap", () => {
    // The constant is load-bearing in both directions, so it is asserted in
    // both: it must merge a 0.28" split and preserve a 1.25" one.
    expect(CLUSTER_INCHES).toBeGreaterThan(0.28);
    expect(CLUSTER_INCHES).toBeLessThan(1.25);
  });
});
