import { describe, expect, it } from "vitest";
import { MAX_CURVE_PIECES, curvedWalls } from "./curvedWalls";
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

  it("REFUSES A CLOSED LOOP, WHICH HAS NO LENGTH LIMIT AT ALL", () => {
    // The worst defect this module has had, found on a real permit set:
    // FLOOR PLAN LEVEL 1 reported 2,324,222 ft of wall, and the run
    // responsible had its two endpoints at the SAME POINT —
    //
    //     2.321e+6 ft  8.01in  (0.25,0.37) -> (0.25,0.37)  CURVED
    //
    // A chain that closes has a chord of zero and a path that wanders without
    // bound, and `lengthFeet` is the path. 8.01in is a plausible wall, so
    // nothing downstream had grounds to doubt it.
    //
    // Two concentric full circles are the smallest shape that reproduces it:
    // the thickness window accepts them, both clear the length floor, and both
    // turn 360 degrees so the turn requirement is no help.
    const ring = (radius: number) => arc(0, 0, radius, 0, 360, 120);
    const circles = [...ring(5 - half), ...ring(5 + half)];
    expect(circles.length).toBe(240);
    expect(curvedWalls(circles, OPTS), "a closed loop was sold as wall").toEqual([]);
  });

  it("still accepts a long arc that merely curls a long way", () => {
    // The other side of that bound: 270 degrees is a real shape — a curved
    // stair enclosure, a drum — and its chord is 30% of its path, well clear
    // of the quarter required. Without this the fix above could be "refuse
    // anything that curves much" and look just as green.
    const sweep = (radius: number) => arc(0, 0, radius, 0, 270, 90);
    const walls = curvedWalls([...sweep(8 - half), ...sweep(8 + half)], OPTS);
    expect(walls, "a 270 degree arc was refused").toHaveLength(1);
    expect(walls[0].lengthFeet).toBeCloseTo((270 * Math.PI * 8) / 180, 0);
  });

  it("returns nothing for an empty or trivial sheet", () => {
    expect(curvedWalls([], OPTS)).toEqual([]);
    expect(curvedWalls([{ x1: 0, y1: 0, x2: 1, y2: 0 }], OPTS)).toEqual([]);
  });
});

describe("a sheet too hatched to ask about curves", () => {
  /** `n` short strokes scattered about, the shape hatching takes. */
  function hatching(n: number): StrokeSegment[] {
    const out: StrokeSegment[] = [];
    for (let i = 0; i < n; i += 1) {
      const x = (i % 300) / 1000;
      const y = Math.floor(i / 300) / 1000;
      out.push({ x1: x, y1: y, x2: x + 0.0005, y2: y + 0.0005 });
    }
    return out;
  }

  const options = { feetPerUnit: 288, minThicknessFeet: 0.2, maxThicknessFeet: 1.5 };

  it("REFUSES THE PASS AND SAYS SO, rather than spending a minute on it", () => {
    // ── THE MEASUREMENT BEHIND THE CAP ──
    //
    // Camp Bow Wow's A102 carries 143,438 segments and 126,943 of them are
    // under the piece length — 88%, because hatching is drawn in tiny
    // strokes. `assemble` scans every piece on every growth step, so that
    // cost 58.9 of the 61.3 seconds the whole of detection took.
    //
    // Refused, the same sheet takes 2.5 seconds.
    let refusedWith: number | null = null;
    const walls = curvedWalls(hatching(MAX_CURVE_PIECES + 1), {
      ...options,
      onRefused: (pieces) => {
        refusedWith = pieces;
      },
    });
    expect(walls).toEqual([]);
    // SAYING SO IS THE POINT. A pass that silently did not run is the
    // vacuous green this repo keeps paying for — the caller turns this into
    // a caution on the sheet.
    expect(refusedWith).toBe(MAX_CURVE_PIECES + 1);
  });

  it("does not refuse a sheet just under the cap", () => {
    // The boundary, so the cap cannot drift to "most sheets" without a test
    // going red.
    let refused = false;
    curvedWalls(hatching(MAX_CURVE_PIECES - 1), {
      ...options,
      onRefused: () => {
        refused = true;
      },
    });
    expect(refused).toBe(false);
  });

  it("leaves every committed fixture well clear of the cap", () => {
    // The claim the cap rests on: no synthetic plan in this repo comes near
    // it, so this changes nothing about the twenty-plan score — which held at
    // 13 of 17 within 2% across the change.
    //
    // 8,000 is roughly 1.5 seconds of assembly. A fixture that approached it
    // would be a fixture that had started to look like a real sheet, and
    // that is worth knowing rather than discovering in a profile.
    expect(MAX_CURVE_PIECES).toBeGreaterThan(5_000);
  });
});

