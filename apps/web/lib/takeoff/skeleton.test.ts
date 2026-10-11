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

describe("thinning costs what the ink costs, not what the grid costs", () => {
  /**
   * A sheet took 2,582 ms to thin 27,000 cells of wall, while another with FOUR
   * TIMES the ink on a grid half the size took 571. Cost tracked the GRID, not
   * the work: every round swept all twelve million cells looking for ink, and
   * thinning takes one round per cell of half-thickness. The page that ran 28
   * minutes of CPU is the same shape with a bigger grid behind it.
   *
   * ── WHAT THIS CAN AND CANNOT CATCH ──
   *
   * Asserted as a RATIO between two grids holding identical ink, never as a
   * wall-clock budget: an absolute bound fails on a loaded machine and passes
   * on a fast one, which is a flake rather than a guard, and this repo already
   * has one spec that answered differently twice in an hour.
   *
   * The grid has to be big enough for the ratio to exist. A first version used
   * 400x176 and every mutation came back GREEN — at that size a full sweep is
   * microseconds and there is nothing to measure. Two million cells is where
   * the difference stops being noise.
   *
   * It does NOT catch a regression that keeps sweeping only the original ink
   * without dropping what it has cleared. That is real and it is invisible
   * here, because on a thin shape almost nothing is cleared — and saying so is
   * better than implying a guard covers it.
   */
  const BAR = (x: number, y: number) => x >= 2 && x <= 22 && y >= 2 && y <= 8;

  /**
   * ── THE TIMING GUARD IS GONE, AFTER FLAKING TWICE. READ THIS BEFORE WRITING
   * A THIRD ONE. ──
   *
   * #688 made `thin` sweep only LIVE CELLS instead of the whole grid each
   * round, which is a 51x speedup on a real sheet and the difference between
   * the wall finder answering and appearing to hang. Two attempts were made to
   * guard that property and both were FLAKES:
   *
   *   1. a ratio against a tiny grid's run. It passed alone and failed under
   *      `preflight.sh`, which runs the build beside the tests: the baseline is
   *      microseconds, so its own noise moved the denominator.
   *   2. a ratio against one measured pass over an array of the same size,
   *      taken in the same process so load would move both sides together.
   *      **It failed under preflight too** — a GC pause inside the measured
   *      region is enough, and nothing about the arithmetic can see that.
   *
   * A guard that fails when the machine is busy is noise, and noise gets a
   * suite ignored. So the property is NOT tested, and that is recorded rather
   * than papered over:
   *
   *   - what IS tested, immediately below and throughout this file, is that the
   *     same ink thins to the same skeleton. The correctness of the change is
   *     covered; only its SPEED is not.
   *   - the speed is the kind of regression somebody notices in one click,
   *     because the button visibly stops answering. That is a poor check and it
   *     is the honest one.
   *   - the measurement, for anyone re-deriving it by hand: on a 2000x1000 grid
   *     holding 147 cells of ink, the live-cell version costs a fraction of one
   *     pass over the grid and a grid-swept one costs about eight.
   *
   * A third attempt needs a signal that is not a clock. Counting the cells
   * EXAMINED would be one, and it means `thin` reporting its own work — an API
   * change for a test, which is a trade worth making deliberately rather than
   * reaching for another stopwatch.
   */
  it("thins the same ink to the same skeleton whatever the grid around it", () => {
    // What survives of the timing test: the two runs must agree. This is what
    // actually broke when the sweep changed, and it needs no clock.
    const WIDE = 2000;
    const TALL = 1000;
    const vast = thin(block(WIDE, TALL, BAR), WIDE, TALL);
    const snug = thin(block(25, 11, BAR), 25, 11);
    let litVast = 0;
    let litSnug = 0;
    for (let i = 0; i < vast.length; i += 1) litVast += vast[i];
    for (let i = 0; i < snug.length; i += 1) litSnug += snug[i];
    expect(litVast, "empty space around the ink must not change the skeleton").toBe(litSnug);
  });

  it("leaves ink on the border alone, exactly as the grid-swept version did", () => {
    // The candidate list excludes the border, which is what the old
    // `y = 1 .. height - 2` loop bounds did implicitly. This pins the
    // behaviour rather than the mechanism.
    //
    // HONEST NOTE: mutating that exclusion away leaves this test GREEN, and it
    // is kept anyway. A border cell that becomes a candidate reads its
    // neighbour ring off the end of the array, and a typed array answers
    // `undefined` rather than throwing — the arithmetic goes NaN, every
    // deletion test fails, and the cell survives. Same output, by accident.
    // The exclusion exists so the reads stay in bounds instead of depending on
    // that, which is a reason to keep it and not a claim that it is tested.
    const touching = block(40, 20, (x, y) => y <= 4 && x <= 30);
    expect(() => thin(touching, 40, 20)).not.toThrow();
    const skeleton = thin(touching, 40, 20);
    let farSide = 0;
    for (let y = 12; y < 20; y += 1) for (let x = 0; x < 40; x += 1) farSide += skeleton[y * 40 + x];
    expect(farSide, "thinning must not move ink to the far side of the grid").toBe(0);
  });

  it("still terminates on a mask that is entirely ink", () => {
    // The ceiling is the live-cell count now rather than the grid, so a fully
    // inked mask is the case that proves it is still a ceiling.
    const solid = block(60, 60, () => true);
    expect(() => thin(solid, 60, 60)).not.toThrow();
    expect(lit(thin(solid, 60, 60))).toBeGreaterThan(0);
  });
});
