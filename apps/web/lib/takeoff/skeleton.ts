/**
 * ── FROM A WALL SHAPE TO A WALL RUN ──
 *
 * `rooms.ts` finds the enclosed regions and `distance.ts` says how thick each
 * one is where it sits. Together they answer "which of these shapes is a wall",
 * and drawn over a real sheet they answer it correctly — the interior partitions
 * come out traced, the hatch and the sheet border do not.
 *
 * What they cannot produce is a MEASUREMENT. The product's whole downstream
 * chain — `TakeoffMeasurement`, wall type, height, a costed `WallRun` — takes a
 * CENTRELINE and a LENGTH. A region is neither: it is a blob of cells, and a
 * wall cavity that meets three other walls is one blob containing four runs.
 *
 * So this file does the last step, in three passes:
 *
 *   thin      the blob to a line one cell wide, down its middle
 *   trace     that line into paths, cut at every junction and endpoint
 *   straighten each path back to the few points a wall actually has
 *
 * ── WHY THINNING RATHER THAN A FITTED LINE ──
 *
 * Fitting a line to a region assumes the region is one straight thing, which is
 * exactly what a cavity network is not — and assuming it is, is the mistake this
 * feature has now made twice. Thinning makes no such assumption: it erodes the
 * shape symmetrically until nothing is left but its medial line, so an L, a T
 * and a cross all survive as what they are, and the junctions become visible
 * instead of being averaged away.
 */

/** A traced centreline, in grid cells. */
export type Path = { xs: number[]; ys: number[] };

/**
 * Zhang-Suen thinning: erode to a one-cell-wide medial line.
 *
 * Two sub-passes per round, deleting only cells whose removal cannot break the
 * shape apart or shorten a limb. The test for that is `A === 1` — a cell with
 * exactly one run of neighbours around it is on an edge, and a cell with two is
 * a bridge whose removal would sever the shape.
 *
 * `mask` is not modified; the result is a new array.
 */
export function thin(mask: Uint8Array, width: number, height: number): Uint8Array {
  const cells = Uint8Array.from(mask);
  // Neighbours clockwise from north, which is the order A and B are defined in.
  const around = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ] as const;
  const doomed: number[] = [];

  const sweep = (second: boolean): boolean => {
    doomed.length = 0;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const at = y * width + x;
        if (cells[at] === 0) continue;
        let filled = 0;
        let runs = 0;
        let previous = cells[(y + around[7][1]) * width + x + around[7][0]];
        for (let i = 0; i < 8; i += 1) {
          const n = cells[(y + around[i][1]) * width + x + around[i][0]];
          filled += n;
          if (previous === 0 && n === 1) runs += 1;
          previous = n;
        }
        // On an edge (one run of neighbours) and not a lone cell or an interior
        // one. A cell with two runs is a bridge: deleting it severs the shape.
        if (filled < 2 || filled > 6 || runs !== 1) continue;
        const north = cells[(y - 1) * width + x];
        const east = cells[y * width + x + 1];
        const south = cells[(y + 1) * width + x];
        const west = cells[y * width + x - 1];
        // The two sub-passes attack opposite corners, which is what keeps the
        // result centred rather than drifting to one side.
        if (!second && (north * east * south !== 0 || east * south * west !== 0)) continue;
        if (second && (north * east * west !== 0 || north * south * west !== 0)) continue;
        doomed.push(at);
      }
    }
    for (const at of doomed) cells[at] = 0;
    return doomed.length > 0;
  };

  // Bounded: thinning always terminates, but a bug here must not hang a browser
  // tab. One round removes at least one cell, so the cell count is the ceiling.
  let rounds = 0;
  const ceiling = width * height;
  for (;;) {
    const first = sweep(false);
    const second = sweep(true);
    rounds += 1;
    if ((!first && !second) || rounds > ceiling) break;
  }
  return cells;
}

/**
 * How many separate limbs leave this cell.
 *
 * NOT the neighbour count, which is the obvious choice and is wrong. Counting
 * neighbours makes the cells BESIDE a junction look like junctions too: on a T,
 * the cell left of the centre touches its two neighbours along the bar AND,
 * diagonally, the first cell down the stem — three neighbours, no junction. Each
 * path then gets cut at both ends of a three-cell "junction" and comes back
 * twice. A plain corner has the same problem, so a closed loop shattered into
 * fragments instead of coming back whole.
 *
 * The number that is actually wanted is how many RUNS of neighbours there are
 * around the ring, which is the same test thinning uses to decide whether a cell
 * is a bridge. Two runs is a cell with a limb either side: a path. One is an
 * end. Three or more is a real junction.
 */
function limbsAt(skeleton: Uint8Array, width: number, height: number, x: number, y: number): number {
  // Clockwise from north, so that consecutive entries are genuinely adjacent.
  const ring = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ] as const;
  const read = (i: number) => {
    const nx = x + ring[i][0];
    const ny = y + ring[i][1];
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return 0;
    return skeleton[ny * width + nx];
  };
  let runs = 0;
  let previous = read(7);
  for (let i = 0; i < 8; i += 1) {
    const here = read(i);
    if (previous === 0 && here === 1) runs += 1;
    previous = here;
  }
  return runs;
}

