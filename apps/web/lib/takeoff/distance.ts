/**
 * ── HOW THICK IS THIS SPACE, HERE? ──
 *
 * `rooms.ts` finds every enclosed region, which is the completeness this feature
 * needs: every wall bounds a room, so enumerating the rooms cannot miss a wall.
 * What it could not do is say which regions are WALLS, and the first attempt at
 * that was wrong in a way worth recording, because the numbers looked excellent.
 *
 * It measured a region's thickness as its area over its longest side. On a
 * fixture that is the thickness. On a real plan it is nonsense, because WALL
 * CAVITIES CONNECT: at every corner and T-junction one wall's cavity joins the
 * next, so a building's interior walls are not three hundred separate thin
 * regions but a handful of giant branching networks. Area over longest side
 * reported "7 inches thick" for a shape spanning half the building, and the
 * result — 247 walls, 3,035ft, five times the line pairer — collapsed the moment
 * it was drawn: the whole sheet came out red.
 *
 * Thickness is a LOCAL property and has to be measured locally. The distance
 * from a point to the nearest ink is half the width of the space it sits in, so
 * this transform is the measurement the classifier was missing.
 *
 * ── EXACT, NOT A CHAMFER ──
 *
 * The usual two-pass chamfer approximates Euclidean distance within a few per
 * cent, which is fine for a picture and not fine here: this number becomes a
 * wall thickness, which picks a wall type, which prices a bid. Felzenszwalb and
 * Huttenlocher's transform is exact, separable and linear in the number of
 * cells — the same cost as the approximation, with no error to carry forward.
 *
 * It works on SQUARED distances throughout. The square root is taken once, at
 * the end, by whoever needs a length — comparing squared distances is exact in
 * floating point where comparing roots is not.
 */

/** Large enough to stand for "no ink in this row or column", small enough that
 *  adding it to a squared coordinate cannot lose precision. */
const FAR = 1e12;

/**
 * The lower envelope of the parabolas rooted at each cell of one line.
 *
 * This is the whole algorithm: the squared distance from a point to the nearest
 * marked cell along a line is the lower envelope of parabolas `(x - i)² + f(i)`,
 * and that envelope is computable in one forward pass because the parabolas all
 * have the same shape and so cross at most once.
 */
function lowerEnvelope(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q += 1) {
    // Where the parabola at q crosses the one currently on top.
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      // It crossed before the top parabola's own start, so that one is hidden.
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Squared distance from every cell to the nearest ink cell, in cells².
 *
 * Squared on purpose — see the header. `Math.sqrt` of an entry is the distance;
 * TWICE that is the width of the space the cell sits in, which is the number a
 * wall is classified on.
 */
export function squaredDistanceToInk(ink: Uint8Array, width: number, height: number): Float64Array {
  const dist = new Float64Array(width * height);
  // Columns first.
  const col = new Float64Array(height);
  const colOut = new Float64Array(height);
  const v = new Int32Array(Math.max(width, height));
  const z = new Float64Array(Math.max(width, height) + 1);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) col[y] = ink[y * width + x] === 1 ? 0 : FAR;
    lowerEnvelope(col, height, colOut, v, z);
    for (let y = 0; y < height; y += 1) dist[y * width + x] = colOut[y];
  }
  // Then rows, over the column result — which is what makes it separable and
  // exact rather than an approximation of the diagonal.
  const row = new Float64Array(width);
  const rowOut = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    const base = y * width;
    for (let x = 0; x < width; x += 1) row[x] = dist[base + x];
    lowerEnvelope(row, width, rowOut, v, z);
    for (let x = 0; x < width; x += 1) dist[base + x] = rowOut[x];
  }
  return dist;
}

/**
 * The widest the space is at a region's widest point, in cells.
 *
 * A wall cavity is narrow EVERYWHERE along it; a room is wide somewhere. So the
 * maximum of the distance transform over a region is what separates them, and
 * it is a local measurement rather than an average over a shape whose outline
 * may wander through half the building.
 *
 * Taking the maximum rather than the mean is deliberate: a branching cavity
 * network's mean is dragged down by its long thin arms, so a network that
 * includes one room would still read as thin. The maximum notices the room.
 */
export function widestPointOf(
  squared: Float64Array,
  label: Int32Array,
  regionId: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
): number {
  let best = 0;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    const base = y * width;
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (label[base + x] !== regionId) continue;
      const d = squared[base + x];
      if (d > best) best = d;
    }
  }
  // Twice the radius is the width of the space.
  return 2 * Math.sqrt(best);
}
