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

/**
 * ── A STRAIGHT RUN LYING ON A CURVED WALL IS THE SAME WALL ──
 *
 * Measured on a held-out library plan: W7 is a 55.14 ft wall sweeping 117
 * degrees, and the engine reported 62.92 ft for it — the arc, plus a 7.80 ft
 * straight run covering the first 4.7 ft of the very same wall. 7.8 ft of one
 * wall, twice, on a number a GC is sent.
 *
 * It survived because the test it had to pass was asked in CHORD space: the
 * straight run is projected into the curved run's end-to-end direction and
 * refused if more than two degrees off it. The chord of a 117 degree arc cuts
 * through the building, so a piece lying exactly ON that wall measured **53
 * degrees** away from it and read as a different wall entirely.
 *
 * The run carries the circle it was drawn on now (`WallCandidate.arc`), and
 * the question is asked of the path instead.
 */
describe("a curved wall is not its chord", () => {
  /** A quarter of a circle of radius 20 centred at the origin, as the engine
   *  stores one: the CHORD as endpoints, the ARC as lengthFeet. */
  const bay = (): WallCandidate => ({
    x1: 20,
    y1: 0,
    x2: 0,
    y2: 20,
    thicknessFeet: 0.5,
    lengthFeet: (Math.PI / 2) * 20,
    curved: true,
    arc: { cx: 0, cy: 0, r: 20 },
  });

  /** A short straight piece lying ON that arc, between two angles. */
  const chordOfBay = (fromDeg: number, toDeg: number): WallCandidate => {
    const a = (fromDeg * Math.PI) / 180;
    const b = (toDeg * Math.PI) / 180;
    const x1 = 20 * Math.cos(a);
    const y1 = 20 * Math.sin(a);
    const x2 = 20 * Math.cos(b);
    const y2 = 20 * Math.sin(b);
    return { x1, y1, x2, y2, thicknessFeet: 0.5, lengthFeet: Math.hypot(x2 - x1, y2 - y1) };
  };

  it("DROPS A STRAIGHT RUN THAT LIES ALONG THE ARC", () => {
    const { kept, dropped } = wallsNotDuplicateCoverage([bay(), chordOfBay(0, 22)]);
    expect(dropped, "the same wall was counted twice").toBe(1);
    expect(kept).toHaveLength(1);
    expect(kept[0].curved).toBe(true);
  });

  it("keeps the curved wall itself", () => {
    // The first version of this branch asked the question the other way round
    // — the curved run's own ends against its own circle, which is true by
    // construction — so every longer run became its duplicate and EVERY curved
    // wall was dropped. Cedar Hollow went from -0.6% to -17.7%.
    const far = wall(-60, -60, 40, -60, 6);
    const { kept } = wallsNotDuplicateCoverage([bay(), far]);
    expect(kept.some((w) => w.curved === true), "the curved wall was dropped").toBe(true);
  });

  it("keeps a wall on the far side of the same circle", () => {
    // A round room: the opposite wall is on this very circle and is a
    // different wall. Without the angular span test it would be swallowed.
    const opposite = chordOfBay(200, 222);
    const { kept } = wallsNotDuplicateCoverage([bay(), opposite]);
    expect(kept, "a wall across the room was read as a duplicate").toHaveLength(2);
  });

  it("keeps a partition that MEETS the curved wall at one end", () => {
    // A straight wall butting into a curved one: one end is on the arc, the
    // other runs away into the room. It shares a point with the wall and is
    // not the same wall, which is why BOTH ends have to be on the circle and
    // not just one. This is the commonest shape on any plan with a curve in
    // it, so getting it wrong would delete real partitions wholesale.
    const meets: WallCandidate = {
      x1: 20 * Math.cos(Math.PI / 6),
      y1: 20 * Math.sin(Math.PI / 6),
      x2: 6 * Math.cos(Math.PI / 6),
      y2: 6 * Math.sin(Math.PI / 6),
      thicknessFeet: 0.5,
      lengthFeet: 14,
    };
    const { kept } = wallsNotDuplicateCoverage([bay(), meets]);
    expect(kept, "a partition meeting the curve was eaten by it").toHaveLength(2);
  });

  it("keeps a straight wall that merely crosses the arc's chord", () => {
    // The chord of this bay runs from (20,0) to (0,20). A wall sitting on that
    // line is nowhere near the actual wall, which bulges out to radius 20.
    const onTheChord = wall(14, 6, 6, 14, 6);
    const { kept } = wallsNotDuplicateCoverage([bay(), onTheChord]);
    expect(kept, "a wall on the chord was mistaken for the arc").toHaveLength(2);
  });
});
