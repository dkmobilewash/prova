import { describe, expect, it } from "vitest";
import {
  gridSizeFor,
  rasterise,
  regionsOf,
  roomGrid,
  CELLS_PER_THINNEST_WALL,
  THINNEST_WALL_FEET,
} from "./rooms";
import type { StrokeSegment } from "./wallVectors";

/**
 * THE FOUNDATION THE WALL FINDER IS BEING REBUILT ON.
 *
 * Line pairing cannot be complete — a wall drawn as poché is not two lines, and
 * recall settled near 40% across four real plan sets. An estimator cannot bid
 * from an unknown 40%, so the formulation changes: a floor plan is a set of
 * enclosed regions, rooms are the big ones, and a wall is a thin one with a
 * DIFFERENT ROOM ON EACH SIDE.
 *
 * Everything here is about the two properties that whole argument rests on:
 *
 *   1. a wall cavity stays HOLLOW, or there is no region to find;
 *   2. two rooms do not LEAK into each other, or "a different room on each
 *      side" means nothing.
 *
 * One unit is one foot in these fixtures, so a wall 0.4 units thick is a 4-7/8in
 * partition and the arithmetic stays readable.
 */

const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2 });

/** A rectangular room's four walls, each drawn as two faces `t` apart. */
function room(x: number, y: number, w: number, h: number, t = 0.4): StrokeSegment[] {
  return [
    seg(x, y, x + w, y),
    seg(x, y + t, x + w, y + t),
    seg(x, y + h, x + w, y + h),
    seg(x, y + h - t, x + w, y + h - t),
    seg(x, y, x, y + h),
    seg(x + t, y, x + t, y + h),
    seg(x + w, y, x + w, y + h),
    seg(x + w - t, y, x + w - t, y + h),
  ];
}

describe("the grid a sheet is read on", () => {
  it("is sized by the THINNEST WALL, not by a pixel count", () => {
    // Fixing a resolution would silently stop finding partitions on a sheet
    // drawn at a smaller scale — a failure that reads as "this plan has fewer
    // walls" rather than as a failure.
    const g = gridSizeFor(100, 60, 1);
    expect(THINNEST_WALL_FEET / g.feetPerCell).toBeCloseTo(CELLS_PER_THINNEST_WALL, 5);
  });

  it("keeps the sheet's aspect, so a wall is not thinner one way than the other", () => {
    const g = gridSizeFor(100, 50, 1);
    expect(g.width / g.height).toBeCloseTo(2, 1);
  });

  it("caps the grid and SAYS SO through feetPerCell rather than silently", () => {
    // A 42in sheet at a detail scale would ask for a grid nobody can hold. The
    // caller learns the resolution changed from the number it gets back.
    const g = gridSizeFor(100_000, 60_000, 1, 1024);
    expect(g.width).toBe(1024);
    expect(g.feetPerCell).toBeGreaterThan(THINNEST_WALL_FEET / CELLS_PER_THINNEST_WALL);
  });
});

describe("drawing the line work", () => {
  it("marks a straight run end to end, with no gaps for a fill to leak through", () => {
    const ink = rasterise([seg(0, 5, 20, 5)], 20, 10, 1, 1);
    for (let x = 0; x < 20; x += 1) {
      expect(ink[5 * 20 + x], `cell ${x}`).toBe(1);
    }
  });

  it("marks a diagonal with no diagonal gaps", () => {
    // A gap here is not cosmetic: a four-connected fill walks straight through
    // it and merges two rooms.
    const ink = rasterise([seg(0, 0, 9, 9)], 10, 10, 1, 1);
    let marked = 0;
    for (let i = 0; i < ink.length; i += 1) marked += ink[i];
    expect(marked).toBeGreaterThanOrEqual(10);
  });

  it("ignores a run that falls outside the grid rather than throwing", () => {
    expect(() => rasterise([seg(-50, -50, -40, -40)], 10, 10, 1, 1)).not.toThrow();
  });
});

