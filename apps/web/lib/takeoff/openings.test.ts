import { describe, expect, it } from "vitest";
import { openingsInWalls, NARROWEST_DOOR_FEET, WIDEST_DOOR_FEET } from "./openings";
import type { StrokeSegment } from "./wallVectors";

/**
 * THE DOORWAYS THAT MERGE EVERY ROOM INTO ONE.
 *
 * Measured on West Herr: 32,256 of that sheet's 49,162 sq ft of room is a SINGLE
 * region, because every doorway joins the rooms either side of it. The walls
 * inside it then separate that region from itself and are rejected — 1,062
 * wall-width regions found and almost all discarded.
 *
 * These tests are mostly about the FALSE closure rather than the true one,
 * because the two failures are not symmetric. A missed opening costs exactly
 * what today costs. A line drawn where no door is splits one room in two and
 * invents a wall between them — and an estimator cannot see that a wall which is
 * not there is wrong.
 *
 * One unit is one foot here.
 */

const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2 });

/**
 * A WALL — two faces 0.4ft apart along y = 7 and y = 7.4 — broken by a
 * `gap`-wide opening at x = 20.
 *
 * BOTH FACES, because a gap is only closed in a line that has a parallel partner
 * a wall's thickness away. Every fixture here drew a single line at first, which
 * is a furniture edge rather than a wall, and the partner rule correctly
 * refused the lot of them.
 *
 * Off y = 0 as well, so that a closure rebuilt without its offset term — drawn
 * through the origin instead of across the door — cannot pass.
 */
function faceWithGap(gap: number, runBefore = 20, runAfter = 20): StrokeSegment[] {
  return [
    seg(20 - runBefore, 7, 20, 7),
    seg(20 + gap, 7, 20 + gap + runAfter, 7),
    seg(20 - runBefore, 7.4, 20, 7.4),
    seg(20 + gap, 7.4, 20 + gap + runAfter, 7.4),
  ];
}

/** The same wall's far face, for fixtures that build their near face inline. */
function partnerOf(segments: StrokeSegment[], apart = 0.4): StrokeSegment[] {
  return segments.map((t) => ({ x1: t.x1, y1: t.y1 + apart, x2: t.x2, y2: t.y2 + apart }));
}

