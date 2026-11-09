import type { HeightFact } from "./wallHeights";

/**
 * ── A WALL'S HEIGHT BY THE PART OF THE BUILDING IT IS IN, FROM THE ROOF PLAN ──
 *
 * Joplin's sections print three levels — LOWER BOD 112'-0", ADMIN JBE 112'-4",
 * CENTRAL TOW 116'-8" — and its legend sends A, B and L "to structure", so a
 * wall's height depends on which roof is over it, and nothing on the floor plan
 * says. The ROOF plan does: a pitched metal roof is drawn as standing seams,
 * evenly spaced parallel lines; a flat membrane roof is drawn with none. A
 * pitched roof bears on the walls, at the sections' highest level; a flat roof
 * at the next one down.
 *
 * Measured on Joplin A-101 against Chrome's room-by-room key (2026-11-08): 61
 * of 67 rooms placed right; walls, the taller of the rooms either side, 84% of
 * key-wall footage against 52% for "every wall the tallest".
 *
 * Page-width units throughout, like the runs; `feetPerUnit` turns them to feet.
 */
export type Seg = { x1: number; y1: number; x2: number; y2: number };

/** Half the window looked at round a point, feet. */
export const SEAM_WINDOW_FEET = 4;
/** A seam is a line at least this long, feet: a grid dash or a gutter tick is not. */
export const SEAM_MIN_LINE_FEET = 8;
/** Evenly spaced lines this many or more make a pitched roof. */
export const SEAM_MIN_LINES = 4;
/** Seams sit this far apart, feet; a gap within this share of its neighbour's counts as even. */
export const SEAM_GAP_FEET: readonly [number, number] = [0.5, 3];
export const SEAM_GAP_SLACK = 0.2;

/** Roof strokes bucketed by area, so a point looks only at the strokes near it. */
export type RoofIndex = { segs: Seg[]; cell: number; buckets: Map<string, number[]>; feetPerUnit: number };

export function roofIndex(segs: readonly Seg[], feetPerUnit: number): RoofIndex {
  const cell = (SEAM_WINDOW_FEET * 2) / feetPerUnit;
  const buckets = new Map<string, number[]>();
  segs.forEach((s, i) => {
    if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * feetPerUnit < SEAM_MIN_LINE_FEET) return;
    const [ax, bx] = [Math.floor(Math.min(s.x1, s.x2) / cell), Math.floor(Math.max(s.x1, s.x2) / cell)];
    const [ay, by] = [Math.floor(Math.min(s.y1, s.y2) / cell), Math.floor(Math.max(s.y1, s.y2) / cell)];
    // ponytail: a long diagonal fills its whole box of buckets; roof plans are mostly orthogonal.
    for (let x = ax; x <= bx; x += 1) for (let y = ay; y <= by; y += 1) {
      const k = `${x},${y}`;
      const list = buckets.get(k);
      if (list) list.push(i);
      else buckets.set(k, [i]);
    }
  });
  return { segs: [...segs], cell, buckets, feetPerUnit };
}

/** The longest run of evenly spaced parallel lines through the window round (x, y). */
export function seamsAt(index: RoofIndex, x: number, y: number): number {
  const fpu = index.feetPerUnit;
  const hw = SEAM_WINDOW_FEET / fpu;
  const seen = new Set<number>();
  const bins = new Map<number, number[]>();
  const [cx, cy] = [Math.floor(x / index.cell), Math.floor(y / index.cell)];
  for (let bx = cx - 1; bx <= cx + 1; bx += 1) for (let by = cy - 1; by <= cy + 1; by += 1) {
    for (const i of index.buckets.get(`${bx},${by}`) ?? []) {
      if (seen.has(i)) continue;
      seen.add(i);
      const s = index.segs[i]!;
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
      const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / (len * len)));
      if (Math.hypot(x - s.x1 - t * dx, y - s.y1 - t * dy) > hw) continue;
      const angle = ((Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 5) * 5) % 180 + 180) % 180;
      // Offset across a fixed direction per angle bin, so two strokes of one line agree.
      const rad = (angle * Math.PI) / 180, nx = -Math.sin(rad), ny = Math.cos(rad);
      const list = bins.get(angle);
      const off = ((s.x1 - x) * nx + (s.y1 - y) * ny) * fpu;
      if (list) list.push(off);
      else bins.set(angle, [off]);
    }
  }
  let best = 0;
  for (const offs of bins.values()) {
    const lines: number[] = [];
    for (const o of [...offs].sort((a, b) => a - b)) if (lines.length === 0 || o - lines[lines.length - 1]! > 0.3) lines.push(o);
    const gaps = lines.slice(1).map((o, i) => o - lines[i]!);
    for (let i = 0; i < gaps.length; i += 1) {
      const g = gaps[i]!;
      if (g < SEAM_GAP_FEET[0] || g > SEAM_GAP_FEET[1]) continue;
      let n = 1;
      for (let j = i + 1; j < gaps.length && Math.abs(gaps[j]! - g) <= SEAM_GAP_SLACK * g; j += 1) n += 1;
      best = Math.max(best, n + 1);
    }
  }
  return best;
}

