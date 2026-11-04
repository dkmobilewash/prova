import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── A WALL DRAWN AS ONE SOLID SHAPE ──
 *
 * Washington Village A.100 (held out, Chrome 2026-11-03) offered NOTHING: its
 * walls are solid filled shapes. `sheetStrokes` already emits a filled path's
 * edges with the fill's luminance, and on most sets those edges pair as faces —
 * surveyed 2026-11-03 over the 40 labelled training sheets, the pairer already
 * covers 2,046 of Topeka's 2,220 ft of filled band and 613 of Baker A100's 647.
 * What it leaves is a band whose edges never become a pair, so this reads the
 * FILL itself: two edges of one dark filled area, 3–16 in apart, with the fill
 * between them and not beyond them, are a wall, measured down its middle.
 *
 * ── WHAT IS NOT A BAND ──
 *
 *   a column      shorter than four times its thickness, or under 2 ft
 *   a hatch field strips thinner than 3 in, or areas wider than 16 in
 *   a room's fill two edges with fill BEYOND a face — a floor tint, the grey
 *                 body of a copier — are an area, not a band (Camp Bow Wow
 *                 A120 crossed a restroom, MHK A1.01 a plotter, before this)
 *
 * Existing work is not decided here: the bands join the finder's runs before
 * `offeredCandidates`, so a fill the legend marks existing is set aside by
 * `existingWalls.ts` exactly as an outlined one is.
 */
export type Pt = { x: number; y: number };
/** One filled path: every subpath of it, filled even-odd, so a room drawn as a hole is not fill. */
export type FilledArea = { rings: Pt[][]; fill: number; box: { x0: number; y0: number; x1: number; y1: number } };
export type FilledBand = { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number; lengthFeet: number; fill: number };

/**
 * The filled areas, rejoined from their edges. `sheetStrokes` emits a path's
 * edges in order, so a ring is a run of edges each starting where the last
 * ended, and consecutive rings of one fill are one area. Two touching paths of
 * one fill merge, which the even-odd test reads as their union.
 */
export function filledAreas(segs: readonly StrokeSegment[]): FilledArea[] {
  const out: FilledArea[] = [];
  let area: FilledArea | null = null;
  let ring: Pt[] | null = null;
  for (const s of segs) {
    if (s.fill === undefined) {
      area = null;
      ring = null;
      continue;
    }
    if (area === null || area.fill !== s.fill) {
      area = { rings: [], fill: s.fill, box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } };
      out.push(area);
      ring = null;
    }
    const last = ring?.[ring.length - 1];
    if (ring !== null && last !== undefined && Math.abs(last.x - s.x1) < 1e-6 && Math.abs(last.y - s.y1) < 1e-6) {
      ring.push({ x: s.x2, y: s.y2 });
    } else {
      ring = [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
      area.rings.push(ring);
    }
    area.box = {
      x0: Math.min(area.box.x0, s.x1, s.x2),
      y0: Math.min(area.box.y0, s.y1, s.y2),
      x1: Math.max(area.box.x1, s.x1, s.x2),
      y1: Math.max(area.box.y1, s.y1, s.y2),
    };
  }
  return out;
}

/** Even-odd, over every ring of the area. */
export function insideArea(p: Pt, rings: readonly (readonly Pt[])[]): boolean {
  let c = false;
  for (const poly of rings) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
  }
  return c;
}

export type BandRules = { minIn: number; maxIn: number; minFeet: number; maxFill: number; minAspect: number };
/** 3–16 in is the request's own band; 0.85 keeps light tints (a floor finish) out and grey poché in. */
export const BAND_RULES: BandRules = { minIn: 3, maxIn: 16, minFeet: 2, maxFill: 0.85, minAspect: 4 };

type Edge = { a: Pt; b: Pt; len: number; ux: number; uy: number; angle: number };

/**
 * Every band of every dark filled area, in the coordinates it was given
 * (page-width units, `feetPerUnit` to feet).
 *
 * Edges are bucketed by direction to the degree and sorted by offset, so a
 * pair is only tried between edges that could be one: a floor's worth of fill
 * is thousands of edges, and every-pair would be millions.
 */
export function filledBands(segs: readonly StrokeSegment[], feetPerUnit: number, rules: BandRules = BAND_RULES): FilledBand[] {
  const out: FilledBand[] = [];
  const maxD = rules.maxIn / 12 / feetPerUnit;
  const minD = rules.minIn / 12 / feetPerUnit;
  for (const area of filledAreas(segs)) {
    if (area.fill > rules.maxFill) continue;
    const buckets = new Map<number, Edge[]>();
    for (const ring of area.rings) {
      for (let i = 0; i + 1 < ring.length; i += 1) {
        const a = ring[i]!;
        const b = ring[i + 1]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len * feetPerUnit < rules.minFeet) continue;
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        const angle = (((Math.round((Math.atan2(uy, ux) * 180) / Math.PI) % 180) + 180) % 180);
        const list = buckets.get(angle) ?? [];
        list.push({ a, b, len, ux, uy, angle });
        buckets.set(angle, list);
      }
    }
    for (const [angle, list] of buckets) {
      // This bucket against itself and the next one round, so each pair is tried once.
      const pool = [...list, ...(buckets.get((angle + 1) % 180) ?? [])];
      const nx = -Math.sin((angle * Math.PI) / 180);
      const ny = Math.cos((angle * Math.PI) / 180);
      const offset = (e: Edge) => ((e.a.x + e.b.x) / 2) * nx + ((e.a.y + e.b.y) / 2) * ny;
      const sorted = pool.map((e) => ({ e, c: offset(e), own: e.angle === angle })).sort((p, q) => p.c - q.c);
      for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length && sorted[j]!.c - sorted[i]!.c <= maxD * 1.05; j += 1) {
          if (!sorted[i]!.own && !sorted[j]!.own) continue;
          const band = bandBetween(sorted[i]!.e, sorted[j]!.e, area.rings, feetPerUnit, minD, maxD, rules);
          if (band !== null) out.push({ ...band, fill: area.fill });
        }
      }
    }
  }
  return out;
}

