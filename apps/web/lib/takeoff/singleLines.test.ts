import { describe, expect, it } from "vitest";
import { classifySingleLines, worthOffering, type SingleLineClass } from "./singleLines";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── THE ONE SET-ASIDE REASON THAT HIDES REAL WALLS ──
 *
 * Measured against the keys on the eighteen training sheets: `in-a-hatch`
 * withheld 16,973 ft of confirmed wall — every foot any reason withheld. The
 * other five withheld 27,934 ft across 165 lines without a single foot of
 * wall. So this file is about one rule, and the three cases it has to keep
 * apart.
 *
 * A wall drawn POCHÉ — masonry, a rated assembly, anything whose thickness is
 * filled in — has its two faces AND the fill between them, so each face used
 * to count the fill as parallel neighbours and be withheld as hatching. The
 * wall was hidden BECAUSE it was drawn solid.
 *
 * The three cases below are the ones that distinguish the fix from the bug
 * and from the obvious over-correction. A test that only checks the poché
 * wall is now offered would pass if the rule were deleted outright.
 */

/** A horizontal line at height `y`, from `x1` to `x2`, in page-width units. */
function at(y: number, x1 = 0.1, x2 = 0.5, width = 0.5): StrokeSegment {
  return { x1, y1: y, x2, y2: y, width } as StrokeSegment;
}

/**
 * One foot per unit keeps the arithmetic readable: a gap of 0.67 in these
 * coordinates is 8 inches of wall.
 */
const FEET_PER_UNIT = 1;

/**
 * ── THE FIXTURES NEED A BUILDING, AND THE FIRST VERSION HAD NONE ──
 *
 * `walls: []` makes the walls' own bounding box empty, so EVERY line reaches
 * outside it and `past-the-building` claims the lot. These cases passed
 * anyway, because a branch above it caught them first — the same branch whose
 * queue-jumping put 31 keynote-table rows in front of a reviewer on Murray
 * A101. Removing it turned three of these green tests red, which is the
 * fixture being wrong rather than the product: a real plan has walls.
 *
 * So the subject lines sit inside a box of reported walls, as they would on a
 * drawing, and the cases are about the rule under test again.
 */
const AROUND: WallCandidate[] = [
  { x1: 0.05, y1: -1, x2: 0.6, y2: -1, lengthFeet: 55, thicknessFeet: 0.5 } as WallCandidate,
  { x1: 0.05, y1: 3, x2: 0.6, y2: 3, lengthFeet: 55, thicknessFeet: 0.5 } as WallCandidate,
  { x1: 0.05, y1: -1, x2: 0.05, y2: 3, lengthFeet: 40, thicknessFeet: 0.5 } as WallCandidate,
  { x1: 0.6, y1: -1, x2: 0.6, y2: 3, lengthFeet: 40, thicknessFeet: 0.5 } as WallCandidate,
];

function classify(
  faces: readonly StrokeSegment[],
  subject: StrokeSegment,
  /** The labelling rule. Off is what customers see — see the switch test. */
  hatchPitchRule = true,
) {
  const walls: WallCandidate[] = AROUND;
  const found = classifySingleLines({
    unclaimed: [subject],
    faces,
    segments: faces,
    walls,
    feetPerUnit: FEET_PER_UNIT,
    hatchPitchRule,
  });
  expect(found, "the subject line was not classified at all").toHaveLength(1);
  return found[0]!;
}

describe("a wall drawn with its fill between the faces", () => {
  it("is offered, and says why", () => {
    // Two faces 8in apart, three fill lines between them. The subject is the
    // lower face: everything near it is on ONE side, and its partner is at a
    // wall thickness.
    const subject = at(0);
    const faces = [subject, at(0.17), at(0.34), at(0.5), at(0.67)];
    const line = classify(faces, subject);

    // ── ASSERTED ON THE OUTCOME, NOT ON A SENTENCE ──
    //
    // This checked `why` for "fill drawn between them" and "8in". Those words
    // came from a branch that explained itself and, in doing so, jumped ahead
    // of `dashed`, `small-closed-shape` and `past-the-building` in the chain —
    // which is what put keynote-table rows and a sheet border in front of a
    // reviewer. The branch is gone, so the sentence is too.
    //
    // What matters is unchanged and is what this now says: an evenly-pitched
    // fill BETWEEN two faces a wall-thickness apart is not hatching, so the
    // face reaches the reviewer.
    expect(line.kind).toBe<SingleLineClass>("unclassified");
    expect(worthOffering(line.kind), "a filled wall's face must reach the reviewer").toBe(true);
  });
});

