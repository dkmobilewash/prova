import { describe, expect, it } from "vitest";

import { itemGeometry, type ItemForLines } from "./takeoff-item-lines";
import { componentRunQuantity, type WallComponentBasis } from "@/lib/wall-assemblies";

/**
 * ── THE GEOMETRY AN ITEM OFFERS AN ASSEMBLY ──
 *
 * The writes themselves need a database and are exercised by the e2e walk;
 * what is testable here is the arithmetic that decides the quantities, which
 * is the half with the money in it.
 *
 * A sheet 100 feet across means a 0.1-wide line is 10 ft, so every number
 * below can be checked in your head.
 */

const SCALE = 100;

function linear(xs: number[], ys: number[]) {
  return { id: "m", pageNumber: 1, kind: "LINEAR" as const, xs, ys, feetPerPageWidth: SCALE };
}
function area(xs: number[], ys: number[], cutouts: { xs: number[]; ys: number[] }[] = []) {
  return { id: "a", pageNumber: 1, kind: "AREA" as const, xs, ys, cutouts, feetPerPageWidth: SCALE };
}
function count(n: number) {
  return {
    id: "c",
    pageNumber: 1,
    kind: "COUNT" as const,
    xs: Array.from({ length: n }, (_, i) => i / 100),
    ys: Array.from({ length: n }, () => 0.5),
    feetPerPageWidth: SCALE,
  };
}

function item(over: Partial<ItemForLines>): ItemForLines {
  return {
    id: "i1",
    name: "Item",
    type: "LINEAR",
    heightFt: null,
    sides: null,
    wastePercent: null,
    depthIn: null,
    wallTypeId: "w1",
    measurements: [],
    ...over,
  };
}

/** A 0.1 × 0.1 square = 10 × 10 ft = 100 sq ft, perimeter 40 ft. */
const SQUARE = { xs: [0, 0.1, 0.1, 0], ys: [0, 0, 0.1, 0.1] };

describe("itemGeometry", () => {
  it("FILLS A WALL'S BASES FROM A TRACED LINE, which is the common case", () => {
    // An item traced LINEAR with a height and sides IS a wall, and the
    // starter partition prices it off BOARDED_SQFT. Leaving those at zero
    // would mean the most common thing this product does produced nothing.
    const geometry = itemGeometry(
      item({ measurements: [linear([0, 0.1], [0, 0])], heightFt: 9, sides: 2 }),
    );
    expect(geometry.linearFt).toBe(10);
    expect(geometry.faceSqFt).toBe(90); // 10 × 9, one face
    expect(geometry.boardedSqFt).toBe(180); // × 2 sides
  });

  it("DOES NOT APPLY THE ITEM'S WASTE — the part applies its own", () => {
    // THE RULE WORTH A TEST. `componentRunQuantity` multiplies by the PART's
    // waste; if the geometry carried the item's as well, every part that has
    // one would be wasted twice and a bid would come in high by a factor
    // nobody could find.
    const plain = itemGeometry(item({ measurements: [linear([0, 0.1], [0, 0])], heightFt: 9, sides: 2 }));
    const wasted = itemGeometry(
      item({ measurements: [linear([0, 0.1], [0, 0])], heightFt: 9, sides: 2, wastePercent: 10 }),
    );
    expect(wasted).toEqual(plain);
  });

  it("reports an area net of its cutouts, and its perimeter only when asked", () => {
    const hole = { xs: [0.01, 0.06, 0.06, 0.01], ys: [0.01, 0.01, 0.06, 0.06] };

    const plainArea = itemGeometry(item({ type: "AREA", measurements: [area(SQUARE.xs, SQUARE.ys, [hole])] }));
    expect(plainArea.areaSqFt).toBe(75);
    // A plain AREA has no perimeter: `itemQuantity` only computes one for the
    // type that says it has one, and guessing from a bounding box is the
    // refusal this codebase makes everywhere else.
    expect(plainArea.perimeterFt).toBe(0);

    const withPerimeter = itemGeometry(
      item({ type: "AREA_WITH_PERIMETER", measurements: [area(SQUARE.xs, SQUARE.ys, [hole])] }),
    );
    expect(withPerimeter.areaSqFt).toBe(75);
    expect(withPerimeter.perimeterFt).toBe(40); // the OUTLINE, not the hole
  });

  it("computes volume from the item's own depth, and NOTHING without one", () => {
    // A slab with no depth produces no concrete rather than a guessed four
    // inches — a guessed figure is one that looks right and gets bid.
    const noDepth = itemGeometry(item({ type: "AREA", measurements: [area(SQUARE.xs, SQUARE.ys)] }));
    expect(noDepth.volumeCy).toBe(0);

    const slab = itemGeometry(
      item({ type: "AREA", depthIn: 6, measurements: [area(SQUARE.xs, SQUARE.ys)] }),
    );
    // 100 sq ft × 0.5 ft ÷ 27 = 1.85 cu yd
    expect(slab.volumeCy).toBeCloseTo((100 * 0.5) / 27, 6);
  });

  it("counts a count", () => {
    expect(itemGeometry(item({ type: "COUNT", measurements: [count(7)] })).count).toBe(7);
  });

  it("REPORTS ZERO STUDS rather than inventing a spacing", () => {
    // An item carries no stud spacing in its geometry. Zero is visible; a
    // guessed 16″ o.c. is a stud count that gets bid.
    expect(itemGeometry(item({ measurements: [linear([0, 0.5], [0, 0])], heightFt: 9 })).studs).toBe(0);
  });
  it("COUNTS STUDS ONLY WHEN THE ASSEMBLY'S SPACING IS HANDED IN, the way a wall run does", () => {
    // 50 ft at 16" o.c.: 38 bays + 1 = 39, `studsRequired`'s own arithmetic.
    // The spacing is the assembly's; null and zero both leave the count at
    // zero rather than guessing 16".
    const line = linear([0, 0.5], [0, 0]);
    expect(itemGeometry(item({ measurements: [line], heightFt: 9, studSpacingIn: 16 })).studs).toBe(39);
    expect(itemGeometry(item({ measurements: [line], heightFt: 9, studSpacingIn: 24 })).studs).toBe(26);
    expect(itemGeometry(item({ measurements: [line], heightFt: 9, studSpacingIn: null })).studs).toBe(0);
    expect(itemGeometry(item({ measurements: [line], heightFt: 9, studSpacingIn: 0 })).studs).toBe(0);
  });
});