/**
 * ── A CURVED WALL WITH A WINDOW IN IT IS STILL ONE WALL ──
 *
 * Measured on a held-out library plan: its reading room is a 55 ft arc with
 * three 4 ft windows, and it came back as three fragments totalling about half
 * its length. The gaps between the fragments were 4.00 ft and 2.99 ft — the
 * window and door widths from that plan's own key, to the inch.
 *
 * Two things were wrong and the second is the subtle one. The pieces were
 * never joined, and the pieces that were left were then DISCARDED: a 7 ft
 * fragment of a 26.9 ft-radius wall turns 14.9 degrees, just under the 15
 * `MIN_TOTAL_TURN` wants, so it failed the "is this an arc" test while the
 * wall it belongs to turns 117.
 */
describe("an opening does not end a curved wall", () => {
  const half = 6.5 / 12 / 2;

  /** The bay, with a `gapDeg` hole cut out of the middle of both faces. */
  const bayWithGap = (gapDeg: number): StrokeSegment[] => {
    const mid = (FROM + TO) / 2;
    const out: StrokeSegment[] = [];
    for (const radius of [RADIUS - half, RADIUS + half]) {
      const step = (TO - FROM) / 40;
      for (let i = 0; i < 40; i += 1) {
        const a = FROM + i * step;
        const b = FROM + (i + 1) * step;
        // Drop the pieces that fall inside the opening.
        if (b > mid - gapDeg / 2 && a < mid + gapDeg / 2) continue;
        const ar = (a * Math.PI) / 180;
        const br = (b * Math.PI) / 180;
        out.push({
          x1: CENTRE.x + radius * Math.cos(ar),
          y1: CENTRE.y + radius * Math.sin(ar),
          x2: CENTRE.x + radius * Math.cos(br),
          y2: CENTRE.y + radius * Math.sin(br),
          width: 0.8,
        });
      }
    }
    return out;
  };

  it("JOINS ACROSS THE OPENING AND REPORTS ONE WALL", () => {
    // A 3 ft door in a 7.2 ft-radius bay is about 24 degrees of it.
    const walls = curvedWalls(bayWithGap(24), OPTS);
    expect(walls, "the opening split the wall in two").toHaveLength(1);
  });

  it("reports the GROSS length, with the opening included", () => {
    const whole = curvedWalls([...face(RADIUS - half, 40), ...face(RADIUS + half, 40)], OPTS);
    const broken = curvedWalls(bayWithGap(24), OPTS);
    expect(broken).toHaveLength(1);
    // Within a few per cent of the unbroken wall: the chord across the
    // opening is slightly shorter than the arc it replaces, and that is the
    // only difference there should be.
    expect(broken[0].lengthFeet).toBeGreaterThan(whole[0].lengthFeet * 0.93);
    expect(broken[0].lengthFeet).toBeLessThanOrEqual(whole[0].lengthFeet + 0.01);
  });

  it("does not join across a gap wider than any opening", () => {
    // 8 ft is `MAX_OPENING_FEET`; at this radius 90 degrees is far past it,
    // and two arcs that far apart are two walls.
    const walls = curvedWalls(bayWithGap(90), OPTS);
    expect(walls.length === 0 || walls.length >= 2).toBe(true);
  });

  /**
   * ── AND THE GUARD THAT JOINING EXPOSED ──
   *
   * `totalTurn` summed the ABSOLUTE turn at every vertex, which is safe only
   * while chains are short. Once a chain could run a whole wall, a straight
   * line drawn in many small pieces accumulated enough jitter to pass as an
   * arc: a real forming plan reported 113 curved runs and 974 ft, one of them
   * a 56.7 ft "arc" whose ends have the same y.
   */
  it("A JITTERY STRAIGHT LINE IS NOT AN ARC, however many pieces it has", () => {
    const pieces: StrokeSegment[] = [];
    for (const offset of [-0.27, 0.27]) {
      for (let i = 0; i < 120; i += 1) {
        // Alternating jitter: the net turn is zero, the summed turn is not.
        const wobble = (i % 2 === 0 ? 1 : -1) * 0.004;
        pieces.push({
          x1: i * 0.4,
          y1: offset + wobble,
          x2: (i + 1) * 0.4,
          y2: offset - wobble,
          width: 0.8,
        });
      }
    }
    expect(curvedWalls(pieces, OPTS), "a straight line was read as a curve").toEqual([]);
  });
});

