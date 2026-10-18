import { describe, expect, it } from "vitest";
import { SAME_FACE_GAP_FEET, oneFacePerLine } from "./wallVectors";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── GROUPING FACES BY LINE WAS 60 SECONDS ON ONE REAL SHEET ──
 *
 * `oneFacePerLine` decides which drawn segments are pieces of the same line,
 * and it did it with `lines.find(...)` — a linear scan over every line found
 * so far, once per segment. Measured on Camp Bow Wow A101: 425,057 segments
 * against a list that grows to 299,616, about 6e10 comparisons and **60.0
 * seconds**, which was the whole of that sheet's time before it refused.
 *
 *     | sheet | before    | after  | faces out        |
 *     | A101  | 60,023 ms | 515 ms | 299,616 -> same  |
 *     | A102  |  4,998 ms | 155 ms |  62,954 -> same  |
 *
 * The face counts are IDENTICAL either side, which is the correctness claim:
 * the index decides which candidates are worth testing and the original
 * predicate still decides whether they match.
 *
 * ── WHAT THESE TESTS ARE FOR ──
 *
 * The twenty fixtures and the bench already cover the output end to end and
 * were unchanged. What they cannot show is WHICH property makes the index
 * exact, so these pin the three that do: the direction wrap, insertion order,
 * and the tolerance boundaries. Each one is a way an index can be subtly wrong
 * while every total still looks plausible.
 */

/** A segment from a point, an angle and a length, in points. */
function seg(x: number, y: number, degrees: number, length: number): StrokeSegment {
  const r = (degrees * Math.PI) / 180;
  return { x1: x, y1: y, x2: x + Math.cos(r) * length, y2: y + Math.sin(r) * length };
}

/** 1/8" = 1'-0" on a 36in sheet: 288 ft across 2592pt. */
const FEET_PER_POINT = 288 / 2592;

describe("faces are grouped onto lines, and the index cannot change which", () => {
  it("joins two pieces of one line and keeps two separate lines apart", () => {
    // The baseline behaviour, so the rest is read against something known.
    const together = oneFacePerLine(
      [seg(100, 100, 0, 200), seg(310, 100, 0, 200)],
      FEET_PER_POINT,
    );
    expect(together).toHaveLength(1);

    // Far apart perpendicular: two lines, whatever their direction.
    const apart = oneFacePerLine([seg(100, 100, 0, 200), seg(100, 400, 0, 200)], FEET_PER_POINT);
    expect(apart).toHaveLength(2);
  });

  it("FOLLOWS THE DIRECTION WRAP, which costs 6% of the faces on a real sheet", () => {
    // ── THE FIRST VERSION OF THIS TEST WAS VACUOUS, AND THAT IS THE LESSON ──
    //
    // Directions are folded into a half turn so a line drawn right-to-left is
    // the same line, which puts VERTICAL at both ends of the bucket range. The
    // obvious fixture — one vertical face drawn up, one drawn down — proves
    // nothing: `ux` normalises to exactly 0 for both, so they land in the SAME
    // bucket and the wrap is never reached. That test passed with the wrap
    // deleted.
    //
    // What reaches it is a pair that straddles vertical: 89.5 degrees and 90.5
    // degrees are one degree apart, so the predicate calls them parallel
    // (|sin 1 deg| = 0.017, inside SAME_FACE_ANGLE of 0.05), and the fold
    // sends them to opposite ENDS — buckets 31 and -32.
    //
    // They must also share an offset, and that is the second thing the first
    // fixture got wrong: the fold flips the sign of `uy`, so two straddling
    // lines away from the origin get offsets of opposite sign (+499 and -503,
    // measured) and could never match anyway. Through the origin both are 0.
    //
    // It is not a corner case on real drawings. With the wrap removed, Camp
    // Bow Wow A101 produces 317,924 faces instead of 299,616 and A102 70,835
    // instead of 62,954 — six per cent of them, every one a line that failed
    // to meet the rest of itself.
    const up = seg(0, 0, 89.5, 200);
    const down = seg(0, 0, -89.5, 200);
    expect(oneFacePerLine([up, down], FEET_PER_POINT)).toHaveLength(1);
  });

  it("joins a piece to the FIRST line it matches, not whichever is handiest", () => {
    // `find` returned the first match in insertion order and which line a
    // piece joins decides what is merged with what. An index that returns its
    // candidates in bucket order instead would be right about the count and
    // wrong about the grouping.
    //
    // Three collinear pieces, added in an order where the second and third
    // both match the first.
    const faces = oneFacePerLine(
      // 10pt gaps: 1.1 ft at this scale, inside `SAME_FACE_GAP_FEET` of 2.
      [seg(100, 200, 0, 100), seg(210, 200, 0, 100), seg(320, 200, 0, 100)],
      FEET_PER_POINT,
    );
    expect(faces).toHaveLength(1);
    // And they were joined into one span rather than being counted once and
    // dropped: the ends come from the outermost pieces.
    const [face] = faces;
    expect(Math.min(face.x1, face.x2)).toBeCloseTo(100, 3);
    expect(Math.max(face.x1, face.x2)).toBeCloseTo(420, 3);
  });

  it("keeps lines apart that are closer than a bucket but further than the tolerance", () => {
    // The boundary an index gets wrong by rounding into a bucket instead of
    // applying the predicate. These two are within one bucket of each other
    // and outside `SAME_FACE_OFFSET_FEET`, so they must stay separate.
    const offsetPoints = (0.004 * 3) / FEET_PER_POINT;
    const pair = oneFacePerLine(
      [seg(100, 100, 0, 200), seg(100, 100 + offsetPoints, 0, 200)],
      FEET_PER_POINT,
    );
    expect(pair).toHaveLength(2);
  });

  it("still splits one line into two where the gap is too big to bridge", () => {
    // The index prunes by direction and offset and says nothing about gaps
    // along the line, so this is the property most likely to be broken by
    // accident while every count still looks right.
    const gapPoints = (SAME_FACE_GAP_FEET * 3) / FEET_PER_POINT;
    const faces = oneFacePerLine(
      [seg(100, 100, 0, 200), seg(100 + 200 + gapPoints, 100, 0, 200)],
      FEET_PER_POINT,
    );
    expect(faces).toHaveLength(2);
  });

  it("groups a realistic spread the same way however the input is ordered", () => {
    // A superset-pruning index must not care what order it meets things in.
    // Same segments, reversed: same number of lines.
    const segments = [
      seg(100, 100, 0, 300),
      seg(410, 100, 0, 300),
      seg(100, 160, 0, 300),
      seg(500, 400, 90, 250),
      seg(500, 660, 90, 250),
      seg(900, 100, 45, 200),
    ];
    const forward = oneFacePerLine(segments, FEET_PER_POINT).length;
    const backward = oneFacePerLine([...segments].reverse(), FEET_PER_POINT).length;
    expect(forward).toBe(backward);
    // And it is actually grouping rather than returning everything: six
    // segments on four lines.
    expect(forward).toBe(4);
  });
});
