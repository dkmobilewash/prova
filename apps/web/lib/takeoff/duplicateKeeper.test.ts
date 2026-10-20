import { describe, expect, it } from "vitest";
import { SIMILAR_LENGTH, SUPPORT_MARGIN, duplicatePairs } from "./duplicateCandidates";
import type { Candidate } from "./answerKeyReview";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── WHICH OF TWO TWINS THE PRE-MARKING KEEPS ──
 *
 * Reported from E Street 421 A2.1: the duplicate rule auto-rejected the
 * candidate sitting ON the wall and kept the one offset about nine inches
 * beside it — at the conference room's east wall and again at the entry's
 * west glass wall — because it kept the LONGER of the two and the offset twin
 * was longer.
 *
 * Everything is in page-width units at 288 ft per page width, so an inch of
 * building is 1/3456 of the page.
 */
const FEET_PER_UNIT = 288;
const ft = (feet: number) => feet / FEET_PER_UNIT;

/** A horizontal line at height y, from x1 to x2, in feet. */
function line(yFeet: number, x1Feet: number, x2Feet: number): StrokeSegment {
  return { x1: ft(x1Feet), y1: ft(yFeet), x2: ft(x2Feet), y2: ft(yFeet) };
}

/** A horizontal candidate centred on `yFeet`. */
function candidate(
  id: string,
  yFeet: number,
  fromFeet: number,
  toFeet: number,
  thicknessIn: number,
): Candidate {
  return {
    id,
    x1: ft(fromFeet),
    y1: ft(yFeet),
    x2: ft(toFeet),
    y2: ft(yFeet),
    lengthFeet: toFeet - fromFeet,
    thicknessIn,
    from: "pair",
    note: "detected",
  };
}