/**
 * ── AN OPENING JOINS TWO PIECES OF ONE ARC, AND NOTHING ELSE ──
 *
 * Joining across openings shipped without this and put 19 curved runs — 176 ft
 * — onto a real forming plan that had none before. On the drawing they sat on
 * HATCHED FILL carrying evenly spaced stud symbols, and on a stair's diagonal
 * break line. Hatching is short parallel strokes; chain a few of them, find
 * the next chain along, and the gap between is a door's width.
 *
 * Three rules were tried against that sheet, and the two that failed are the
 * reason the third is written as it is:
 *
 *   | rule                                   | phantoms left |
 *   | a chain must bend at all (3 degrees)   | 5 runs, 27.7 ft |
 *   | …and bend mostly one way (60%)         | 3 runs, 33.1 ft |
 *   | …and both pieces on the SAME CIRCLE    | **0** |
 *
 * The middle row matters more than the last: making the join STRICTER made the
 * output WORSE. Refusing one chain frees its neighbours to pair with something
 * else, so this is not monotonic, and a rule here cannot be tuned by watching
 * one number fall.
 *
 * ── HOW THIS FIXTURE WAS ARRIVED AT, BECAUSE THREE EARLIER ONES PROVED
 *    NOTHING ──
 *
 * A hatch field at 13.2 in spacing, two arcs placed near each other, and a
 * tangent-continuous S were all written first, and EVERY mutation of the new
 * rule left all three green. Each was being refused by something else before
 * the rule was ever consulted: the first fell outside the thickness window,
 * the second's ends were too far apart to join, and at an inflection the two
 * faces swap sides so an S never reaches the join at all.
 *
 * The case below was found by sweeping spacing and bend and watching which
 * one the rule actually changes. It is kept at exactly that setting:
 * **6.4 ft with the rule, 16.3 ft without.**
 */
describe("only two pieces of the same arc are joined", () => {
  const half = 6.5 / 12 / 2;

  /**
   * Two bands of short strokes, each drifting gently, a wall's width apart,
   * with an opening-sized hole in the middle of both.
   *
   * `bend` is why this is a fixture and not a constant: at bend 2 and above
   * the two halves really are close to one circle, and joining them is the
   * right answer. Bend 1 is the drift of a hatch line that was drawn straight.
   */
  const hatchBands = (bend: number): StrokeSegment[] => {
    const out: StrokeSegment[] = [];
    for (let band = 0; band < 2; band += 1) {
      let x = 0;
      let y = band * 0.5;
      for (const run of [0, 1]) {
        for (let i = 0; i < 14; i += 1) {
          const dy = bend * (i + run * 14) * 0.01;
          out.push({ x1: x, y1: y, x2: x + 0.45, y2: y + dy, width: 0.6 });
          x += 0.45;
          y += dy;
        }
        x += 3; // the hole a door would leave
      }
    }
    return out;
  };

  it("DOES NOT JOIN TWO HATCH BANDS ACROSS THE GAP BETWEEN THEM", () => {
    const longest = curvedWalls(hatchBands(1), OPTS).reduce(
      (n, w) => Math.max(n, w.lengthFeet),
      0,
    );
    // Either half alone is about 6.3 ft. Joined, it is over 16.
    expect(longest, "hatching was joined into a wall").toBeLessThan(10);
  });

  it("still joins a real arc through an opening of the same width", () => {
    // The control. If this goes red the rule has stopped doing its job rather
    // than started doing it too well.
    const mid = (FROM + TO) / 2;
    const bay: StrokeSegment[] = [];
    for (const radius of [RADIUS - half, RADIUS + half]) {
      const step = (TO - FROM) / 40;
      for (let i = 0; i < 40; i += 1) {
        const a = FROM + i * step;
        const b = FROM + (i + 1) * step;
        if (b > mid - 12 && a < mid + 12) continue;
        const ar = (a * Math.PI) / 180;
        const br = (b * Math.PI) / 180;
        bay.push({
          x1: CENTRE.x + radius * Math.cos(ar),
          y1: CENTRE.y + radius * Math.sin(ar),
          x2: CENTRE.x + radius * Math.cos(br),
          y2: CENTRE.y + radius * Math.sin(br),
          width: 0.8,
        });
      }
    }
    const walls = curvedWalls(bay, OPTS);
    expect(walls, "the arc did not survive its own opening").toHaveLength(1);
    expect(walls[0].lengthFeet).toBeGreaterThan(arcLength(RADIUS) * 0.93);
  });
});
