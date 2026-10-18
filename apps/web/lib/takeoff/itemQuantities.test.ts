import { describe, expect, it } from "vitest";

import { formatQuantity, itemQuantity, itemQuantityOnPage, netArea, type ItemMeasurement } from "./itemQuantities";

/**
 * ── THE NUMBERS IN HERE ARE CHOSEN SO THE ARITHMETIC IS OBVIOUS ──
 *
 * A measurement's coordinates are fractions of the PAGE WIDTH, so a scale of
 * 100 feet-per-page-width means a 0.1-wide line is 10 ft. Every expectation
 * below can be checked in your head, which is the point: a test whose
 * expected value came out of the implementation proves only that the
 * implementation is reproducible.
 */

const SCALE = 100;

function linear(id: string, xs: number[], ys: number[], page = 1): ItemMeasurement {
  return { id, pageNumber: page, kind: "LINEAR", xs, ys, feetPerPageWidth: SCALE };
}
function area(
  id: string,
  xs: number[],
  ys: number[],
  cutouts: { xs: number[]; ys: number[] }[] = [],
  page = 1,
): ItemMeasurement {
  return { id, pageNumber: page, kind: "AREA", xs, ys, cutouts, feetPerPageWidth: SCALE };
}
function count(id: string, n: number, page = 1): ItemMeasurement {
  return {
    id,
    pageNumber: page,
    kind: "COUNT",
    xs: Array.from({ length: n }, (_, i) => i / 100),
    ys: Array.from({ length: n }, () => 0.5),
    feetPerPageWidth: SCALE,
  };
}

/** A 0.1 × 0.1 square = 10 ft × 10 ft = 100 sq ft, perimeter 40 ft. */
const SQUARE = { xs: [0, 0.1, 0.1, 0], ys: [0, 0, 0.1, 0.1] };

describe("netArea", () => {
  it("deducts a cutout from its outline", () => {
    // 0.1 x 0.1 outline less a 0.05 x 0.05 hole = 0.01 - 0.0025.
    const hole = { xs: [0.01, 0.06, 0.06, 0.01], ys: [0.01, 0.01, 0.06, 0.06] };
    expect(netArea(SQUARE.xs, SQUARE.ys, [hole])).toBeCloseTo(0.0075, 6);
  });

  it("NEVER GOES NEGATIVE, however the cutouts are drawn", () => {
    // THE RULE THIS FUNCTION EXISTS FOR. A door traced bigger than its wall,
    // or the same opening traced twice, would otherwise SUBTRACT from the
    // item's total — quietly reducing a bid by a figure nobody can see on the
    // drawing. Clamping is wrong in a way somebody notices.
    const huge = { xs: [0, 1, 1, 0], ys: [0, 0, 1, 1] };
    expect(netArea(SQUARE.xs, SQUARE.ys, [huge])).toBe(0);
    expect(netArea(SQUARE.xs, SQUARE.ys, [SQUARE, SQUARE])).toBe(0);
  });

  it("is zero for a shape with no area rather than throwing", () => {
    expect(netArea([0, 1], [0, 1])).toBe(0);
  });
});

