import { describe, expect, it } from "vitest";
import { OTHER_PIECE_SHARE, wallsInTheBuilding } from "./wallVectors";
import type { WallCandidate } from "./wallVectors";

/**
 * ── A BUILDING CAN BE IN MORE THAN ONE PIECE ──
 *
 * `wallsInTheBuilding` groups what is left after the noise filters and kept
 * only the BIGGEST group. That loses a detached wing, a plan split by a
 * courtyard or an atrium, and the far side of anything more than
 * `SAME_BUILDING_FEET` away.
 *
 * Measured on ELEVEN03 A4.B-Y2: keeping substantial pieces recovered 153 ft
 * over 7 runs, 11% of that sheet. The bisect that found it showed the step
 * taking one 32 ft run at 6-1/8in and four 18 ft runs at 12in — the
 * proportions of real walls rather than of furniture.
 *
 * ── A SHARE, NOT A FOOTAGE ──
 *
 * The thing being separated is scale-free. A second wing is comparable to the
 * first; the strays this function exists to reject — a detail bubble, a north
 * arrow, a leftover rectangle — are an order of magnitude below. A fixed
 * footage would have to be right for a studio and a hospital at once.
 *
 * A tenth is deliberately generous towards keeping walls: dropping a real wing
 * costs a bid that misses a wing, and keeping a stray costs a run an estimator
 * can see and delete. Those are not symmetric.
 *
 * Both answer-keyed measures were unchanged across the change — the twenty
 * fixtures at 15 of 17 within 2%, the bench identical including its zero-wall
 * pass. So this adds no phantom where there is a key to say so.
 */

const feetPerUnit = 288;

/** A run of `feet` along x at (x, y), in page-width units. */
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

/** A connected block of `count` runs of `feet` each, near (x, y). */
function wing(x: number, y: number, count: number, feet: number): WallCandidate[] {
  const out: WallCandidate[] = [];
  for (let i = 0; i < count; i += 1) {
    // Stacked a foot apart, so they join each other and nothing else.
    out.push(run(x, y + i / feetPerUnit, feet));
  }
  return out;
}

describe("a detached wing is still the building", () => {
  it("KEEPS A SECOND WING, which the old rule threw away", () => {
    // Two blocks far enough apart to be separate groups — 100 ft, well past
    // the twenty this function joins at.
    const main = wing(0.1, 0.1, 10, 40);
    const annexe = wing(0.1, 0.5, 6, 30);
    const kept = wallsInTheBuilding([...main, ...annexe], feetPerUnit);
    expect(kept).toHaveLength(16);
  });

  it("STILL DROPS A STRAY, which is what it is for", () => {
    // A detail bubble or a leftover rectangle is an order of magnitude below
    // the plan. 4 runs of 2 ft against 400 ft of building is 2%.
    const main = wing(0.1, 0.1, 10, 40);
    const stray = wing(0.1, 0.5, 4, 2);
    const kept = wallsInTheBuilding([...main, ...stray], feetPerUnit);
    expect(kept).toHaveLength(10);
    expect(kept.every((w) => w.lengthFeet === 40)).toBe(true);
  });

  it("keeps the ORIGINAL ORDER, which the overlay reads positionally", () => {
    const main = wing(0.1, 0.1, 10, 40);
    const annexe = wing(0.1, 0.5, 6, 30);
    // Interleaved on input, so a naive concatenation of groups would reorder.
    const mixed: WallCandidate[] = [];
    for (let i = 0; i < 10; i += 1) {
      mixed.push(main[i]);
      if (i < annexe.length) mixed.push(annexe[i]);
    }
    const kept = wallsInTheBuilding(mixed, feetPerUnit);
    expect(kept).toEqual(mixed);
  });

  it("is a SHARE of the biggest, so it works at any building size", () => {
    // The same shape at ten times the scale gives the same answer, which a
    // fixed footage could not.
    const small = wallsInTheBuilding(
      [...wing(0.1, 0.1, 10, 4), ...wing(0.1, 0.5, 6, 3)],
      feetPerUnit,
    );
    const large = wallsInTheBuilding(
      [...wing(0.1, 0.1, 10, 40), ...wing(0.1, 0.5, 6, 30)],
      feetPerUnit,
    );
    expect(small).toHaveLength(16);
    expect(large).toHaveLength(16);
  });

  it("DROPS A FOUR-RUN BOX however big it is, and that is a deliberate trade", () => {
    // ── FOOTAGE SAYS HOW BIG, NEVER WHETHER IT IS A DRAWING ──
    //
    // Caught by `wallVectors.test.ts`, not by reasoning: a title block of two
    // runs at 80 ft against a 560 ft plan is 14% of it, and a tenth alone kept
    // it. So a second piece must also carry more runs than a rectangle has
    // sides.
    //
    // The cost is named rather than hidden: a detached outbuilding drawn as
    // four walls with nothing inside is dropped. Reaching it is not worth
    // admitting every rectangle on the page, and the main group has no such
    // floor — a one-room building IS four runs, and a count standing in for
    // that question returned nothing on three real plans.
    const main = wing(0.1, 0.1, 10, 40);
    const box = wing(0.1, 0.5, 4, 90);
    expect(wallsInTheBuilding([...main, ...box], feetPerUnit)).toHaveLength(10);
  });

  it("sits at a tenth, which is the number the asymmetry argues for", () => {
    // Pinned so a later tightening is a decision somebody makes rather than a
    // drift. Below this, a real wing starts being dropped.
    expect(OTHER_PIECE_SHARE).toBe(0.1);
  });

  it("returns the one group when there is only one", () => {
    const main = wing(0.1, 0.1, 6, 40);
    expect(wallsInTheBuilding(main, feetPerUnit)).toHaveLength(6);
  });

  it("returns nothing for nothing, rather than throwing", () => {
    expect(wallsInTheBuilding([], feetPerUnit)).toEqual([]);
  });
});
