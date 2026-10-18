import { describe, expect, it } from "vitest";
import { squaredDistanceToInk, widestPointOf } from "./distance";
import { roomGrid, THINNEST_WALL_FEET } from "./rooms";
import type { StrokeSegment } from "./wallVectors";

/**
 * THE MEASUREMENT THE FIRST CLASSIFIER WAS MISSING.
 *
 * A region's thickness was taken as its area over its longest side. That is the
 * thickness on a fixture and nonsense on a plan, because wall cavities CONNECT —
 * at every corner one wall's cavity joins the next, so the interior walls form
 * branching networks whose longest side spans the building. It reported "7
 * inches" for a shape half a building wide, and the result looked like a five-
 * fold improvement until it was drawn, when the whole sheet came out red.
 *
 * Thickness is local. These tests are about getting it exactly right, because
 * the number becomes a wall thickness, which picks a wall type, which prices a
 * bid.
 */

const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2 });

function inkGrid(width: number, height: number, marked: [number, number][]): Uint8Array {
  const ink = new Uint8Array(width * height);
  for (const [x, y] of marked) ink[y * width + x] = 1;
  return ink;
}

describe("distance to the nearest ink", () => {
  it("is zero on the ink itself", () => {
    const d = squaredDistanceToInk(inkGrid(5, 5, [[2, 2]]), 5, 5);
    expect(d[2 * 5 + 2]).toBe(0);
  });

  it("is EXACT on the diagonal, where a chamfer would be wrong", () => {
    // The reason this is Felzenszwalb rather than a two-pass chamfer: a chamfer
    // approximates the diagonal within a few per cent, and a few per cent of a
    // wall thickness picks the wrong wall type.
    const d = squaredDistanceToInk(inkGrid(9, 9, [[4, 4]]), 9, 9);
    expect(d[0]).toBe(4 * 4 + 4 * 4); // (0,0) to (4,4), squared
    expect(Math.sqrt(d[0])).toBeCloseTo(Math.hypot(4, 4), 10);
    // And a knight's-move offset, which is where chamfer error is largest.
    expect(d[2 * 9 + 3]).toBe(1 * 1 + 2 * 2);
  });

  it("takes the NEAREST of several marks, not the first", () => {
    const d = squaredDistanceToInk(inkGrid(11, 1, [[0, 0], [10, 0]]), 11, 1);
    expect(d[7]).toBe(9); // 3 from the right-hand mark, 7 from the left
  });

  it("is large everywhere when there is no ink at all", () => {
    const d = squaredDistanceToInk(new Uint8Array(16), 4, 4);
    expect(d.every((v) => v > 1e6)).toBe(true);
  });

  it("measures the half-width of a corridor from its centre", () => {
    // Two walls ten cells apart: the centre is five from each, so the space is
    // ten wide — which is the number a wall is classified on.
    const marks: [number, number][] = [];
    for (let x = 0; x < 20; x += 1) {
      marks.push([x, 0]);
      marks.push([x, 10]);
    }
    const d = squaredDistanceToInk(inkGrid(20, 11, marks), 20, 11);
    expect(Math.sqrt(d[5 * 20 + 10])).toBe(5);
  });
});

describe("the widest point of a region", () => {
  /** A rectangular room's four walls, each drawn as two faces `t` apart. */
  function room(x: number, y: number, w: number, h: number, t: number): StrokeSegment[] {
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

  it("TELLS A WALL CAVITY FROM A ROOM, which area-over-length could not", () => {
    const grid = roomGrid(room(0, 0, 20, 14, THINNEST_WALL_FEET), 24, 18, 1);
    const squared = squaredDistanceToInk(
      (() => {
        // Rebuild the ink from the labels: a cell with no region is ink.
        const ink = new Uint8Array(grid.width * grid.height);
        for (let i = 0; i < ink.length; i += 1) ink[i] = grid.label[i] === -1 ? 1 : 0;
        return ink;
      })(),
      grid.width,
      grid.height,
    );
    const enclosed = grid.regions.filter((r) => !r.open);
    const widths = enclosed.map((r) => widestPointOf(squared, grid.label, r.id, r, grid.width) * grid.feetPerCell);
    const widest = Math.max(...widths);
    const narrowest = Math.min(...widths);
    // The room is nearly 14ft across; the thinnest wall cavity is inches.
    expect(widest).toBeGreaterThan(10);
    expect(narrowest).toBeLessThan(1);
  });

  it("notices a room even when it is joined to a thin cavity network", () => {
    // The failure the first classifier had: a branching shape whose arms drag
    // an average down. The MAXIMUM notices the wide part, which is the point.
    const label = new Int32Array(100).fill(0);
    const ink = new Uint8Array(100);
    // A 10x10 grid, all one region, with no ink at all — the widest point is
    // bounded by the grid rather than by a wall, and must still be large.
    const squared = squaredDistanceToInk(ink, 10, 10);
    const widest = widestPointOf(squared, label, 0, { minX: 0, minY: 0, maxX: 9, maxY: 9 }, 10);
    expect(widest).toBeGreaterThan(100);
  });

  it("returns zero for a region with no cells in the bounds", () => {
    const squared = squaredDistanceToInk(new Uint8Array(100), 10, 10);
    const label = new Int32Array(100).fill(0);
    expect(widestPointOf(squared, label, 99, { minX: 0, minY: 0, maxX: 9, maxY: 9 }, 10)).toBe(0);
  });
});