function bandBetween(e: Edge, f: Edge, rings: readonly Pt[][], feetPerUnit: number, minD: number, maxD: number, rules: BandRules): Omit<FilledBand, "fill"> | null {
  if (Math.abs(e.ux * f.uy - e.uy * f.ux) > 0.035) return null; // ~2 degrees
  const mx = (f.a.x + f.b.x) / 2 - e.a.x;
  const my = (f.a.y + f.b.y) / 2 - e.a.y;
  const signed = mx * -e.uy + my * e.ux;
  const d = Math.abs(signed);
  if (d < minD || d > maxD) return null;
  const t = (p: Pt) => (p.x - e.a.x) * e.ux + (p.y - e.a.y) * e.uy;
  const lo = Math.max(0, Math.min(t(f.a), t(f.b)));
  const hi = Math.min(e.len, Math.max(t(f.a), t(f.b)));
  if ((hi - lo) * feetPerUnit < rules.minFeet || hi - lo < rules.minAspect * d) return null;
  const side = Math.sign(signed);
  // A point `along` the overlap, `across` from e towards f (in units of d).
  const at = (along: number, across: number) => ({
    x: e.a.x + e.ux * along - e.uy * side * d * across,
    y: e.a.y + e.uy * along + e.ux * side * d * across,
  });
  // Fill between the faces all the way along, and none just beyond them at
  // most stations: a wall another wall runs into has fill beyond one face at
  // the junction, which is why it is most and not all.
  let clear = 0;
  for (const k of [0.2, 0.5, 0.8]) {
    const along = lo + (hi - lo) * k;
    if (!insideArea(at(along, 0.5), rings)) return null;
    if (!insideArea(at(along, -0.25), rings) && !insideArea(at(along, 1.25), rings)) clear += 1;
  }
  if (clear < 2) return null;
  const p1 = at(lo, 0.5);
  const p2 = at(hi, 0.5);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, thicknessFeet: d * feetPerUnit, lengthFeet: (hi - lo) * feetPerUnit };
}

type Line = { x1: number; y1: number; x2: number; y2: number };
/** Units of `b` lying within `tol` of a parallel line in `by`, as a length in the same units. */
export function coveredLength(b: Line, by: readonly Line[], tol: number): number {
  const len = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
  if (len === 0) return 0;
  const ux = (b.x2 - b.x1) / len;
  const uy = (b.y2 - b.y1) / len;
  const spans: [number, number][] = [];
  for (const c of by) {
    const cl = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
    if (cl === 0 || Math.abs((ux * (c.y2 - c.y1) - uy * (c.x2 - c.x1)) / cl) > 0.09) continue;
    const mx = (c.x1 + c.x2) / 2 - b.x1;
    const my = (c.y1 + c.y2) / 2 - b.y1;
    if (Math.abs(mx * -uy + my * ux) > tol) continue;
    const t1 = (c.x1 - b.x1) * ux + (c.y1 - b.y1) * uy;
    const t2 = (c.x2 - b.x1) * ux + (c.y2 - b.y1) * uy;
    const lo = Math.max(0, Math.min(t1, t2));
    const hi = Math.min(len, Math.max(t1, t2));
    if (hi > lo) spans.push([lo, hi]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let total = 0;
  let start = 0;
  let end = -1;
  for (const [lo, hi] of spans) {
    if (lo > end) {
      if (end > start) total += end - start;
      start = lo;
      end = hi;
    } else end = Math.max(end, hi);
  }
  if (end > start) total += end - start;
  return total;
}

/**
 * The bands the pairer did not already find, as candidates: a band at least
 * half covered by a found wall is that wall, and a band at least half covered
 * by a longer band already kept is the same band drawn twice.
 */
export function filledWallCandidates(strokes: readonly StrokeSegment[], feetPerUnit: number, found: readonly Line[]): WallCandidate[] {
  const kept: FilledBand[] = [];
  const bands = filledBands(strokes, feetPerUnit).sort((a, b) => b.lengthFeet - a.lengthFeet);
  for (const b of bands) {
    const len = b.lengthFeet / feetPerUnit;
    const tol = b.thicknessFeet / feetPerUnit;
    if (coveredLength(b, found, tol) >= len / 2 || coveredLength(b, kept, tol) >= len / 2) continue;
    kept.push(b);
  }
  return kept.map(({ x1, y1, x2, y2, thicknessFeet, lengthFeet }) => ({ x1, y1, x2, y2, thicknessFeet, lengthFeet, fromFill: true }));
}
