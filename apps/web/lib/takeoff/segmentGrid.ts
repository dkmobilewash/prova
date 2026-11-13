import type { StrokeSegment } from "./wallVectors";

/**
 * ── WHICH SEGMENTS COULD BE NEAR THIS BOX, WITHOUT READING THE SHEET ──
 *
 * The wall features asked "which strokes are beside this candidate" by scanning every stroke on the
 * sheet, once per candidate. On a drawing that is fine; on Broadway A1.0, whose notes and title
 * block are drawn as outlined lettering (552,997 strokes, 45,874 candidates), `faceIsDashed` alone
 * was 123 s of a frozen tab (2026-11-13).
 *
 * This answers the same question from a grid built once per array. It returns a SUPERSET, in the
 * array's own order: every segment whose box meets the query box, plus every segment too long to
 * file (`wide`). The caller then applies its own test exactly as before, so the answer is the one
 * the scan gave, and so is the order of anything order-sensitive downstream.
 */
export type SegmentGrid = {
  near: (minX: number, minY: number, maxX: number, maxY: number) => readonly number[];
  /** The longest segment that was filed in cells; anything longer is always returned. */
  longestFiled: number;
  /** Segments of zero length, which a "beside this line" test can pass from anywhere along it. */
  zeroLength: readonly number[];
};

const CELLS_ACROSS = 256;
/** A segment whose box spans more cells than this on either axis is not filed, only listed. */
const WIDE_CELLS = 16;

const grids = new WeakMap<readonly StrokeSegment[], { length: number; grid: SegmentGrid }>();

export function segmentGrid(segments: readonly StrokeSegment[]): SegmentGrid {
  const cached = grids.get(segments);
  if (cached !== undefined && cached.length === segments.length) return cached.grid;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segments) {
    x0 = Math.min(x0, s.x1, s.x2); x1 = Math.max(x1, s.x1, s.x2);
    y0 = Math.min(y0, s.y1, s.y2); y1 = Math.max(y1, s.y1, s.y2);
  }
  const cell = Math.max(x1 - x0, y1 - y0, 1e-9) / CELLS_ACROSS;
  const cols = CELLS_ACROSS + 1;
  const col = (x: number) => Math.floor((x - x0) / cell);
  const row = (y: number) => Math.floor((y - y0) / cell);
  const cells = new Map<number, number[]>();
  // Segments that cannot be filed (too long, or a coordinate that is not a number) are returned by
  // every query, so a non-finite value fails the caller's own test exactly as it did in the scan.
  const wide: number[] = [];
  let longestFiled = 0;
  const zeroLength: number[] = [];
  segments.forEach((s, i) => {
    if (s.x1 === s.x2 && s.y1 === s.y2) zeroLength.push(i);
    const c0 = col(Math.min(s.x1, s.x2)), c1 = col(Math.max(s.x1, s.x2));
    const r0 = row(Math.min(s.y1, s.y2)), r1 = row(Math.max(s.y1, s.y2));
    if (!(c1 - c0 <= WIDE_CELLS && r1 - r0 <= WIDE_CELLS)) {
      wide.push(i);
      return;
    }
    longestFiled = Math.max(longestFiled, Math.hypot(s.x2 - s.x1, s.y2 - s.y1));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const k = r * cols + c;
        const bucket = cells.get(k);
        if (bucket === undefined) cells.set(k, [i]);
        else bucket.push(i);
      }
    }
  });

  // Which query last returned each segment, so one filed in several cells is returned once.
  const stamp = new Uint32Array(segments.length);
  let query = 0;
  const everything = () => segments.map((_, i) => i);
  const near = (minX: number, minY: number, maxX: number, maxY: number): readonly number[] => {
    // A query that is not a number, or covers more cells than are filled, gets everything: the scan.
    if (!(maxX >= minX && maxY >= minY)) return everything();
    const c0 = Math.max(0, col(minX)), c1 = Math.min(CELLS_ACROSS, col(maxX));
    const r0 = Math.max(0, row(minY)), r1 = Math.min(CELLS_ACROSS, row(maxY));
    if (c1 < c0 || r1 < r0) return wide;
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > cells.size) return everything();
    // One cell and nothing wide: its bucket is already in the array's order.
    if (c0 === c1 && r0 === r1 && wide.length === 0) return cells.get(r0 * cols + c0) ?? [];
    query += 1;
    const out: number[] = [];
    for (const i of wide) { stamp[i] = query; out.push(i); }
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        for (const i of cells.get(r * cols + c) ?? []) {
          if (stamp[i] === query) continue;
          stamp[i] = query;
          out.push(i);
        }
      }
    }
    return out.sort((a, b) => a - b);
  };
  const grid = { near, longestFiled, zeroLength };
  grids.set(segments, { length: segments.length, grid });
  return grid;
}

/** Segment indices sorted by length, for "every segment of about this length". */
const byLengthCache = new WeakMap<readonly StrokeSegment[], { length: number; lengths: number[]; order: number[] }>();

export function segmentsOfLength(segments: readonly StrokeSegment[], lo: number, hi: number): number[] {
  let cached = byLengthCache.get(segments);
  if (cached === undefined || cached.length !== segments.length) {
    const all = segments.map((s, i) => ({ i, l: Math.hypot(s.x2 - s.x1, s.y2 - s.y1) }));
    // NaN sorts last.
    all.sort((a, b) => (Number.isNaN(a.l) ? 1 : Number.isNaN(b.l) ? -1 : a.l - b.l));
    cached = { length: segments.length, lengths: all.map((a) => a.l), order: all.map((a) => a.i) };
    byLengthCache.set(segments, cached);
  }
  const { lengths, order } = cached;
  let at = 0, hiAt = lengths.length;
  while (at < hiAt) {
    const mid = (at + hiAt) >> 1;
    if (lengths[mid] < lo) at = mid + 1;
    else hiAt = mid;
  }
  const out: number[] = [];
  for (; at < lengths.length && lengths[at] <= hi; at += 1) out.push(order[at]);
  // A length that is not a number passes `Math.abs(lo - la) > tol` (every comparison with NaN is
  // false), so the scan counted it; it is returned here for the same reason.
  for (let k = lengths.length - 1; k >= 0 && Number.isNaN(lengths[k]); k -= 1) out.push(order[k]);
  return out.sort((a, b) => a - b);
}
