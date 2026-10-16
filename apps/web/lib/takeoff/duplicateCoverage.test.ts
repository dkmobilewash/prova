import { describe, expect, it } from "vitest";
import { wallsNotDuplicateCoverage } from "./duplicateCoverage";
import type { WallCandidate } from "./wallVectors";

/**
 * The numbers here are the measured ones from S08 and S13, converted to a
 * unit space where one unit is one foot so the geometry reads directly. The
 * module's own header carries the measurements and the three discriminators
 * that do NOT work.
 */
function wall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thicknessInches: number,
): WallCandidate {
  return {
    x1,
    y1,
    x2,
    y2,
    thicknessFeet: thicknessInches / 12,
    lengthFeet: Math.hypot(x2 - x1, y2 - y1),
  };
}

describe("two walls cannot occupy the same footage", () => {
  // S08's hall partition and the phantom the sheet's dimension string made of
  // it: 56 ft at 4.50in, with 26.1 ft at 8.40in lying 0.54 ft away, which is
  // 1.01 mean thicknesses.
  const partition = wall(0, 22, 56, 22, 4.5);
  const phantom = wall(22, 22.54, 48.1, 22.54, 8.4);

  it("drops the phantom and keeps the wall it was copied from", () => {
    const { kept, dropped } = wallsNotDuplicateCoverage([partition, phantom]);
    expect(dropped).toBe(1);
    expect(kept).toHaveLength(1);
    expect(kept[0].thicknessFeet * 12).toBeCloseTo(4.5, 2);
  });

  it("does not depend on which order they arrive in", () => {
    expect(wallsNotDuplicateCoverage([phantom, partition]).kept).toHaveLength(1);
    expect(wallsNotDuplicateCoverage([partition, phantom]).kept).toHaveLength(1);
  });

  it("KEEPS S13's wall, where every other discriminator deleted it", () => {
    // S13's dimension row sits 0.06 ft from a real wall face — closer than
    // S08's does — so no distance from the printed figures can separate the
    // two sheets. What separates them is that nothing else on S13 claims this
    // wall's footage: its closest parallel neighbour is 15.48 mean
    // thicknesses away, which is a different wall across a room.
    const real = wall(0, 22, 72, 22, 4.5);
    const across = wall(0, 28, 72, 28, 4.5);
    const { kept, dropped } = wallsNotDuplicateCoverage([real, across]);
    expect(dropped, "a real wall was deleted").toBe(0);
    expect(kept).toHaveLength(2);
  });

  it("KEEPS S14's orphan thickness, which is real wall measured too thin", () => {
    // 112 ft of S14's wall is reported at 3.38in against a key of 4.5in, so a
    // rule that dropped orphan THICKNESSES would delete it — and 160 + 112 is
    // exactly the 272 ft of 4.5in wall its key declares. These are separate
    // walls, 11.66 mean thicknesses apart.
    const thin = wall(0, 0, 40, 0, 3.38);
    const normal = wall(0, 13, 40, 13, 4.5);
    expect(wallsNotDuplicateCoverage([thin, normal]).dropped).toBe(0);
  });

  it("keeps two walls that merely MEET, because a T is not a second claim", () => {
    const run = wall(0, 0, 40, 0, 4.5);
    const branch = wall(20, 0, 20, 30, 4.5);
    expect(wallsNotDuplicateCoverage([run, branch]).dropped).toBe(0);
  });

  it("keeps a wall that STICKS OUT of its neighbour, and drops one inside it", () => {
    // Coverage is of the shorter candidate's own span, so these two cases are
    // opposite. A 10 ft wall half of which hangs past the end of a 40 ft one
    // is 50% covered and keeps its own footage; a 2 ft fragment lying wholly
    // inside that 40 ft wall is 100% covered and is a piece of it.
    const long = wall(0, 0, 40, 0, 4.5);
    const sticksOut = wall(35, 0.4, 45, 0.4, 4.5);
    expect(wallsNotDuplicateCoverage([long, sticksOut]).dropped, "half of it is its own").toBe(0);

    const inside = wall(10, 0.4, 12, 0.4, 4.5);
    expect(wallsNotDuplicateCoverage([long, inside]).dropped, "a fragment of the same wall").toBe(1);
  });

  it("SPARES FURRING WHEN THE SCHEDULE NAMES IT, and drops it when nothing does", () => {
    // 1-1/2in furring on an 8in block wall: two real walls whose centrelines
    // are 4.75in apart, which is 1.0 mean thicknesses — indistinguishable by
    // geometry from the S08 phantom, and the reason the schedule is consulted.
    const block = wall(0, 0, 20, 0, 8);
    const furring = wall(0, 8 / 12 / 2 + 1.5 / 12 / 2, 20, 8 / 12 / 2 + 1.5 / 12 / 2, 1.5);
    expect(wallsNotDuplicateCoverage([block, furring], []).dropped, "no schedule").toBe(1);
    expect(
      wallsNotDuplicateCoverage([block, furring], [8, 1.5]).dropped,
      "the schedule names both and neither should be dropped",
    ).toBe(0);
  });

  it("never drops both of an exact tie, which would count the footage zero times", () => {
    const a = wall(0, 0, 30, 0, 4.5);
    const b = wall(0, 0.2, 30, 0.2, 4.5);
    const { kept, dropped } = wallsNotDuplicateCoverage([a, b]);
    expect(dropped).toBe(1);
    expect(kept, "both halves of a tie were dropped").toHaveLength(1);
  });

  it("BRACKETS THE BOUND, because the bench put a real wall just above it", () => {
    // The mutation run caught this: every other case here is either under 1.01
    // mean thicknesses or over 10, so none of them could tell a bound of 1.1
    // from a bound of 2 — and 2 is the value the twenty fixtures alone argued
    // for, which deletes 451 ft of real wall on the 60-page bench.
    //
    // The bench's layered assemblies sit between 1.1 and 1.3, so this brackets
    // the bound from both sides with two walls of 4.5in, whose mean thickness
    // is 0.375 ft.
    const base = wall(0, 0, 30, 0, 4.5);
    const atOnePoint3 = wall(0, 0.375 * 1.3, 30, 0.375 * 1.3, 4.5);
    expect(
      wallsNotDuplicateCoverage([base, atOnePoint3]).dropped,
      "a layered assembly 1.3 thicknesses away was deleted — this is the bench's 451 ft",
    ).toBe(0);

    const atOnePoint0 = wall(0, 0.375, 30, 0.375, 4.5);
    expect(
      wallsNotDuplicateCoverage([base, atOnePoint0]).dropped,
      "a duplicate at 1.0 thicknesses survived, so the bound does nothing",
    ).toBe(1);
  });

  it("keeps a short segment CROSSING a wall near its middle", () => {
    // A door swing, a junction tick or a jamb return: fully inside the wall's
    // span and well within the distance bound, so only its ANGLE saves it.
    // Without the parallelism test it is read as duplicate coverage.
    const run = wall(0, 0, 40, 0, 4.5);
    const crossing = wall(19, -0.2, 21, 0.2, 4.5);
    expect(
      wallsNotDuplicateCoverage([run, crossing]).dropped,
      "a crossing segment was treated as a duplicate of the wall it crosses",
    ).toBe(0);
  });

  it("drops the SHORTER of two nested walls, never the longer", () => {
    // 29 ft inside 30 ft: each covers the other past the 80% bar, so without
    // the longer-wins test both are dropped and the footage is counted ZERO
    // times — worse than counting it twice, and invisible to a total that is
    // already under.
    const longer = wall(0, 0, 30, 0, 4.5);
    const shorter = wall(0.5, 0.3, 29.5, 0.3, 4.5);
    const { kept, dropped } = wallsNotDuplicateCoverage([longer, shorter]);
    expect(dropped).toBe(1);
    expect(kept).toHaveLength(1);
    expect(kept[0].lengthFeet, "the longer wall was the one dropped").toBeCloseTo(30, 1);
  });

  it("returns everything untouched when there is nothing to compare", () => {
    expect(wallsNotDuplicateCoverage([]).kept).toEqual([]);
    const lone = wall(0, 0, 10, 0, 4.5);
    expect(wallsNotDuplicateCoverage([lone]).kept).toEqual([lone]);
  });
});