/**
 * Cut a skeleton into paths at its junctions and endpoints.
 *
 * A cell with one neighbour ends a path, three or more starts several. Cutting
 * there is the point of the exercise: a cavity where four walls meet is ONE
 * region, and the four runs in it are only separable once the junction is a
 * place rather than a blob.
 *
 * A closed loop with no junction at all — a corridor round a core — has every
 * cell at degree two and no natural start, so it is picked up afterwards from
 * whatever is left and returned closed.
 */
export function tracePaths(skeleton: Uint8Array, width: number, height: number): Path[] {
  const walked = new Uint8Array(skeleton.length);
  const paths: Path[] = [];
  // Exactly two limbs is a cell in the middle of a path. Anything else — an end,
  // or a real junction — is where a run gets cut.
  const isNode = (x: number, y: number) => limbsAt(skeleton, width, height, x, y) !== 2;

  const walkFrom = (sx: number, sy: number) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        let x = sx + dx;
        let y = sy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (skeleton[y * width + x] !== 1) continue;
        if (walked[y * width + x] === 1) continue;
        const xs = [sx];
        const ys = [sy];
        let px = sx;
        let py = sy;
        for (;;) {
          walked[y * width + x] = 1;
          xs.push(x);
          ys.push(y);
          if (isNode(x, y)) break;
          // Step on to the one neighbour that is not where we came from —
          // ORTHOGONALLY FIRST, and that ordering is load-bearing rather than
          // tidy. On a cross, the cell above the centre touches the left arm
          // diagonally as well as the junction directly below it. Taking
          // whichever came first in scan order walked the diagonal, skipped
          // straight past the crossing, and returned the vertical and the left
          // arm as ONE run through the middle of the building. A skeleton step
          // is orthogonal wherever an orthogonal step exists; a diagonal is
          // what a staircase needs, not what a junction offers.
          let nx = -1;
          let ny = -1;
          const steps = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ] as const;
          for (const [ex, ey] of steps) {
            const tx = x + ex;
            const ty = y + ey;
            if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
            if (skeleton[ty * width + tx] !== 1) continue;
            if (tx === px && ty === py) continue;
            if (walked[ty * width + tx] === 1 && !isNode(tx, ty)) continue;
            nx = tx;
            ny = ty;
            break;
          }
          if (nx < 0) break;
          px = x;
          py = y;
          x = nx;
          y = ny;
        }
        if (xs.length > 1) paths.push({ xs, ys });
      }
    }
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (skeleton[y * width + x] !== 1) continue;
      if (!isNode(x, y)) continue;
      walked[y * width + x] = 1;
      walkFrom(x, y);
    }
  }
  // Whatever is left is a closed loop: no endpoint and no junction to start at.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (skeleton[at] !== 1 || walked[at] === 1) continue;
      walked[at] = 1;
      walkFrom(x, y);
    }
  }
  return paths;
}

/**
 * Ramer-Douglas-Peucker: drop the points that are not corners.
 *
 * A traced path has one point per cell, so a 40ft wall arrives as 400 of them.
 * A wall has two. `tolerance` is in cells and is what decides whether a jog is a
 * corner or the rasteriser's staircase on a slightly-off-axis line.
 */
export function straighten(path: Path, tolerance: number): Path {
  const n = path.xs.length;
  if (n < 3) return { xs: [...path.xs], ys: [...path.ys] };
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  // Iterative rather than recursive: a path can be thousands of cells long and
  // recursion depth would be a function of the drawing.
  const pending: [number, number][] = [[0, n - 1]];
  while (pending.length > 0) {
    const [first, last] = pending.pop()!;
    if (last <= first + 1) continue;
    const ax = path.xs[first];
    const ay = path.ys[first];
    const bx = path.xs[last];
    const by = path.ys[last];
    const dx = bx - ax;
    const dy = by - ay;
    const span = Math.hypot(dx, dy);
    let worst = -1;
    let worstAt = -1;
    for (let i = first + 1; i < last; i += 1) {
      const px = path.xs[i];
      const py = path.ys[i];
      // Distance from the point to the chord; for a zero-length chord that is
      // just the distance to the shared endpoint.
      const off =
        span === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs(dy * px - dx * py + bx * ay - by * ax) / span;
      if (off > worst) {
        worst = off;
        worstAt = i;
      }
    }
    if (worst > tolerance && worstAt > 0) {
      keep[worstAt] = 1;
      pending.push([first, worstAt], [worstAt, last]);
    }
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (keep[i] === 1) {
      xs.push(path.xs[i]);
      ys.push(path.ys[i]);
    }
  }
  return { xs, ys };
}

/** A path's length, in whatever units its points are in. */
export function pathLength(path: Path): number {
  let total = 0;
  for (let i = 1; i < path.xs.length; i += 1) {
    total += Math.hypot(path.xs[i] - path.xs[i - 1], path.ys[i] - path.ys[i - 1]);
  }
  return total;
}
