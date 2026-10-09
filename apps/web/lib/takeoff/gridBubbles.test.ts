import { describe, expect, it } from "vitest";
import {
  gridBubbles,
  linesIntoBubbles,
  gridLineSegments,
  BUBBLE_INCHES_MIN,
  BUBBLE_INCHES_MAX,
} from "./gridBubbles";
import type { StrokeSegment } from "./wallVectors";

/**
 * THE DEFECT THIS EXISTS FOR, IN NUMBERS.
 *
 * 1,849 ft of one answer key came back in a 12.4in band matching no assembly on
 * the drawing. Looked at directly: within two feet of a building's west wall the
 * faces sit at +0.00, +1.56, +2.28, +8.28 and +8.88 inches, and then one more
 * line at +12.48in that is 115 ft long and runs past the building both ends.
 * The column grid.
 *
 * Two length-based rules were tried and both failed — the hard 3x face ratio
 * misses it when the partner is 40ft, and preferring a comparable partner
 * misses it when the outer finish is 94ft against the grid's 115, a ratio of
 * 1.22. Length is not the discriminator, because a grid line is as long as the
 * building. What is always true is that it ENDS IN A BUBBLE.
 *
 * The coordinates here are normalised to the page width, so a 36in-wide sheet
 * gives `unitsPerPaperInch = 1/36`.
 */

const PAPER = 1 / 36; // units per paper inch, on a 36in ARCH D sheet

/** A circle flattened into `n` segments, the way pdf.js delivers a curve. */
function circle(cx: number, cy: number, r: number, n = 24): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    out.push({ x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b) });
  }
  return out;
}

/** An arc of `turn` radians — a door swing is a quarter turn. */
function arc(cx: number, cy: number, r: number, turn: number, n = 12): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * turn;
    const b = ((i + 1) / n) * turn;
    out.push({ x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b) });
  }
  return out;
}

const HALF_INCH = (0.5 / 2) * PAPER; // radius of a 1/2in bubble

describe("finding the grid bubbles", () => {
  it("finds a bubble drawn as a flattened circle", () => {
    const found = gridBubbles(circle(0.3, 0.4, HALF_INCH), PAPER);
    expect(found).toHaveLength(1);
    expect(found[0].x).toBeCloseTo(0.3, 3);
    expect(found[0].y).toBeCloseTo(0.4, 3);
  });

  it("finds several, and counts them", () => {
    const sheet = [
      ...circle(0.1, 0.1, HALF_INCH),
      ...circle(0.5, 0.1, HALF_INCH),
      ...circle(0.9, 0.1, HALF_INCH),
    ];
    expect(gridBubbles(sheet, PAPER)).toHaveLength(3);
  });

  it("REFUSES A DOOR SWING, which is an arc at a plausible radius", () => {
    // The case that kills a naive roundness test: a swing is the same curve
    // material at the same kind of radius, and only the TURN separates them.
    expect(gridBubbles(arc(0.3, 0.3, HALF_INCH, Math.PI / 2), PAPER)).toEqual([]);
  });

  it("refuses a circle too small to hold a character", () => {
    const tiny = (BUBBLE_INCHES_MIN / 2) * PAPER * 0.5;
    expect(gridBubbles(circle(0.3, 0.3, tiny), PAPER)).toEqual([]);
  });

  it("refuses a circle too big to be a grid head", () => {
    const huge = (BUBBLE_INCHES_MAX / 2) * PAPER * 2;
    expect(gridBubbles(circle(0.3, 0.3, huge), PAPER)).toEqual([]);
  });

  it("MEASURES IN PAPER INCHES, so the same bubble is found at any scale", () => {
    // The whole reason this is not expressed in feet of building: a 1/2in
    // bubble is 3 ft across at 1/8in scale and 1.5 ft at 1/4in, so a bound in
    // feet would be a different bound on every sheet.
    const onArchD = gridBubbles(circle(0.3, 0.3, (0.5 / 2) * (1 / 36)), 1 / 36);
    const onArchB = gridBubbles(circle(0.3, 0.3, (0.5 / 2) * (1 / 18)), 1 / 18);
    expect(onArchD).toHaveLength(1);
    expect(onArchB).toHaveLength(1);
  });

  it("refuses a square, which is round by no measure", () => {
    const r = HALF_INCH;
    const square: StrokeSegment[] = [
      { x1: 0.3 - r, y1: 0.3 - r, x2: 0.3 + r, y2: 0.3 - r },
      { x1: 0.3 + r, y1: 0.3 - r, x2: 0.3 + r, y2: 0.3 + r },
      { x1: 0.3 + r, y1: 0.3 + r, x2: 0.3 - r, y2: 0.3 + r },
      { x1: 0.3 - r, y1: 0.3 + r, x2: 0.3 - r, y2: 0.3 - r },
    ];
    expect(gridBubbles(square, PAPER)).toEqual([]);
  });

  it("returns nothing rather than throwing on an empty sheet or no scale", () => {
    expect(gridBubbles([], PAPER)).toEqual([]);
    expect(gridBubbles(circle(0.3, 0.3, HALF_INCH), 0)).toEqual([]);
  });
});