describe("itemQuantity", () => {
  it("adds linear runs across sheets and says which sheets", () => {
    const q = itemQuantity(
      [linear("a", [0, 0.1], [0, 0], 1), linear("b", [0, 0.2], [0, 0], 3)],
      { type: "LINEAR" },
    );
    expect(q.linearFt).toBe(30); // 10 ft + 20 ft
    expect(q.primary).toBe(30);
    expect(q.unit).toBe("ft");
    expect(q.pages).toEqual([1, 3]);
  });

  it("applies waste to material, and NEVER to a count", () => {
    // You do not buy 1.1 doors. A count with waste on it reads as a miscount
    // rather than as an allowance.
    const walls = itemQuantity([linear("a", [0, 0.1], [0, 0])], { type: "LINEAR", wastePercent: 10 });
    expect(walls.primary).toBe(11);
    // …and the raw geometry is untouched, so the two can be told apart.
    expect(walls.linearFt).toBe(10);

    const doors = itemQuantity([count("c", 7)], { type: "COUNT", wastePercent: 10 });
    expect(doors.primary).toBe(7);
    expect(doors.count).toBe(7);
    expect(doors.unit).toBe("ea");
  });

  it("computes wall face area as length x height x sides, with waste", () => {
    // The brief's own example: wall SF = LF x height x sides.
    const q = itemQuantity([linear("a", [0, 0.1], [0, 0])], {
      type: "LINEAR",
      heightFt: 9,
      sides: 2,
      wastePercent: 10,
    });
    expect(q.faceSqFt).toBe(198); // 10 x 9 x 2 x 1.1
  });

  it("has no face area when nobody has given the item a height", () => {
    // Zero rather than a guessed 8 ft or 10 ft: a height is in the wall
    // schedule or in somebody's head, never on the plan.
    expect(itemQuantity([linear("a", [0, 0.1], [0, 0])], { type: "LINEAR" }).faceSqFt).toBe(0);
  });

  it("reports an area net of its cutouts", () => {
    const hole = { xs: [0.01, 0.06, 0.06, 0.01], ys: [0.01, 0.01, 0.06, 0.06] };
    const q = itemQuantity([area("a", SQUARE.xs, SQUARE.ys, [hole])], { type: "AREA" });
    expect(q.areaSqFt).toBe(75); // 100 sq ft less 25
    expect(q.unit).toBe("sq ft");
  });

  it("gives AREA_WITH_PERIMETER the outline's perimeter, not the cutouts'", () => {
    // Base and wall angle follow the room, not the doors punched out of it.
    const hole = { xs: [0.01, 0.06, 0.06, 0.01], ys: [0.01, 0.01, 0.06, 0.06] };
    const q = itemQuantity([area("a", SQUARE.xs, SQUARE.ys, [hole])], { type: "AREA_WITH_PERIMETER" });
    expect(q.linearFt).toBe(40); // 4 x 10 ft, the outline alone
    expect(q.primary).toBe(75); // the area is still the headline
    expect(q.unit).toBe("sq ft");
  });

  it("measures a SEGMENT exactly like a LINEAR", () => {
    // They differ in what an assembly does with them, which is not this
    // file's business.
    const geometry = [linear("a", [0, 0.1], [0, 0])];
    expect(itemQuantity(geometry, { type: "SEGMENT" }).primary).toBe(
      itemQuantity(geometry, { type: "LINEAR" }).primary,
    );
  });

  it("COUNTS A COUNT WITHOUT A SCALE, and reports the ones it could not price", () => {
    // A count needs no calibration — it is points placed, not distance. An
    // unscaled LINEAR contributes nothing and SAYS SO, rather than silently
    // adding zero feet and reading as a short wall.
    const q = itemQuantity(
      [
        { ...count("c", 4), feetPerPageWidth: null },
        { ...linear("a", [0, 0.5], [0, 0]), feetPerPageWidth: null },
        linear("b", [0, 0.1], [0, 0]),
      ],
      { type: "LINEAR" },
    );
    expect(q.count).toBe(4);
    expect(q.linearFt).toBe(10); // only the scaled one
    expect(q.unscaled).toBe(1); // and the other is reported, not hidden
  });

  it("treats a zero or negative scale as unscaled rather than as infinity", () => {
    const q = itemQuantity([{ ...linear("a", [0, 0.1], [0, 0]), feetPerPageWidth: 0 }], { type: "LINEAR" });
    expect(q.linearFt).toBe(0);
    expect(q.unscaled).toBe(1);
  });

  it("is all zeros for an item nobody has measured", () => {
    const q = itemQuantity([], { type: "LINEAR" });
    expect(q).toMatchObject({ linearFt: 0, areaSqFt: 0, count: 0, primary: 0, unscaled: 0, pages: [] });
  });
});

describe("itemQuantityOnPage", () => {
  it("is the sheet's share, which is what the on-canvas summary shows", () => {
    const geometry = [linear("a", [0, 0.1], [0, 0], 1), linear("b", [0, 0.3], [0, 0], 2)];
    expect(itemQuantityOnPage(geometry, { type: "LINEAR" }, 1).primary).toBe(10);
    expect(itemQuantityOnPage(geometry, { type: "LINEAR" }, 2).primary).toBe(30);
    expect(itemQuantity(geometry, { type: "LINEAR" }).primary).toBe(40);
  });
});

describe("formatQuantity", () => {
  it("reads as a quantity with its unit", () => {
    expect(formatQuantity(itemQuantity([linear("a", [0, 0.1], [0, 0])], { type: "LINEAR" }))).toBe("10 ft");
    expect(formatQuantity(itemQuantity([count("c", 7)], { type: "COUNT" }))).toBe("7 ea");
  });

  it("groups the thousands, because a real takeoff reaches them", () => {
    // 0.1 of the page at 100,000 ft across = 10,000 ft. A bid-sized number
    // run together is a misreading waiting to happen.
    const q = itemQuantity([{ ...linear("a", [0, 0.1], [0, 0]), feetPerPageWidth: 100_000 }], {
      type: "LINEAR",
    });
    expect(formatQuantity(q)).toBe("10,000 ft");
  });
});
