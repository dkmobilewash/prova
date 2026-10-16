import { describe, expect, it } from "vitest";
import { curvedWalls } from "./curvedWalls";
import type { StrokeSegment } from "./wallVectors";

/**
 * One unit is one foot here, so the geometry reads directly. S07's bay is the
 * case every number comes from: an arc of radius 7.211 ft from (12,0) to
 * (24,0) about (18,4), whose chord is 12.0 ft and whose CENTRELINE ARC is
 * 14.17 ft, drawn by the generator as straight pieces of about 0.15 ft.
 */
const OPTS = { feetPerUnit: 1, minThicknessFeet: 0.2, maxThicknessFeet: 1.0833 };

const CENTRE = { x: 18, y: 4 };
const RADIUS = 7.211102550927979;
const FROM = -146.30993247402023;
const TO = -33.690067525979785;

/** One face of the bay, polygonised into `pieces` straight segments. */
function face(radius: number, pieces: number, width = 0.8): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  const step = (TO - FROM) / pieces;
  for (let i = 0; i < pieces; i += 1) {
    const a = ((FROM + i * step) * Math.PI) / 180;
    const b = ((FROM + (i + 1) * step) * Math.PI) / 180;
    out.push({
      x1: CENTRE.x + radius * Math.cos(a),
      y1: CENTRE.y + radius * Math.sin(a),
      x2: CENTRE.x + radius * Math.cos(b),
      y2: CENTRE.y + radius * Math.sin(b),
      width,
    });
  }
  return out;
}

/** The true arc length of a face at `radius`. */
const arcLength = (radius: number) => (((TO - FROM) * Math.PI) / 180) * radius;

/**
 * Any arc, so a case can disqualify itself on ONE guard at a time.
 *
 * The mutation run is why this exists. Four guards survived their own tests
 * because each case was being refused by a DIFFERENT guard first — a stub arc
 * scaled down to test the length floor had its thickness scaled with it and
 * died on the thickness window, so removing the floor changed nothing. A case
 * has to fail for the reason it names.
 */
function arc(cx: number, cy: number, radius: number, fromDeg: number, sweepDeg: number, pieces = 40): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let i = 0; i < pieces; i += 1) {
    const a = ((fromDeg + (i * sweepDeg) / pieces) * Math.PI) / 180;
    const b = ((fromDeg + ((i + 1) * sweepDeg) / pieces) * Math.PI) / 180;
    out.push({
      x1: cx + radius * Math.cos(a),
      y1: cy + radius * Math.sin(a),
      x2: cx + radius * Math.cos(b),
      y2: cy + radius * Math.sin(b),
      width: 0.8,
    });
  }
  return out;
}