describe("the lines that run into them", () => {
  const bubble = { x: 0.1, y: 0.5, radius: HALF_INCH };

  it("CATCHES THE GRID LINE, which ends at the bubble", () => {
    const gridLine: StrokeSegment = { x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5 };
    expect(linesIntoBubbles([gridLine], [bubble]).has(0)).toBe(true);
  });

  it("catches it whichever end is drawn first", () => {
    const backwards: StrokeSegment = { x1: 0.9, y1: 0.5, x2: 0.1, y2: 0.5 };
    expect(linesIntoBubbles([backwards], [bubble]).has(0)).toBe(true);
  });

  it("LEAVES A WALL THAT MERELY CROSSES ONE ALONE", () => {
    // The case that makes this safe: a grid line runs THROUGH the building and
    // real walls cross it everywhere. Only an END counts, never the middle — a
    // rule on proximity alone would delete the walls it passes.
    const wallAcross: StrokeSegment = { x1: 0.1, y1: 0.2, x2: 0.1, y2: 0.8 };
    expect(linesIntoBubbles([wallAcross], [bubble]).has(0)).toBe(false);
  });

  it("leaves a wall that ends well clear of the bubble", () => {
    const wall: StrokeSegment = { x1: 0.4, y1: 0.5, x2: 0.9, y2: 0.5 };
    expect(linesIntoBubbles([wall], [bubble]).has(0)).toBe(false);
  });

  it("returns an empty set when there are no bubbles at all", () => {
    const anything: StrokeSegment = { x1: 0, y1: 0, x2: 1, y2: 1 };
    expect(linesIntoBubbles([anything], []).size).toBe(0);
  });
});