export const pitchedAt = (index: RoofIndex, x: number, y: number): boolean => seamsAt(index, x, y) >= SEAM_MIN_LINES;

/** The two heights a roof plan chooses between, with where each came from. */
export type RoofPartHeights = { pitched: { feet: number; from: string }; flat: { feet: number; from: string } };

/**
 * From the set's section levels (already relative to the floor): the highest is
 * where a pitched roof bears, the next one down where a flat roof does. Null
 * when the sections print fewer than two levels — nothing to choose between.
 */
export function roofPartHeights(facts: readonly HeightFact[]): RoofPartHeights | null {
  const levels = facts.filter((f) => (f.kind === "structure-elevation" || f.kind === "bearing-elevation") && f.feet !== null && !f.framing);
  const byFeet = new Map<number, HeightFact>();
  for (const f of levels) {
    const k = Math.round((f.feet as number) * 12);
    if (!byFeet.has(k)) byFeet.set(k, f);
  }
  const sorted = [...byFeet.values()].sort((a, b) => (b.feet as number) - (a.feet as number));
  if (sorted.length < 2) return null;
  const [top, next] = [sorted[0]!, sorted[1]!];
  return { pitched: { feet: top.feet as number, from: `${top.sheet} ${top.phrase}` }, flat: { feet: next.feet as number, from: `${next.sheet} ${next.phrase}` } };
}

/** A roof plan's reading laid over one floor plan: cells of `cellFeet`, pitched ones listed. */
export type RoofMask = { cellUnits: number; x0: number; y0: number; cols: number; rows: number; pitched: number[]; roofSheet: string };

/** Classify the floor plan's extent cell by cell, the roof already shifted onto it. */
export function roofMask(index: RoofIndex, bounds: { x0: number; y0: number; x1: number; y1: number }, roofSheet: string, cellFeet = 2): RoofMask {
  const cellUnits = cellFeet / index.feetPerUnit;
  const cols = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cellUnits)), rows = Math.max(1, Math.ceil((bounds.y1 - bounds.y0) / cellUnits));
  const pitched: number[] = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    if (pitchedAt(index, bounds.x0 + (c + 0.5) * cellUnits, bounds.y0 + (r + 0.5) * cellUnits)) pitched.push(r * cols + c);
  }
  return { cellUnits, x0: bounds.x0, y0: bounds.y0, cols, rows, pitched, roofSheet };
}

const inRing = (x: number, y: number, xs: readonly number[], ys: readonly number[]) => {
  let hit = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i, i += 1) if (ys[i]! > y !== ys[j]! > y && x < ((xs[j]! - xs[i]!) * (y - ys[i]!)) / (ys[j]! - ys[i]!) + xs[i]!) hit = !hit;
  return hit;
};

/** A room is under a pitched roof when most of the mask's cells inside it are. Null when none fall inside. */
export function roomPitched(mask: RoofMask, room: { xs: readonly number[]; ys: readonly number[] }, set: ReadonlySet<number> = new Set(mask.pitched)): boolean | null {
  let n = 0, yes = 0;
  for (let r = 0; r < mask.rows; r += 1) for (let c = 0; c < mask.cols; c += 1) {
    const x = mask.x0 + (c + 0.5) * mask.cellUnits, y = mask.y0 + (r + 0.5) * mask.cellUnits;
    if (!inRing(x, y, room.xs, room.ys)) continue;
    n += 1;
    if (set.has(r * mask.cols + c)) yes += 1;
  }
  return n === 0 ? null : yes * 2 >= n;
}

/**
 * A run's part: the rooms either side of its middle; a wall between a pitched
 * and a flat room runs to the higher roof. Null when neither side is a room.
 */
export function runPitched(
  run: Seg & { thicknessFeet?: number },
  rooms: readonly { xs: readonly number[]; ys: readonly number[]; pitched: boolean | null }[],
  feetPerUnit: number,
): boolean | null {
  const len = Math.hypot(run.x2 - run.x1, run.y2 - run.y1);
  if (len === 0) return null;
  const nx = -(run.y2 - run.y1) / len, ny = (run.x2 - run.x1) / len;
  const off = ((run.thicknessFeet ?? 0.5) / 2 + 1.5) / feetPerUnit;
  const mx = (run.x1 + run.x2) / 2, my = (run.y1 + run.y2) / 2;
  const reads = [1, -1]
    .map((s) => rooms.find((r) => inRing(mx + s * nx * off, my + s * ny * off, r.xs, r.ys))?.pitched)
    .filter((v): v is boolean => v !== null && v !== undefined);
  return reads.length === 0 ? null : reads.some((v) => v);
}