describe("choosing between two readings of the same wall", () => {
  /**
   * A 6in wall whose faces are drawn the whole length, and a glass line 9in
   * beyond it. The offset twin pairs the wall's lower face with that glass
   * line, so it is LONGER and its own faces are not both drawn.
   */
  const wallTop = 0;
  const wallBottom = 0.5; // 6in in feet
  const glass = 1.25; // 9in beyond the wall's far face
  //
  // ── THE GLASS LINE IS SHORT, AND THAT IS NOT A CONVENIENCE ──
  //
  // A first version of this fixture drew it the full length of the wall, and
  // the test failed for a reason worth keeping: the offset twin THEN has two
  // fully-drawn faces of its own and support cannot separate the two at all.
  // That is a real bound on this rule and it is written in the module's
  // header. What the real sheets show is the other case — the wrong partner
  // is a short run of glass, a shelf or a shelf end — and every twin the
  // sweep swapped had support 0.00, meaning a face was not found for its
  // length at all.
  const segments = [
    line(wallTop, 0, 20),
    line(wallBottom, 0, 20),
    line(glass, 6, 12),
  ];
  // On the wall: centred between its two faces, 6in thick.
  const onWall = candidate("on", 0.25, 2, 18, 6);
  // Beside it: centred between the wall's lower face and the glass, and
  // longer, which is what made the old rule prefer it.
  const beside = candidate("off", (wallBottom + glass) / 2, 0, 22, (glass - wallBottom) * 12);

  it("keeps the one on the wall, not the longer one", () => {
    const got = duplicatePairs([onWall, beside], FEET_PER_UNIT, segments);
    expect(got).toHaveLength(1);
    expect(got[0].keep, "the longer twin is not the wall").toBe("on");
    expect(got[0].drop).toBe("off");
    expect(got[0].support?.keep).toBeGreaterThan(got[0].support?.drop ?? 1);
  });

  it("keeps the LONGER one when the lines are not given", () => {
    // The old behaviour, preserved exactly: a caller without the sheet's
    // geometry must get what it always got rather than a silently different
    // verdict.
    const got = duplicatePairs([onWall, beside], FEET_PER_UNIT);
    expect(got[0].keep).toBe("off");
    expect(got[0].support, "nobody looked, and it says so").toBeNull();
  });

  it("keeps the longer one when a FRAGMENT lies inside a long wall", () => {
    // ── THE GUARD THAT STOPS THIS LOSING WALLS ──
    //
    // `share` is measured against the shorter run, so a 3 ft candidate inside
    // a 160 ft wall is a duplicate pair by this file's definition. Before the
    // length bound existed, support alone would have kept the 3 ft one and
    // REJECTED the 160 ft run — measured on Camp Bow Wow A101, 156 ft of wall
    // thrown away to fix a nine-inch offset.
    const longWall = candidate("long", 0.25, 0, 160, 6);
    const fragment = candidate("frag", 0.25, 40, 43, 6);
    const sparse = [line(wallTop, 0, 44), line(wallBottom, 40, 43)];
    const got = duplicatePairs([longWall, fragment], FEET_PER_UNIT, sparse);
    expect(got).toHaveLength(1);
    expect(got[0].keep).toBe("long");
  });

  it("ignores a support difference too small to mean anything", () => {
    const a = candidate("a", 0.25, 0, 16, 6);
    const b = candidate("b", 0.25, 0, 15, 6);
    const both = [line(wallTop, 0, 20), line(wallBottom, 0, 20)];
    const got = duplicatePairs([a, b], FEET_PER_UNIT, both);
    // Both sit on the wall, so length decides as it always did.
    expect(got[0].keep).toBe("a");
  });

  it("a SMALL support difference does not override length", () => {
    // The margin exists so noise cannot decide. Both twins sit on the wall;
    // one's far face stops a foot short, which is a 6% difference and not a
    // reason to reject the longer reading. Without the margin this swaps.
    const longer = candidate("longer", 0.25, 0, 16, 6);
    const shorter = candidate("shorter", 0.25, 0, 15, 6);
    const nearlyEqual = [
      line(wallTop, 0, 20),
      // The far face stops just short of the longer twin's end.
      line(wallBottom, 0, 15),
    ];
    const got = duplicatePairs([longer, shorter], FEET_PER_UNIT, nearlyEqual);
    expect(got).toHaveLength(1);
    expect(got[0].keep).toBe("longer");
    const gap = Math.abs((got[0].support?.keep ?? 0) - (got[0].support?.drop ?? 0));
    expect(gap, "a difference this small must not decide").toBeLessThan(SUPPORT_MARGIN);
  });

  it("a run whose faces cannot be found scores NO support, not full support", () => {
    // The direction matters. An unreadable run reported as fully supported
    // would beat a perfectly good twin and reject the real wall; reported as
    // unsupported it loses, and the rule falls back to length — which is the
    // behaviour an unreadable sheet should get.
    const onIt = candidate("on", 0.25, 0, 16, 6);
    const nowhere = candidate("nowhere", 8, 0, 16.5, 6);
    const onlyOneWall = [line(wallTop, 0, 20), line(wallBottom, 0, 20)];
    const got = duplicatePairs([onIt, nowhere], FEET_PER_UNIT, onlyOneWall);
    // They do not overlap, so they are not a pair at all — which is the point
    // of the next assertion: the support of a run with no faces is measured
    // directly rather than inferred from a pairing.
    expect(got).toHaveLength(0);
    const floating = duplicatePairs(
      [onIt, candidate("float", 0.25, 0, 16.5, 60)],
      FEET_PER_UNIT,
      onlyOneWall,
    );
    expect(floating).toHaveLength(1);
    // The 60in-thick reading has no faces at +/-30in, so it scores 0 and the
    // 6in reading on the wall is kept despite being shorter.
    expect(floating[0].keep).toBe("on");
    expect(floating[0].support?.drop).toBe(0);
  });

  it("support is measured against the RUN, not against the other face", () => {
    // A short wall butting into a long one has a 5 ft face and a 20 ft face.
    // Measured face-against-face that reads 0.25 and looks unsupported;
    // measured against the run it is 1, which is what it is — the wall is
    // drawn for its whole length on both sides.
    const shortWall = candidate("short", 0.25, 0, 5, 6);
    const twin = candidate("twin", 0.25, 0, 5.2, 6);
    const butting = [line(wallTop, 0, 20), line(wallBottom, 0, 5)];
    const got = duplicatePairs([shortWall, twin], FEET_PER_UNIT, butting);
    expect(got).toHaveLength(1);
    // Both are well supported, so length decides and the longer wins. The
    // kept twin is 5.2 ft against a 5 ft face, so it reads 0.96 — close to 1
    // and nothing like the 0.25 a face-against-face measure would give.
    expect(got[0].support?.keep).toBeGreaterThan(0.9);
    expect(got[0].keep).toBe("twin");
  });

  it("the bounds are the ones the sweep chose", () => {
    // 2.5 is the widest bound at which every swap across the eight labelled
    // sheets rejected a run whose second face is not drawn at all; at 3 one
    // swap rejected a run with 0.65 support. The margin is a fifth of the run.
    expect(SIMILAR_LENGTH).toBe(2.5);
    expect(SUPPORT_MARGIN).toBe(0.2);
  });
});