describe("the bases an assembly can ask for", () => {
  const part = (basis: WallComponentBasis, factor = 1, wastePercent = 0) => ({
    id: "p",
    description: "part",
    unit: "ea",
    basis,
    factor,
    wastePercent,
    roundUp: false,
    productionRate: null,
  });

  it("prices a ceiling off AREA_SQFT and PERIMETER_FT", () => {
    const geometry = itemGeometry(
      item({ type: "AREA_WITH_PERIMETER", measurements: [area(SQUARE.xs, SQUARE.ys)] }),
    );
    expect(componentRunQuantity(part("AREA_SQFT"), geometry)).toBe(100);
    expect(componentRunQuantity(part("PERIMETER_FT"), geometry)).toBe(40);
    // And the part's own waste, which the geometry did not apply.
    expect(componentRunQuantity(part("AREA_SQFT", 1, 5), geometry)).toBeCloseTo(105, 6);
  });

  it("GIVES A WALL RUN'S BASES NOTHING FROM AN AREA, rather than something plausible", () => {
    // A traced ceiling has no studs and no boarded face. Zero is a figure an
    // estimator notices; a face area computed from a perimeter is not.
    const ceiling = itemGeometry(item({ type: "AREA", measurements: [area(SQUARE.xs, SQUARE.ys)] }));
    expect(componentRunQuantity(part("STUDS"), ceiling)).toBe(0);
    expect(componentRunQuantity(part("BOARDED_SQFT"), ceiling)).toBe(0);
  });

  it("gives an area's bases nothing from a traced line, for the same reason", () => {
    const wall = itemGeometry(item({ measurements: [linear([0, 0.1], [0, 0])], heightFt: 9, sides: 2 }));
    expect(componentRunQuantity(part("AREA_SQFT"), wall)).toBe(0);
    expect(componentRunQuantity(part("VOLUME_CY"), wall)).toBe(0);
  });

  it("is PER_RUN once per item, not once per measurement", () => {
    // A head-of-wall detail is per CONDITION. Counting it per traced segment
    // would multiply it by however many times somebody lifted the mouse.
    const geometry = itemGeometry(
      item({
        measurements: [linear([0, 0.1], [0, 0]), linear([0.2, 0.3], [0, 0]), linear([0.4, 0.5], [0, 0])],
        heightFt: 9,
        sides: 2,
      }),
    );
    expect(componentRunQuantity(part("PER_RUN"), geometry)).toBe(1);
    // …while the footage is all three.
    expect(geometry.linearFt).toBe(30);
  });
});
