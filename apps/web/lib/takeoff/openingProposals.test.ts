import { describe, expect, it } from "vitest";
import { proposedOpenings } from "./openingProposals";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * Every scene here is drawn in FEET (`feetPerUnit` = 1) along y = 0, a 20 ft
 * wall 6 in thick: faces at y = ±0.25. The run is what the finder would hand
 * over — this module never builds one, it only reads what is drawn in it.
 *
 * Each refusal below is a way the reverted door-evidence rule of 2026-10-17
 * was fooled, or a way a window rule is fooled by a wall's own drawing, and
 * every one of them hands the function REAL strokes. A corridor test that
 * cannot reach the code deciding corridors was the vacuous green that rule
 * shipped behind.
 */

const HALF = 0.25;
const run: WallCandidate = { x1: 0, y1: 0, x2: 20, y2: 0, thicknessFeet: 2 * HALF, lengthFeet: 20 };

const seg = (x1: number, y1: number, x2: number, y2: number, curved = false): StrokeSegment =>
  curved ? { x1, y1, x2, y2, curved: true } : { x1, y1, x2, y2 };

/** Both faces, broken at each [from, to] gap, with a jamb line at each end. */
function wallWithGaps(gaps: [number, number][]): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  let at = 0;
  for (const [from, to] of gaps) {
    out.push(seg(at, HALF, from, HALF), seg(at, -HALF, from, -HALF));
    out.push(seg(from, -HALF, from, HALF), seg(to, -HALF, to, HALF));
    at = to;
  }
  out.push(seg(at, HALF, 20, HALF), seg(at, -HALF, 20, -HALF));
  return out;
}

/**
 * A flattened swing about (cx, cy), radius r, from angle a0 to a1 in degrees,
 * as `flattenCubic` would hand it over — short CURVED pieces.
 */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, pieces = 8): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let i = 0; i < pieces; i += 1) {
    const s = ((a0 + ((a1 - a0) * i) / pieces) * Math.PI) / 180;
    const e = ((a0 + ((a1 - a0) * (i + 1)) / pieces) * Math.PI) / 180;
    out.push(seg(cx + r * Math.cos(s), cy + r * Math.sin(s), cx + r * Math.cos(e), cy + r * Math.sin(e), true));
  }
  return out;
}

/** A 3 ft door from x = 8 to 11, hinged at x = 8 on the +y face, swinging into +y. */
const doorGap: [number, number] = [8, 11];
const swing = () => arc(8, HALF, 3, 0, 90);