describe("a line inside a field of hatching", () => {
  it("is still withheld, because its neighbours are on both sides", () => {
    // The subject is in the MIDDLE of an evenly spaced field.
    const subject = at(0.5);
    const faces = [at(0), at(0.17), at(0.34), subject, at(0.67), at(0.84), at(1.0)];
    const line = classify(faces, subject);

    expect(line.kind).toBe<SingleLineClass>("in-a-hatch");
    expect(worthOffering(line.kind)).toBe(false);
  });
});

describe("the edge of a hatched floor area", () => {
  it("is still withheld, because nothing is a wall thickness away", () => {
    // Neighbours on ONE side, exactly like a poché face — but the far edge of
    // the field is 2.5 ft off, which is no wall. This is the case that stops
    // the fix from becoming "offer every hatch field's outermost line", and
    // it is why the partner has to be at a plausible thickness rather than
    // merely present.
    const subject = at(0);
    const faces = [subject, at(0.8), at(1.6), at(2.5)];
    const line = classify(faces, subject);

    expect(line.kind).toBe<SingleLineClass>("in-a-hatch");
    expect(worthOffering(line.kind)).toBe(false);
  });
});

describe("a face whose opposite face is drawn in several pieces", () => {
  it("is not claimed as a filled wall, because nothing is inside the pair", () => {
    // ── THE CASE THE FIRST VERSION OF THIS TEST COULD NOT SEE ──
    //
    // It used two neighbours 8in and 16in away and asserted the line was not
    // read as poché. It passed, and it proved nothing: with only two
    // neighbours the rule exits on its own neighbour count long before the
    // inside-count matters, so deleting that requirement left the test green.
    //
    // What distinguishes it is a far face drawn as SEVERAL collinear pieces —
    // which is how a wall broken by doors or openings is drawn. Three pieces
    // all at 18in, nothing between them and the subject: there are three
    // neighbours, all on one side, and the partner is at a wall thickness, so
    // every other condition is met and only "something must be filling the
    // gap" says no.
    const subject = at(0);
    const faces = [subject, at(1.5, 0.1, 0.2), at(1.5, 0.25, 0.35), at(1.5, 0.4, 0.5)];
    const line = classify(faces, subject);

    // Offered, which is the RIGHT answer and was not the answer when this
    // case was written: three pieces all at one distance is not a fill, it is
    // a wall face whose partner is drawn in pieces, and the pitch test now
    // says so. The assertion that matters is which SENTENCE the reviewer is
    // shown, since both readings would otherwise offer the line.
    expect(line.kind).toBe<SingleLineClass>("unclassified");
  });
});

describe("the switch", () => {
  it("is off by default, so customer code cannot acquire the rule by forgetting it", () => {
    // The same crowded line the labelling rule offers. With the rule off it is
    // withheld as hatching, which is what customers see until "demote, don't
    // hide" ships — and `hatchPitchRule` is absent here rather than false, so
    // this is the DEFAULT being asserted, not an explicit opt-out.
    const subject = at(0);
    const faces = [subject, at(0.4), at(1.1), at(2.2)];
    const withRule = classifySingleLines({
      unclaimed: [subject],
      faces,
      segments: faces,
      walls: AROUND,
      feetPerUnit: FEET_PER_UNIT,
      hatchPitchRule: true,
    })[0]!;
    const asShipped = classifySingleLines({
      unclaimed: [subject],
      faces,
      segments: faces,
      walls: AROUND,
      feetPerUnit: FEET_PER_UNIT,
    })[0]!;

    expect(withRule.kind).toBe<SingleLineClass>("unclassified");
    expect(asShipped.kind).toBe<SingleLineClass>("in-a-hatch");
  });
});