describe("following the line the bubble found", () => {
  const bubble = { x: 0.1, y: 0.5, radius: HALF_INCH };

  /** CAD writes a long line as a run of pieces. Only the last touches the
   *  bubble, which is why the terminal test alone changed nothing measurable. */
  function brokenLine(y: number, from: number, to: number, pieces = 6): StrokeSegment[] {
    const out: StrokeSegment[] = [];
    for (let i = 0; i < pieces; i += 1) {
      const a = from + ((to - from) * i) / pieces;
      const b = from + ((to - from) * (i + 1)) / pieces;
      out.push({ x1: a, y1: y, x2: b, y2: y });
    }
    return out;
  }

  it("TAKES THE WHOLE GRID LINE, not just the piece touching the bubble", () => {
    const segs = brokenLine(0.5, 0.1, 0.9);
    // The defect in numbers: the terminal test catches ONE of six pieces, so
    // five survive and still pair against a wall face.
    expect(linesIntoBubbles(segs, [bubble]).size).toBe(1);
    expect(gridLineSegments(segs, [bubble], PAPER).size).toBe(6);
  });

  it("takes it in both directions from the bubble", () => {
    const segs = [...brokenLine(0.5, 0.1, 0.9, 4), ...brokenLine(0.5, 0.1, 0.02, 2)];
    expect(gridLineSegments(segs, [bubble], PAPER).size).toBe(6);
  });

  it("LEAVES A WALL CENTRED ON THE GRID LINE, which is the dangerous case", () => {
    // Walls are routinely centred on a column grid. The grid line is the
    // CENTRELINE and the wall's faces sit offset either side, so a tight band
    // takes the line and leaves both faces. A loose one deletes the wall.
    //
    // The faces start at 0.25, inside the building: a grid bubble sits OUTSIDE
    // the outline with the line running in to meet it, so nothing structural
    // begins at the bubble. The first version of this fixture started them at
    // the bubble itself and failed — see the test below, which keeps what that
    // found rather than quietly correcting the fixture.
    const halfWall = (4.875 / 2 / 12 / 8) * PAPER; // half a 4-7/8in wall at 1/8in scale
    const segs: StrokeSegment[] = [
      ...brokenLine(0.5, 0.1, 0.9), // the grid line itself, 6 pieces
      { x1: 0.25, y1: 0.5 - halfWall, x2: 0.9, y2: 0.5 - halfWall },
      { x1: 0.25, y1: 0.5 + halfWall, x2: 0.9, y2: 0.5 + halfWall },
    ];
    const dropped = gridLineSegments(segs, [bubble], PAPER);
    expect(dropped.size).toBe(6);
    expect(dropped.has(6), "the near face must survive").toBe(false);
    expect(dropped.has(7), "the far face must survive").toBe(false);
  });

  it("CATCHES A WALL THAT ENDS INSIDE A BUBBLE — a real limit, recorded", () => {
    // Found by the fixture above being wrong, and kept because the finding is
    // worth more than the fixture was. The seed test asks only whether an END
    // lands within two radii of a bubble's centre, so anything ending there
    // reads as the grid line arriving — including a wall.
    //
    // On a drawing the bubble sits clear of the outline, so this needs a wall
    // ending within about a paper inch of a grid head. Left as a known limit
    // rather than tuned away: tightening the reach would start missing grid
    // lines that stop at the circle's edge, which is the worse failure. What
    // settles whether it costs anything is the real sheets, not this fixture.
    const endsAtTheBubble: StrokeSegment = { x1: 0.1, y1: 0.5, x2: 0.5, y2: 0.5 };
    expect(gridLineSegments([endsAtTheBubble], [bubble], PAPER).has(0)).toBe(true);
  });

  it("leaves a line parallel to the grid but somewhere else entirely", () => {
    const segs = [...brokenLine(0.5, 0.1, 0.9), ...brokenLine(0.3, 0.1, 0.9)];
    const dropped = gridLineSegments(segs, [bubble], PAPER);
    expect(dropped.size).toBe(6);
  });

  it("leaves a wall that crosses the grid line at right angles", () => {
    const segs: StrokeSegment[] = [
      ...brokenLine(0.5, 0.1, 0.9),
      { x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.8 },
    ];
    expect(gridLineSegments(segs, [bubble], PAPER).has(6)).toBe(false);
  });

  it("returns nothing when no line reaches a bubble", () => {
    expect(gridLineSegments(brokenLine(0.3, 0.4, 0.9), [bubble], PAPER).size).toBe(0);
  });

  it("COVERS THE HALF-SIZE SHEET, where the same bubble is 0.082in", () => {
    // The 0.1in floor found zero bubbles on those pages — the identical failure
    // one size down from the 0.25in one.
    const small = gridBubbles(circle(0.3, 0.3, (0.082 / 2) * PAPER), PAPER);
    expect(small).toHaveLength(1);
    expect(BUBBLE_INCHES_MIN).toBeLessThan(0.082);
  });
});