describe("proposedOpenings — doors", () => {
  it("proposes a door where both faces stop and a swing is hinged at the jamb", () => {
    const found = proposedOpenings([run], [...wallWithGaps([doorGap]), ...swing()], 1).get(0) ?? [];
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("door");
    expect(found[0].leaves).toBe(1);
    expect(found[0].widthFt).toBeCloseTo(3, 6);
    expect(found[0].at).toBeCloseTo(9.5 / 20, 6);
    expect(found[0].evidence).toMatch(/swing/);
  });

  it("measures jamb to jamb through the 1-3/4in leaf edge a drawn leaf puts on the face", () => {
    // The leaf as a thin rectangle standing open from the hinge: its short
    // edge lies ON the face line for 1-3/4in. That is not wall, and counting
    // it would read the doorway an inch and three quarters narrow.
    const leaf = 1.75 / 12;
    const rect = [seg(8, HALF, 8, HALF + 3), seg(8, HALF + 3, 8 + leaf, HALF + 3), seg(8 + leaf, HALF + 3, 8 + leaf, HALF), seg(8 + leaf, HALF, 8, HALF)];
    const found = proposedOpenings([run], [...wallWithGaps([doorGap]), ...swing(), ...rect], 1).get(0) ?? [];
    expect(found).toHaveLength(1);
    expect(found[0].widthFt).toBeCloseTo(3, 6);
  });

  it("finds it hinged at either jamb and swinging to either side", () => {
    // Hinged at x = 11 on the −y face: the closed leaf points back along −x.
    const other = arc(11, -HALF, 3, 180, 270);
    const found = proposedOpenings([run], [...wallWithGaps([doorGap]), ...other], 1).get(0) ?? [];
    expect(found.map((o) => o.kind)).toEqual(["door"]);
  });

  it("still finds it with another door's swing drawn on the wall's other side", () => {
    // A second leaf hinged at the same jamb on the −y face, swinging the other
    // way — a pair of back-to-back doors, or a door into the room behind.
    // Its pieces sit at about this swing's radius from this hinge, on the
    // wrong side; read as part of this arc they sort first and spoil it.
    // Found by the bench, not by thought: removing the side test left every
    // other case here green and cost 15 doors there.
    const behind = arc(8, -HALF, 3, 0, -90);
    const found = proposedOpenings([run], [...wallWithGaps([doorGap]), ...swing(), ...behind], 1).get(0) ?? [];
    expect(found.map((o) => o.kind)).toEqual(["door"]);
  });

  it("proposes nothing for a gap with nothing drawn in it — a column, a break, a cased opening", () => {
    expect(proposedOpenings([run], wallWithGaps([doorGap]), 1).size).toBe(0);
  });

  it("refuses a swing whose radius is not the opening's width", () => {
    // A 2 ft arc in a 3 ft gap: a neighbouring door's swing passing by.
    expect(proposedOpenings([run], [...wallWithGaps([doorGap]), ...arc(8, HALF, 2, 0, 90)], 1).size).toBe(0);
  });

  it("refuses a swing hinged somewhere other than this opening's jamb", () => {
    // Right radius, hinged a foot and a half inside the gap.
    expect(proposedOpenings([run], [...wallWithGaps([doorGap]), ...arc(9.5, HALF, 3, 0, 90)], 1).size).toBe(0);
  });

  it("refuses a crowd of pieces at the right radius that do not chain into one sweep", () => {
    // The reverted rule's failure exactly: pieces at about the right distance,
    // supplied by unrelated swings, scattered round the hinge with holes in
    // the sweep far wider than one flattened arc leaves.
    const crowd = [...arc(8, HALF, 3, 0, 20, 2), ...arc(8, HALF, 3, 45, 60, 2), ...arc(8, HALF, 3, 80, 90, 1)];
    expect(proposedOpenings([run], [...wallWithGaps([doorGap]), ...crowd], 1).size).toBe(0);
  });

  it("refuses an arc that does not close on the far jamb", () => {
    // 65 degrees about the right jamb at the right radius — enough sweep — but
    // it stops 25 degrees short of the wall, so the closed leaf would not be
    // lying in this opening.
    expect(proposedOpenings([run], [...wallWithGaps([doorGap]), ...arc(8, HALF, 3, 25, 90)], 1).size).toBe(0);
  });

  it("refuses an arc that sweeps well past a door's quarter turn", () => {
    // Hinged right and closing right, but a half circle: a round fixture or a
    // table edge, not a leaf swinging open.
    expect(proposedOpenings([run], [...wallWithGaps([doorGap]), ...arc(8, HALF, 3, 0, 180, 16)], 1).size).toBe(0);
  });

  it("requires every piece to hold one radius — radial strokes do not fill a hole in the sweep", () => {
    // A swing drawn 0-30 and 60-90 degrees, with the hole filled by curved
    // pieces that run OUTWARD across the right mean distance. Their angles
    // cover the hole; their ends sit at two different radii, so they are not
    // part of this arc.
    const radial: StrokeSegment[] = [];
    for (let deg = 30; deg < 60; deg += 5) {
      const s = (deg * Math.PI) / 180;
      const e = ((deg + 5) * Math.PI) / 180;
      radial.push(seg(8 + 2.6 * Math.cos(s), HALF + 2.6 * Math.sin(s), 8 + 3.4 * Math.cos(e), HALF + 3.4 * Math.sin(e), true));
    }
    const holed = [...arc(8, HALF, 3, 0, 30, 3), ...radial, ...arc(8, HALF, 3, 60, 90, 3)];
    expect(proposedOpenings([run], [...wallWithGaps([doorGap]), ...holed], 1).size).toBe(0);
  });

  it("refuses straight pieces in the shape of a swing — a door swing is drawn as an arc", () => {
    const straight = arc(8, HALF, 3, 0, 90).map(({ x1, y1, x2, y2 }) => seg(x1, y1, x2, y2));
    expect(proposedOpenings([run], [...wallWithGaps([doorGap]), ...straight], 1).size).toBe(0);
  });

  it("reads a pair of doors as two half-width swings, one at each jamb", () => {
    const pair = [...arc(7, HALF, 3, 0, 90), ...arc(13, HALF, 3, 90, 180)];
    const found = proposedOpenings([run], [...wallWithGaps([[7, 13]]), ...pair], 1).get(0) ?? [];
    expect(found).toHaveLength(1);
    expect(found[0].leaves).toBe(2);
    expect(found[0].widthFt).toBeCloseTo(6, 6);
  });

  it("does not take one leaf of a pair for a whole door", () => {
    // Only the left leaf drawn: radius 3 in a 6 ft gap is neither a single
    // leaf of this opening nor a pair.
    expect(proposedOpenings([run], [...wallWithGaps([[7, 13]]), ...arc(7, HALF, 3, 0, 90)], 1).size).toBe(0);
  });

  it("ignores a gap that touches the run's end — that is where the wall stops", () => {
    const strokes = [seg(0, HALF, 17, HALF), seg(0, -HALF, 17, -HALF), ...arc(17, HALF, 3, 0, 90)];
    expect(proposedOpenings([run], strokes, 1).size).toBe(0);
  });

  it("still finds the door when a grid line runs down the wall's centre", () => {
    // Architects draw column grids on wall centrelines. The line is inside the
    // wall's body for the whole run, so it is the wall's own drawing, not
    // glazing, and must not hide the door.
    const grid = seg(-10, 0, 30, 0);
    const found = proposedOpenings([run], [...wallWithGaps([doorGap]), ...swing(), grid], 1).get(0) ?? [];
    expect(found.map((o) => o.kind)).toEqual(["door"]);
  });

  it("works in page units, not feet: the same scene scaled reads the same width", () => {
    // 1/8" = 1'-0" on a 36 in sheet: 288 ft per page width.
    const fpu = 288;
    const scale = (s: StrokeSegment): StrokeSegment => ({ ...s, x1: s.x1 / fpu, y1: s.y1 / fpu, x2: s.x2 / fpu, y2: s.y2 / fpu });
    const small: WallCandidate = { ...run, x2: 20 / fpu };
    const found = proposedOpenings([small], [...wallWithGaps([doorGap]), ...swing()].map(scale), fpu).get(0) ?? [];
    expect(found).toHaveLength(1);
    expect(found[0].widthFt).toBeCloseTo(3, 6);
  });
});

