import { describe, expect, it } from "vitest";
import { thin, tracePaths, straighten, pathLength, type Path } from "./skeleton";

/**
 * THE LAST STEP BEFORE A WALL IS A MEASUREMENT.
 *
 * The product's whole downstream chain takes a CENTRELINE and a LENGTH. A region
 * is neither — and a cavity where four walls meet is one region containing four
 * runs, which is the case these tests exist for. Every earlier attempt at this
 * feature assumed a wall shape was one straight thing; that assumption is what
 * produced "7 inches thick" for half a building.
 */

function block(width: number, height: number, fill: (x: number, y: number) => boolean): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) if (fill(x, y)) mask[y * width + x] = 1;
  }
  return mask;
}

const lit = (mask: Uint8Array) => mask.reduce((t, v) => t + v, 0);

describe("thinning a shape to its centreline", () => {
  it("reduces a thick bar to a line ONE cell wide", () => {
    // 21 long, 7 thick, well clear of the border.
    const mask = block(25, 11, (x, y) => x >= 2 && x <= 22 && y >= 2 && y <= 8);
    const skeleton = thin(mask, 25, 11);
    // One row should carry it; count the lit cells per column.
    for (let x = 6; x <= 18; x += 1) {
      let inColumn = 0;
      for (let y = 0; y < 11; y += 1) inColumn += skeleton[y * 25 + x];
      expect(inColumn, `column ${x}`).toBe(1);
    }
  });

  it("puts the line down the MIDDLE, not along an edge", () => {
    // The two sub-passes attack opposite corners for exactly this reason. A
    // centreline on the edge of a wall would place every measurement half a
    // wall thickness out.
    const mask = block(25, 11, (x, y) => x >= 2 && x <= 22 && y >= 2 && y <= 8);
    const skeleton = thin(mask, 25, 11);
    for (let y = 0; y < 11; y += 1) {
      if (skeleton[y * 25 + 12] === 1) expect(y).toBe(5); // the middle row of 2..8
    }
  });

  it("KEEPS THE SHAPE IN ONE PIECE — it never erodes through", () => {
    const mask = block(25, 11, (x, y) => x >= 2 && x <= 22 && y >= 2 && y <= 8);
    const skeleton = thin(mask, 25, 11);
    expect(lit(skeleton)).toBeGreaterThan(10);
  });

  it("keeps a corner a corner rather than averaging it away", () => {
    // An L. Fitting a line to this would produce a diagonal through the middle
    // of a room, which is the failure mode thinning exists to avoid.
    const mask = block(25, 25, (x, y) => (y >= 2 && y <= 6 && x >= 2 && x <= 20) || (x >= 2 && x <= 6 && y >= 2 && y <= 20));
    const skeleton = thin(mask, 25, 25);
    let farRight = 0;
    let farDown = 0;
    for (let y = 0; y < 25; y += 1) for (let x = 0; x < 25; x += 1) {
      if (skeleton[y * 25 + x] !== 1) continue;
      if (x > 15) farRight += 1;
      if (y > 15) farDown += 1;
    }
    expect(farRight).toBeGreaterThan(0);
    expect(farDown).toBeGreaterThan(0);
  });

  it("does not modify the mask it was given", () => {
    const mask = block(25, 11, (x, y) => x >= 2 && x <= 22 && y >= 2 && y <= 8);
    const before = lit(mask);
    thin(mask, 25, 11);
    expect(lit(mask)).toBe(before);
  });

  it("returns an empty skeleton for an empty mask", () => {
    expect(lit(thin(new Uint8Array(100), 10, 10))).toBe(0);
  });
});

describe("cutting a skeleton into paths", () => {
  it("returns ONE path for a plain line", () => {
    const mask = block(20, 5, (x, y) => y === 2 && x >= 2 && x <= 17);
    const paths = tracePaths(mask, 20, 5);
    expect(paths).toHaveLength(1);
    expect(paths[0].xs.length).toBe(16);
  });

  it("CUTS A T INTO THREE, which is why a junction must be a place", () => {
    // A cavity where three walls meet is one region. Three runs only become
    // separable once the junction is cut.
    const mask = block(21, 21, (x, y) => (y === 10 && x >= 2 && x <= 18) || (x === 10 && y >= 10 && y <= 18));
    const paths = tracePaths(mask, 21, 21);
    expect(paths).toHaveLength(3);
  });

  it("cuts a cross into four", () => {
    const mask = block(21, 21, (x, y) => (y === 10 && x >= 2 && x <= 18) || (x === 10 && y >= 2 && y <= 18));
    expect(tracePaths(mask, 21, 21)).toHaveLength(4);
  });

  it("picks up a CLOSED LOOP, which has no endpoint to start from", () => {
    // A corridor round a core: every cell is degree two, so the endpoint-and-
    // junction pass finds nothing at all and a second pass is needed.
    const mask = block(15, 15, (x, y) => {
      const edge = x === 3 || x === 11 || y === 3 || y === 11;
      return edge && x >= 3 && x <= 11 && y >= 3 && y <= 11;
    });
    const paths = tracePaths(mask, 15, 15);
    expect(paths.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...paths.map((p) => p.xs.length))).toBeGreaterThan(20);
  });

  it("returns nothing for an empty skeleton", () => {
    expect(tracePaths(new Uint8Array(100), 10, 10)).toEqual([]);
  });
});

describe("straightening a traced path", () => {
  const along = (n: number): Path => ({
    xs: Array.from({ length: n }, (_, i) => i),
    ys: Array.from({ length: n }, () => 5),
  });

  it("collapses a straight run of 400 points to TWO", () => {
    const out = straighten(along(400), 1);
    expect(out.xs).toHaveLength(2);
    expect(out.xs[0]).toBe(0);
    expect(out.xs[1]).toBe(399);
  });

  it("KEEPS a real corner", () => {
    const path: Path = { xs: [0, 10, 20, 20, 20], ys: [0, 0, 0, 10, 20] };
    const out = straighten(path, 1);
    expect(out.xs).toHaveLength(3);
    expect(out.xs[1]).toBe(20);
    expect(out.ys[1]).toBe(0);
  });

  it("drops the rasteriser's staircase on a near-axis line", () => {
    // A wall drawn a quarter-degree off horizontal arrives as a staircase. Each
    // step is a corner to anything measuring exactly, and none of them is real.
    const xs = Array.from({ length: 60 }, (_, i) => i);
    const ys = xs.map((x) => Math.round(x / 40));
    const out = straighten({ xs, ys }, 2);
    expect(out.xs.length).toBeLessThanOrEqual(3);
  });

  it("leaves a two-point path alone", () => {
    const out = straighten({ xs: [0, 9], ys: [0, 0] }, 1);
    expect(out.xs).toEqual([0, 9]);
  });

  it("measures a straightened path at the same length as the original", () => {
    // The point of straightening is fewer points, not a shorter wall.
    const path = along(100);
    expect(pathLength(straighten(path, 1))).toBeCloseTo(pathLength(path), 6);
  });

  it("measures a diagonal by its true length, not its step count", () => {
    const out = pathLength({ xs: [0, 3], ys: [0, 4] });
    expect(out).toBe(5);
  });
});