describe("finding the openings in a wall", () => {
  it("closes a 3ft door", () => {
    // TWO closures, not one: a doorway is a gap in BOTH faces of the wall, and
    // both have to be closed or the cavity still leaks into the rooms through
    // the face that was left open.
    const found = openingsInWalls(faceWithGap(3), 1);
    expect(found).toHaveLength(2);
    for (const o of found) expect(o.widthFeet).toBeCloseTo(3, 5);
  });

  it("puts the closing line ACROSS THE GAP, on the wall's own line", () => {
    // If the endpoints are wrong the line is drawn somewhere else on the sheet,
    // splitting a room that has no wall in it.
    //
    // THE WALL IS AT y = 7, NOT y = 0, and that is the whole value of this test:
    // on a wall through the origin the line's offset term is zero, so dropping
    // it entirely — drawing every closure through the origin — left the first
    // version of this test green.
    const face = [seg(0, 7, 20, 7), seg(23, 7, 43, 7)];
    const [found] = openingsInWalls([...face, ...partnerOf(face)], 1);
    expect(found.x1).toBeCloseTo(20, 4);
    expect(found.x2).toBeCloseTo(23, 4);
    expect(found.y1).toBeCloseTo(7, 4);
    expect(found.y2).toBeCloseTo(7, 4);
  });

  it("closes a face drawn RIGHT-TO-LEFT the same as one drawn left-to-right", () => {
    // CAD emits a face in whatever direction the geometry was built. Without
    // normalising the orientation the reversed half forms its own parallel
    // family, and the door between them is never seen.
    //
    // ONE FORWARD AND ONE REVERSED, which is the case that bites. Reversing BOTH
    // left them consistent with each other — same family, same offset, same
    // answer — so the first version of this test passed with the normalisation
    // deleted. A mixed pair is what a real export produces and what breaks.
    const face = [seg(0, 7, 20, 7), seg(43, 7, 23, 7)];
    const found = openingsInWalls([...face, ...partnerOf(face)], 1);
    expect(found).toHaveLength(2); // one per face
    for (const o of found) expect(o.widthFeet).toBeCloseTo(3, 4);
  });

  it("REFUSES two lines that share an offset but not an angle", () => {
    // Both pass through the origin. Keying a family on distance alone would put
    // them together and close a gap between points on two different walls.
    const face = [seg(0, 0, 20, 0), seg(0, 23, 0, 43)];
    // Partners for both, so the refusal is about the ANGLE rather than about
    // neither line looking like a wall.
    expect(
      openingsInWalls(
        [...face, ...partnerOf(face), ...face.map((t) => ({ x1: t.x1 + 0.4, y1: t.y1, x2: t.x2 + 0.4, y2: t.y2 }))],
        1,
      ),
    ).toEqual([]);
  });

  it("merges an OVERLAPPING piece rather than letting it break the chain", () => {
    // A detail line drawn over part of a face. Unmerged, the short piece sits
    // between the two halves in sorted order and both gaps around it fall
    // outside a door's bounds — so the real door is lost.
    const face = [seg(0, 7, 20, 7), seg(2, 7, 6, 7), seg(23, 7, 43, 7)];
    const found = openingsInWalls([...face, ...partnerOf(face)], 1);
    expect(found).toHaveLength(2); // one per face
    for (const o of found) expect(o.widthFeet).toBeCloseTo(3, 4);
  });

  it("applies the NARROW bound in feet, at a scale where units and feet diverge", () => {
    // At 0.25 ft per unit a 4-unit gap is one foot — a draughting break, not a
    // door. Read as 4 units against a bound of 2 it would be accepted.
    const face = [seg(0, 7, 40, 7), seg(44, 7, 84, 7)];
    expect(openingsInWalls([...face, ...partnerOf(face, 1)], 0.25)).toEqual([]);
  });

  it("works on a wall that is not axis-aligned", () => {
    // A diagonal wall's opening is still an opening, and the reconstruction of
    // the closing line is where that would break first.
    const k = Math.SQRT1_2;
    const face = [seg(0, 0, 10 * k, 10 * k), seg(13 * k, 13 * k, 23 * k, 23 * k)];
    // The partner sits across the wall, perpendicular to it — shifting it in y
    // alone would slide it ALONG a 45-degree wall rather than across it.
    const across = face.map((t) => ({
      x1: t.x1 - 0.4 * k,
      y1: t.y1 + 0.4 * k,
      x2: t.x2 - 0.4 * k,
      y2: t.y2 + 0.4 * k,
    }));
    const found = openingsInWalls([...face, ...across], 1);
    expect(found).toHaveLength(2); // one per face
    for (const o of found) {
      expect(o.widthFeet).toBeCloseTo(3, 4);
      expect(Math.hypot(o.x2 - o.x1, o.y2 - o.y1)).toBeCloseTo(3, 4);
    }
  });

  it("REFUSES a gap too narrow to be a door", () => {
    // Below a closet door, a break in a line is far likelier to be draughting —
    // a witness-line break, a line type, a corner that does not quite meet.
    expect(openingsInWalls(faceWithGap(NARROWEST_DOOR_FEET - 0.5), 1)).toEqual([]);
  });

  it("REFUSES a gap too wide to be a door, which is the dangerous one", () => {
    // Past a cased opening this stops being a hole in a wall and becomes the
    // ABSENCE of a wall. Closing an open-plan edge would fabricate a room
    // boundary and then a ring of walls around it.
    expect(openingsInWalls(faceWithGap(WIDEST_DOOR_FEET + 5), 1)).toEqual([]);
  });

  it("REFUSES a gap with no wall standing beside it", () => {
    // Two short ticks that happen to line up — a furniture edge, a leader, a
    // hatch stroke — are not a jamb pair.
    expect(openingsInWalls(faceWithGap(3, 0.3, 0.3), 1)).toEqual([]);
  });

  it("REFUSES two segments that are parallel but not the same line", () => {
    // The two FACES of one wall are parallel and about 5in apart. Treating them
    // as one line would close a diagonal across the wall instead of across the
    // door.
    const found = openingsInWalls([seg(0, 0, 20, 0), seg(23, 0.4, 43, 0.4)], 1);
    expect(found).toEqual([]);
  });

  it("REFUSES two segments at an angle to each other", () => {
    const face = [seg(0, 7, 20, 7), seg(23, 7, 43, 16)];
    expect(openingsInWalls([...face, ...partnerOf(face)], 1)).toEqual([]);
  });

  it("treats a face drawn in many collinear pieces as ONE wall", () => {
    // CAD exports a long face as dozens of pieces. Each join is a zero-width
    // gap; if those counted, every wall would be full of invented doors.
    const pieces: StrokeSegment[] = [];
    for (let i = 0; i < 20; i += 1) pieces.push(seg(i, 7, i + 1, 7));
    for (let i = 23; i < 43; i += 1) pieces.push(seg(i, 7, i + 1, 7));
    const found = openingsInWalls([...pieces, ...partnerOf(pieces)], 1);
    expect(found).toHaveLength(2); // one per face
    for (const o of found) expect(o.widthFeet).toBeCloseTo(3, 4);
  });

  it("finds SEVERAL openings along one wall", () => {
    const face = [seg(0, 7, 20, 7), seg(23, 7, 40, 7), seg(44, 7, 60, 7)];
    const found = openingsInWalls([...face, ...partnerOf(face)], 1);
    expect(found).toHaveLength(4); // two doors, one closure per face each
    expect(found.map((o) => Math.round(o.widthFeet)).sort()).toEqual([3, 3, 4, 4]);
  });

  it("scales its bounds with the sheet, not with the page", () => {
    // Half a foot per unit makes a 6-unit gap a 3ft door; at 1ft per unit the
    // same gap is 6ft. Both are doors, and a gap of 6 units at 4ft per unit is
    // 24ft and is not.
    expect(openingsInWalls(faceWithGap(6), 0.5)[0].widthFeet).toBeCloseTo(3, 4);
    expect(openingsInWalls(faceWithGap(6), 0.5)).toHaveLength(2);
    expect(openingsInWalls(faceWithGap(6), 4)).toEqual([]);
  });

  it("REFUSES a gap in a line with NO PARALLEL PARTNER — furniture, not a wall", () => {
    // The rule that stopped this hurting a closed-plan sheet. A drawing is full
    // of collinear lines that are not walls: furniture, grid lines, hatching,
    // leaders. Closing a gap in one of those adds ink that cuts real wall
    // cavities into pieces too short to report — measured, it took Augusta from
    // 472ft of wall DOWN to 323ft.
    expect(openingsInWalls([seg(0, 7, 20, 7), seg(23, 7, 43, 7)], 1)).toEqual([]);
  });

  it("REFUSES a partner too far away to be the other side of a wall", () => {
    // Two lines 6ft apart are the two sides of a corridor, not of a wall.
    const face = [seg(0, 7, 20, 7), seg(23, 7, 43, 7)];
    expect(openingsInWalls([...face, ...partnerOf(face, 6)], 1)).toEqual([]);
  });

  it("returns nothing rather than throwing on an empty sheet or no scale", () => {
    expect(openingsInWalls([], 1)).toEqual([]);
    expect(openingsInWalls(faceWithGap(3), 0)).toEqual([]);
  });

  it("ignores a zero-length segment instead of dividing by its length", () => {
    expect(() => openingsInWalls([seg(5, 5, 5, 5), ...faceWithGap(3)], 1)).not.toThrow();
    expect(openingsInWalls([seg(5, 5, 5, 5), ...faceWithGap(3)], 1)).toHaveLength(2);
  });
});