describe("proposedOpenings — windows", () => {
  /** A 4 ft window from x = 8 to 12: faces continue as sill lines, a glazing line on the centre. */
  function windowScene(withJambs = true): StrokeSegment[] {
    const out = [seg(0, HALF, 20, HALF), seg(0, -HALF, 20, -HALF), seg(8, 0, 12, 0)];
    if (withJambs) out.push(seg(8, -HALF, 8, HALF), seg(12, -HALF, 12, HALF));
    return out;
  }

  it("proposes a window where glazing sits inside the wall between two jambs", () => {
    const found = proposedOpenings([run], windowScene(), 1).get(0) ?? [];
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("window");
    expect(found[0].widthFt).toBeCloseTo(4, 6);
    expect(found[0].at).toBeCloseTo(0.5, 6);
  });

  it("refuses glazing with no jamb line at its ends — a line lying in a wall is not yet a window", () => {
    expect(proposedOpenings([run], windowScene(false), 1).size).toBe(0);
  });

  it("reads several glazing lines across one window as one window", () => {
    const strokes = [...windowScene(), seg(8, 0.1, 12, 0.1), seg(8, -0.1, 12, -0.1)];
    expect(proposedOpenings([run], strokes, 1).get(0)).toHaveLength(1);
  });

  it("does not read a multi-line wall's own drawing as windows", () => {
    // A wall type drawn as four lines — two interior lines along EVERY solid
    // stretch — with two windows, glazing on the centre. The stub between the
    // windows is bounded by jambs and carries interior lines too, which is
    // exactly the shape of a window; it must not become one.
    const own = (from: number, to: number) => [seg(from, 0.12, to, 0.12), seg(from, -0.12, to, -0.12)];
    const strokes = [
      seg(0, HALF, 20, HALF),
      seg(0, -HALF, 20, -HALF),
      ...own(0, 5),
      ...own(9, 12),
      ...own(16, 20),
      seg(5, 0, 9, 0),
      seg(12, 0, 16, 0),
      ...[5, 9, 12, 16].map((x) => seg(x, -HALF, x, HALF)),
    ];
    const found = proposedOpenings([run], strokes, 1).get(0) ?? [];
    expect(found.map((o) => [o.kind, Math.round(o.widthFt * 100) / 100])).toEqual([
      ["window", 4],
      ["window", 4],
    ]);
  });

  it("does not call a gap with a line drawn across it a swing door, even with a swing beside it", () => {
    // Faces stop for 3 ft and a single line lies across the gap between the
    // jambs — a sliding or pocket door drawn closed — and a swing at the jamb
    // from the door next to it. Not a swing door (something is drawn IN the
    // opening), and not a window (no sill lines run across it).
    const strokes = [...wallWithGaps([doorGap]), seg(8, 0, 11, 0), ...swing()];
    expect(proposedOpenings([run], strokes, 1).size).toBe(0);
  });

  it("requires sill lines across a window: the faces continue over it", () => {
    // The same glazing line between two jambs, faces stopped — the pocket
    // door again, this time with nothing else nearby.
    expect(proposedOpenings([run], [...wallWithGaps([[8, 12]]), seg(8, 0, 12, 0)], 1).size).toBe(0);
  });

  it("requires a window to stand in wall: faces drawn either side of it", () => {
    // Glazing with sills between two jambs, but the wall's faces stop just
    // beyond each jamb — there is no wall for this to be cut into.
    const strokes = [
      seg(0, HALF, 7.9, HALF),
      seg(0, -HALF, 7.9, -HALF),
      seg(8, HALF, 12, HALF),
      seg(8, -HALF, 12, -HALF),
      seg(12.1, HALF, 20, HALF),
      seg(12.1, -HALF, 20, -HALF),
      seg(8, 0, 12, 0),
      seg(8, -HALF, 8, HALF),
      seg(12, -HALF, 12, HALF),
    ];
    // The faces stop for 0.1 ft each side: plain wall within half a foot of
    // the jamb is short by a fifth, which is more than the tenth allowed.
    expect(proposedOpenings([run], strokes, 1).size).toBe(0);
  });

  it("does not take a long line crossing the wall for a jamb", () => {
    // A dimension's extension line or a grid line running square across the
    // wall at each end of the glazing: it spans the body, and far beyond it.
    const strokes = [seg(0, HALF, 20, HALF), seg(0, -HALF, 20, -HALF), seg(8, 0, 12, 0), seg(8, -5, 8, 5), seg(12, -5, 12, 5)];
    expect(proposedOpenings([run], strokes, 1).size).toBe(0);
  });

  it("does not stand a window in 'plain wall' that is the next window's glazing", () => {
    // Two glazing stretches with a 4 in mullion between them and a jamb line
    // at every end. Neither has plain wall beside it, so neither is proposed —
    // the conservative answer for a ganged unit; the estimator types it.
    const strokes = [
      seg(0, HALF, 20, HALF),
      seg(0, -HALF, 20, -HALF),
      seg(6, 0, 9.83, 0),
      seg(10.17, 0, 14, 0),
      ...[6, 9.83, 10.17, 14].map((x) => seg(x, -HALF, x, HALF)),
    ];
    expect(proposedOpenings([run], strokes, 1).size).toBe(0);
  });

  it("refuses glazing that runs out to the run's end", () => {
    const strokes = [seg(0, HALF, 20, HALF), seg(0, -HALF, 20, -HALF), seg(16, 0, 20, 0), seg(16, -HALF, 16, HALF)];
    expect(proposedOpenings([run], strokes, 1).size).toBe(0);
  });
});

describe("proposedOpenings — what it leaves alone", () => {
  it("skips a curved run: an opening in an arc has no straight width to measure", () => {
    const curved = { ...run, curved: true };
    expect(proposedOpenings([curved], [...wallWithGaps([doorGap]), ...swing()], 1).size).toBe(0);
  });

  it("returns nothing at all without a usable scale", () => {
    for (const fpu of [0, -1, Number.NaN]) {
      expect(proposedOpenings([run], [...wallWithGaps([doorGap]), ...swing()], fpu).size).toBe(0);
    }
  });

  it("keys each run's openings by that run's index", () => {
    const other: WallCandidate = { x1: 0, y1: 50, x2: 20, y2: 50, thicknessFeet: 0.5, lengthFeet: 20 };
    const found = proposedOpenings([other, run], [...wallWithGaps([doorGap]), ...swing()], 1);
    expect([...found.keys()]).toEqual([1]);
  });
});
