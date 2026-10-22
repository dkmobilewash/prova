import { describe, expect, it } from "vitest";
import {
  FACE_MARGIN_FEET,
  MAX_BAND_FEET,
  SAME_WALL_FEET,
  keyFromLabels,
  matchBandFeet,
  scoreSheet,
  type ScoredRun,
} from "./heldOutScore";

/**
 * ── A CENTRE LINE AND A FACE ARE THE SAME WALL ──
 *
 * The finder proposes a wall's CENTRE LINE: it builds a run from two faces.
 * A reviewer tracing a wall the finder missed draws along what they can see,
 * which on a thick masonry wall is a FACE. The two are half a thickness
 * apart by construction, and neither is wrong.
 *
 * With a fixed 1.5 ft band that offset scored as MISSING and EXTRA at once —
 * the finder punished twice for being right about a wall.
 *
 * ── THESE ARE SYNTHETIC WALLS, ON PURPOSE ──
 *
 * The geometry here is written to the principle: half a thickness plus a
 * margin. Nothing in this file was measured on, fitted to, or checked against
 * a held-out sheet. The tolerance follows from what a centre line and a face
 * ARE; if it were tuned until Central Bank scored well, the score would stop
 * meaning anything.
 */
const FPU = 100; // 100 ft across the page width

const at = (
  y: number,
  x1: number,
  x2: number,
  thicknessFeet?: number,
): ScoredRun => ({
  x1: x1 / FPU,
  y1: y / FPU,
  x2: x2 / FPU,
  y2: y / FPU,
  lengthFeet: x2 - x1,
  thicknessFeet,
});

const score = (key: ScoredRun[], proposed: ScoredRun[]) =>
  scoreSheet({ set: "S", sheet: "A1", key, proposed, feetPerUnit: FPU });

describe("the band a wall is matched within", () => {
  it("is the old fixed one for a thin partition", () => {
    // A 4-inch stud wall: half of it is two inches, far inside the band that
    // was already there. Nothing changes for the ordinary case.
    expect(matchBandFeet(at(10, 0, 20, 4 / 12), at(10, 0, 20, 4 / 12))).toBe(SAME_WALL_FEET);
  });

  it("GROWS with a thick masonry wall", () => {
    // A 3 ft wall traced on its face sits 1.5 ft from the centre line, which
    // the fixed band could not reach.
    const band = matchBandFeet(at(10, 0, 20, 3), at(10, 0, 20));
    expect(band).toBeCloseTo(3 / 2 + FACE_MARGIN_FEET);
    expect(band).toBeGreaterThan(SAME_WALL_FEET);
  });

  it("is driven by whichever of the pair KNOWS its thickness", () => {
    // A traced wall carries none — the reviewer drew a line, not two faces —
    // so the proposal's thickness is what decides.
    const trace = at(10, 0, 20);
    const proposal = at(10.8, 0, 20, 2);
    expect(matchBandFeet(trace, proposal)).toBeCloseTo(1 + FACE_MARGIN_FEET);
  });

  it("is CAPPED, so a run cannot claim the wall across the hall", () => {
    // Widening a band to admit a face costs the ability to tell two walls
    // apart. A corridor is rarely under 3 ft.
    expect(matchBandFeet(at(10, 0, 20, 40), at(10, 0, 20))).toBe(MAX_BAND_FEET);
  });
});