describe("a curved wall is measured along its centreline", () => {
  const half = 6.5 / 12 / 2;
  const bay = [...face(RADIUS - half, 95), ...face(RADIUS + half, 95)];

  it("MEASURES THE ARC, NOT THE CHORD", () => {
    const walls = curvedWalls(bay, OPTS);
    expect(walls).toHaveLength(1);
    // 14.17 ft of wall across a 12.0 ft chord. Measuring the chord is a 15%
    // under-measure on the one shape that is expensive to build.
    expect(walls[0].lengthFeet).toBeCloseTo(14.17, 1);
    const chord = Math.hypot(walls[0].x2 - walls[0].x1, walls[0].y2 - walls[0].y1);
    expect(chord, "the endpoints are the chord, and that is what makes the length matter").toBeCloseTo(12, 0);
    expect(walls[0].lengthFeet / chord).toBeGreaterThan(1.15);
  });

  it("gets the thickness from the gap between the faces", () => {
    const walls = curvedWalls(bay, OPTS);
    expect(walls[0].thicknessFeet * 12).toBeCloseTo(6.5, 0);
  });

  it("marks the run curved, because its length is not its endpoints", () => {
    expect(curvedWalls(bay, OPTS)[0].curved).toBe(true);
  });

  it("WORKS ON PIECES THAT CARRY NO `curved` FLAG, which is the whole point", () => {
    // Not one of the 190 pieces above has the flag, exactly as S07's bay does
    // not: the flag marks a Bézier that THIS renderer flattened, and a drawing
    // that polygonised its own arcs upstream has none. The first version of
    // this module filtered on the flag and found every arc on S07 except the
    // wall.
    expect(bay.every((piece) => piece.curved === undefined)).toBe(true);
    expect(curvedWalls(bay, OPTS)).toHaveLength(1);
  });

  it("the mean of two faces' path lengths IS the centreline arc", () => {
    // Stated as an identity rather than a measurement, because it is why no
    // arc is fitted and no radius is recovered anywhere in this module.
    const inner = arcLength(RADIUS - half);
    const outer = arcLength(RADIUS + half);
    expect((inner + outer) / 2).toBeCloseTo(arcLength(RADIUS), 6);
    expect(inner).toBeLessThan(arcLength(RADIUS));
    expect(outer).toBeGreaterThan(arcLength(RADIUS));
  });

  it("REFUSES A DASHED STRAIGHT LINE, which is short pieces joined end to end", () => {
    // The shape test admits any run of short pieces, so without a turn
    // requirement a dashed line, a row of jamb ticks or a hatch run would all
    // assemble into "curved walls".
    const dashes = (y: number): StrokeSegment[] =>
      Array.from({ length: 40 }, (_, i) => ({
        x1: i * 0.3,
        y1: y,
        x2: i * 0.3 + 0.3,
        y2: y,
        width: 0.8,
      }));
    expect(curvedWalls([...dashes(0), ...dashes(0.542)], OPTS), "a dashed line became a wall").toEqual([]);
  });

  it("refuses a chain too short to be a wall, ON LENGTH ALONE", () => {
    // 20 degrees at radius 5 is 1.75 ft of run: under the 2 ft floor, while
    // the thickness is a real 6-1/2in, the two faces are the same length, and
    // the turn is 20 degrees against a 15 degree bar. Only the floor refuses
    // it, which is what makes this a test OF the floor.
    const shortRun = [...arc(0, 0, 5 - half, 0, 20), ...arc(0, 0, 5 + half, 0, 20)];
    const run = (((20 * Math.PI) / 180) * 5).toFixed(2);
    expect(Number(run)).toBeLessThan(2);
    expect(curvedWalls(shortRun, OPTS), `a ${run} ft arc was sold as a wall`).toEqual([]);
  });

  it("refuses one face on its own, because a thickness needs two", () => {
    expect(curvedWalls(face(RADIUS, 95), OPTS)).toEqual([]);
  });

  it("refuses two arcs too far apart, ON THE GAP ALONE", () => {
    // Both faces 5.24 ft long, so the length ratio is 1.00 and cannot be the
    // thing refusing them; both turn well past the bar; both clear the floor.
    // They are 4 ft apart, which is no wall anybody builds.
    const outer = arc(0, 0, 10, 0, 30);
    const inner = arc(0, 0, 6, 0, 50);
    expect(((30 * Math.PI) / 180) * 10).toBeCloseTo(((50 * Math.PI) / 180) * 6, 1);
    expect(curvedWalls([...outer, ...inner], OPTS), "a 4 ft gap was read as a thickness").toEqual([]);
  });

  it("refuses two faces of very different lengths, ON THE RATIO ALONE", () => {
    // Concentric and 6-1/2in apart, so the thickness window accepts them, and
    // both clear the length floor and the turn bar. One face spans the whole
    // bay and the other a quarter of it: that is not one wall's two faces, and
    // pairing them would report the mean of 14.2 and 3.8.
    const whole = face(RADIUS - half, 95);
    const quarter = arc(CENTRE.x, CENTRE.y, RADIUS + half, FROM, 30);
    expect(curvedWalls([...whole, ...quarter], OPTS), "two unlike faces were paired").toEqual([]);
  });

  it("DOES NOT CHAIN ACROSS A CORNER, even when chaining would clear the floor", () => {
    // Two arcs of 1.4 ft meeting at a right angle. Each is under the 2 ft
    // floor on its own, so nothing survives — but if the joint test is
    // removed they become one 2.8 ft chain, the 90 degree corner counts
    // towards the turn, and a two-legged corner is reported as a curved wall.
    //
    // The pair is drawn twice, 6-1/2in apart, so the thickness window and the
    // length ratio both accept it and the joint test is the only thing left.
    const leg = (cx: number, cy: number, r: number, from: number) => arc(cx, cy, r, from, 16);
    const elbow = (r: number) => [...leg(0, 0, r, 0), ...leg(0, 0, r, 90)];
    const pieces = [...elbow(5 - half), ...elbow(5 + half)];
    expect(curvedWalls(pieces, OPTS), "two legs of a corner became one curved wall").toEqual([]);
  });

  it("returns nothing for an empty or trivial sheet", () => {
    expect(curvedWalls([], OPTS)).toEqual([]);
    expect(curvedWalls([{ x1: 0, y1: 0, x2: 1, y2: 0 }], OPTS)).toEqual([]);
  });
});