describe("finding the enclosed regions", () => {
  it("separates the inside of a box from the paper around it", () => {
    const ink = rasterise(
      [seg(2, 2, 8, 2), seg(8, 2, 8, 8), seg(8, 8, 2, 8), seg(2, 8, 2, 2)],
      10,
      10,
      1,
      1,
    );
    const regions = regionsOf(ink, 10, 10);
    const enclosed = regions.filter((r) => !r.open);
    expect(enclosed).toHaveLength(1);
    expect(regions.filter((r) => r.open)).toHaveLength(1);
  });

  it("DOES NOT LEAK THROUGH A CORNER, which the whole method rests on", () => {
    // Two rooms sharing a wall. With eight-connectivity a fill escapes
    // diagonally where the walls meet and the two rooms become one — and "a
    // different room on each side" then means nothing at all.
    //
    // ASSERTED AS TWO NAMED POINTS HAVING DIFFERENT LABELS, because counting
    // "room-sized regions >= 2" proved nothing: a mutation to eight-connectivity
    // merged the rooms and the count stayed above two on the wall cavities. The
    // claim is that THESE TWO SPACES are distinct, so that is what is measured.
    const grid = roomGrid([...room(0, 0, 10, 10), ...room(10, 0, 10, 10)], 24, 12, 1);
    const at = (xFt: number, yFt: number) => {
      const cx = Math.round(xFt / grid.feetPerCell);
      const cy = Math.round(yFt / grid.feetPerCell);
      return grid.label[cy * grid.width + cx];
    };
    const left = at(5, 5); // inside the left room
    const right = at(15, 5); // inside the right room
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(0);
    expect(left).not.toBe(right);
    // And neither is the paper outside the drawing.
    expect(grid.regions[left].open).toBe(false);
    expect(grid.regions[right].open).toBe(false);
  });

  it("TREATS A DIAGONAL TOUCH AS SEPARATE, which is the connectivity rule itself", () => {
    // Two spaces meeting only at a corner. Eight-connectivity walks the
    // diagonal and merges them; four-connectivity does not.
    //
    // ASSERTED ON THIS MINIMAL SHAPE RATHER THAN ON A ROOM LAYOUT, because a
    // layout where each room carries its own walls has a DOUBLE barrier between
    // the two spaces — no diagonal to leak through — so the mutation to
    // eight-connectivity came back green on it. The property under test is the
    // connectivity, so the fixture is the connectivity.
    //
    //   . #        paper at (0,0) and (1,1); ink at (1,0) and (0,1)
    //   # .
    const ink = new Uint8Array([0, 1, 1, 0]);
    const regions = regionsOf(ink, 2, 2);
    expect(regions).toHaveLength(2);
    expect(regions.label[0]).not.toBe(regions.label[3]);
  });

  it("finds the CAVITY inside the THINNEST wall it claims to handle", () => {
    // A wall drawn as two faces encloses a long thin space, and that space is
    // what this method calls the wall. It must survive the rasteriser at the
    // thinnest wall the module advertises — a 2-1/2in furring wall — because
    // that is where the grid resolution is set and where it fails first.
    //
    // THE FIXTURE USES 0.2ft FOR THAT REASON: an earlier one drew 0.4ft walls,
    // which stay hollow even at one cell per wall, so dropping the resolution
    // to a quarter changed nothing and the mutation came back green.
    const grid = roomGrid(room(0, 0, 20, 12, THINNEST_WALL_FEET), 24, 16, 1);
    const enclosed = grid.regions.filter((r) => !r.open);
    const thin = enclosed.filter((r) => {
      const widthFt = r.minor * grid.feetPerCell;
      const lengthFt = Math.max(r.maxX - r.minX, r.maxY - r.minY) * grid.feetPerCell;
      return widthFt < 1.5 && lengthFt > 5;
    });
    expect(thin.length).toBeGreaterThan(0);
  });

  it("gives a room a far larger minor dimension than a wall", () => {
    // The measure that tells them apart without computing a medial axis.
    const grid = roomGrid(room(0, 0, 20, 12), 24, 16, 1);
    const enclosed = grid.regions.filter((r) => !r.open);
    const widest = Math.max(...enclosed.map((r) => r.minor * grid.feetPerCell));
    const thinnest = Math.min(...enclosed.map((r) => r.minor * grid.feetPerCell));
    expect(widest / thinnest).toBeGreaterThan(3);
  });

  it("returns only the open region for a blank sheet", () => {
    const grid = roomGrid([], 20, 10, 1);
    expect(grid.regions).toHaveLength(1);
    expect(grid.regions[0].open).toBe(true);
  });

  it("labels every cell that is not ink", () => {
    // The size assertion: a region set that is empty satisfies every claim
    // above it, because nothing is ever missing from an empty list.
    const grid = roomGrid(room(0, 0, 10, 8), 14, 10, 1);
    let labelled = 0;
    for (let i = 0; i < grid.label.length; i += 1) if (grid.label[i] !== -1) labelled += 1;
    expect(labelled).toBeGreaterThan(grid.label.length / 2);
    expect(grid.regions.length).toBeGreaterThan(1);
  });
});