describe("scoring a face-traced masonry wall", () => {
  // A 3 ft masonry wall. The finder proposes its centre line; the reviewer
  // traced the face, 1.5 ft away.
  const centreLine = at(10, 0, 40, 3);
  const tracedFace = at(11.5, 0, 40);

  it("is ONE wall, not a miss and an invention", () => {
    const got = score([tracedFace], [centreLine]);
    expect(got.missingFeet, "the traced face scored as missing").toBeCloseTo(0);
    expect(got.extraFeet, "the centre line scored as invented").toBeCloseTo(0);
    expect(got.netFeet).toBeCloseTo(0);
  });

  it("THE SAME OFFSET IS SCORED TWICE WRONG WHEN NO THICKNESS IS KNOWN", () => {
    // ── THE CONTROL, AND WHY IT IS AT 2 FT AND NOT 1.5 ──
    //
    // The first version of this put the face 1.5 ft from the centre line and
    // expected a double failure. It matched: 1.5 is exactly `SAME_WALL_FEET`
    // and the test is `> band`, so the old fixed band already reached that
    // far. The offsets that actually broke are the ones BEYOND it, which is
    // what a 3 ft wall gives and what Diego read off the overlays.
    //
    // So: identical geometry, 2 ft apart, differing only in whether the
    // thickness is known. That isolates the BAND rather than the
    // coordinates.
    const blind = score([at(12, 0, 40)], [at(10, 0, 40)]);
    expect(blind.missingFeet, "no thickness: the face is a miss").toBeCloseTo(40);
    expect(blind.extraFeet, "no thickness: the centre line is an invention").toBeCloseTo(40);

    const knowing = score([at(12, 0, 40)], [at(10, 0, 40, 3)]);
    expect(knowing.missingFeet, "thickness known: one wall").toBeCloseTo(0);
    expect(knowing.extraFeet).toBeCloseTo(0);
  });

  it("still refuses a wall a room away", () => {
    // 8 ft off a 3 ft wall is another wall, and the cap keeps it that way.
    const got = score([tracedFace], [at(19.5, 0, 40, 3)]);
    expect(got.missingFeet).toBeCloseTo(40);
    expect(got.extraFeet).toBeCloseTo(40);
  });

  it("matches a face traced on EITHER side", () => {
    const other = at(8.5, 0, 40);
    expect(score([other], [centreLine]).missingFeet).toBeCloseTo(0);
  });

  it("DOES absorb a partition within half a masonry wall's thickness", () => {
    // ── THE COST OF A DERIVED BAND, STATED RATHER THAN HIDDEN ──
    //
    // A 3 ft masonry wall reaches 2 ft, so a 4-inch partition 2 ft away is
    // inside it: the finder proposing only the masonry is credited with
    // both. That is a real loss of resolution and it is the price of not
    // scoring every face-traced masonry wall as a miss AND an invention.
    //
    // The trade is worth taking because of the direction of the two errors.
    // Absorbing a neighbour makes the finder look slightly BETTER on a sheet
    // where it found the big wall; the fixed band made it look twice as bad
    // on every thick wall anybody traced. The second was systematic across a
    // whole building; this is a two-foot coincidence.
    //
    // Asserted so that nobody discovers it as a surprise, and so that making
    // the band narrower later shows up here as a changed expectation rather
    // than as a silently different score.
    const key = [centreLine, at(12, 0, 40, 4 / 12)];
    expect(score(key, [centreLine]).missingFeet).toBeCloseTo(0);
  });

  it("does not absorb a partition beyond that reach", () => {
    // Half a foot further and the two are separable again. The cliff is the
    // band, and it is where the thickness puts it.
    const key = [centreLine, at(12.6, 0, 40, 4 / 12)];
    expect(score(key, [centreLine]).missingFeet).toBeCloseTo(40);
  });
});

describe("the key carries thickness through", () => {
  it("keeps an accepted wall's thickness and a trace's zero", () => {
    const { key } = keyFromLabels({
      verdicts: [
        { x1: 0, y1: 0.1, x2: 0.4, y2: 0.1, lengthFeet: 40, thicknessFeet: 3, verdict: "wall" },
        { x1: 0, y1: 0.3, x2: 0.4, y2: 0.3, lengthFeet: 40, thicknessFeet: 0, verdict: "traced" },
      ],
    });
    expect(key[0].thicknessFeet).toBe(3);
    expect(key[1].thicknessFeet).toBe(0);
  });

  it("survives a label file that records no thickness at all", () => {
    // Older files predate the field. They must score, at the fixed band.
    const { key } = keyFromLabels({
      verdicts: [{ x1: 0, y1: 0.1, x2: 0.4, y2: 0.1, lengthFeet: 40, verdict: "wall" }],
    });
    expect(key[0].thicknessFeet).toBeUndefined();
    expect(matchBandFeet(key[0], key[0])).toBe(SAME_WALL_FEET);
  });
});
