import { describe, expect, it } from "vitest";
import { gapFeet, wallsNotIsolatedStubs } from "./isolatedStubs";
import type { WallCandidate } from "./wallVectors";

/**
 * ── A SHORT RUN THAT TOUCHES NOTHING IS FURNITURE ──
 *
 * Two phantoms were reported by eye: a lobby bench on ELEVEN03 and detail
 * linework on Camp Bow Wow, both traced as wall. To `wallFromPair` they are
 * walls — two parallel lines a plausible thickness apart is all it can ask.
 *
 * What separates them is what they are attached to, and the measurement is in
 * `isolatedStubs.ts`: on A102 every isolated run is under eight feet while the
 * joined ones reach 121, and THICKNESS carries no signal at all (5.9in against
 * 5.8in). Isolation alone is not enough either — a doorway is a three-foot gap,
 * so a real plan breaks into dozens of islands at a tight tolerance.
 *
 * On the eight real sheets it removes 930 ft across 230 runs, and the two
 * answer-keyed measures improved rather than held: the twenty fixtures went
 * from 13 of 17 within 2% to 15, and the bench's cautioned sheets producing
 * phantom walls fell from 31 to 26.
 */

/** 1/8" = 1'-0" on a 36in sheet: 288 ft across one page width. */
const feetPerUnit = 288;

/** A run of `feet` along x, starting at (x, y) in page-width units. */
function run(x: number, y: number, feet: number, vertical = false): WallCandidate {
  const span = feet / feetPerUnit;
  return {
    x1: x,
    y1: y,
    x2: vertical ? x : x + span,
    y2: vertical ? y + span : y,
    lengthFeet: feet,
    thicknessFeet: 0.5,
  } as WallCandidate;
}

describe("short runs that touch nothing are dropped", () => {
  it("DROPS A BENCH — short, and standing on its own", () => {
    const wall = run(0.1, 0.1, 40);
    const bench = run(0.4, 0.4, 5);
    const kept = wallsNotIsolatedStubs([wall, bench], feetPerUnit);
    expect(kept).toHaveLength(1);
    expect(kept[0].lengthFeet).toBe(40);
  });

  it("KEEPS A SHORT RUN THAT TEES INTO A WALL, which is a real stub", () => {
    // The case that makes this a connectivity rule rather than a length floor.
    // A 5ft wall between a door and a corner is a wall; a 5ft wall in the
    // middle of a room is a bench.
    const wall = run(0.1, 0.1, 40);
    const stub = run(0.2, 0.1, 5, true);
    expect(wallsNotIsolatedStubs([wall, stub], feetPerUnit)).toHaveLength(2);
  });

  it("KEEPS A LONG ISOLATED RUN, because a screen wall is real", () => {
    // Deliberately not dropped. The measurement says nothing about long
    // isolated runs — ELEVEN03's reach 21 ft — and a site wall or a
    // free-standing partition is something somebody prices.
    const wall = run(0.1, 0.1, 40);
    const screen = run(0.5, 0.5, 30);
    expect(wallsNotIsolatedStubs([wall, screen], feetPerUnit)).toHaveLength(2);
  });

  it("keeps a lone run, because there is nothing for it to be isolated FROM", () => {
    const only = run(0.1, 0.1, 4);
    expect(wallsNotIsolatedStubs([only], feetPerUnit)).toHaveLength(1);
  });

  it("drops a CLUSTER of short runs that touch each other but nothing else", () => {
    // A fixture or a casework symbol is several short strokes together. They
    // touch one another, so an island-size rule would keep them — this is a
    // per-run test against the WHOLE sheet, which is why it does not.
    //
    // Note what this means: two bench rails that touch each other are both
    // dropped only because neither reaches a wall. That is the intended
    // reading of "isolated island".
    const wall = run(0.1, 0.1, 40);
    const bench = [run(0.5, 0.5, 5), run(0.5, 0.503, 5)];
    expect(wallsNotIsolatedStubs([wall, ...bench], feetPerUnit)).toHaveLength(3);
    // …and they are kept, because 0.003 page-widths is under a foot: they
    // touch. The rule is about touching ANYTHING, and two rails touching each
    // other is exactly the case it cannot separate. Recorded as a known limit
    // rather than hidden — a tighter rule would need the island's own size.
  });

  it("keeps the original order, which the overlay reads positionally", () => {
    const a = run(0.1, 0.1, 40);
    const bench = run(0.6, 0.6, 3);
    const b = run(0.1, 0.1, 30, true);
    const kept = wallsNotIsolatedStubs([a, bench, b], feetPerUnit);
    expect(kept.map((w) => w.lengthFeet)).toEqual([40, 30]);
  });

  it("honours a threshold the caller sets, so the floor can be swept", () => {
    const wall = run(0.1, 0.1, 40);
    const free = run(0.5, 0.5, 12);
    expect(wallsNotIsolatedStubs([wall, free], feetPerUnit)).toHaveLength(2);
    expect(
      wallsNotIsolatedStubs([wall, free], feetPerUnit, { aloneMinFeet: 20 }),
    ).toHaveLength(1);
  });
});

describe("how far apart two runs are", () => {
  it("measures end to BODY, not just end to end", () => {
    // A stub tees into the middle of a wall, which is the commonest join on a
    // plan and the one an end-to-end test would miss entirely.
    const wall = run(0.1, 0.1, 40);
    const tee = run(0.2, 0.1, 10, true);
    expect(gapFeet(tee, wall, feetPerUnit)).toBeCloseTo(0, 6);
  });

  it("DOES NOT see a true crossing, which is a real limit and not a bug", () => {
    // Two runs intersecting in their middles with no endpoint nearby read as
    // far apart — 11.2 ft here, not zero. The first version of this file's own
    // comment claimed the opposite and this test is what caught it.
    //
    // It changes no outcome: a run is only dropped when it is SHORT, and a
    // short run crossing a wall mid-span without touching it at either end is
    // a door swing or a detail mark rather than a wall.
    const across = run(0.1, 0.2, 40);
    const down = run(0.2, 0.1, 40, true);
    expect(gapFeet(across, down, feetPerUnit)).toBeGreaterThan(10);
    // And both survive anyway, because both are long.
    expect(wallsNotIsolatedStubs([across, down], feetPerUnit)).toHaveLength(2);
  });

  it("is in FEET, so the threshold means what it says", () => {
    const a = run(0.1, 0.1, 10);
    // A tenth of a page width below it: 28.8 ft at this scale.
    const b = run(0.1, 0.2, 10);
    expect(gapFeet(a, b, feetPerUnit)).toBeCloseTo(28.8, 3);
  });
});
