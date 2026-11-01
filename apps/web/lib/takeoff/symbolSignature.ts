import type { StrokeSegment } from "./wallVectors";

/**
 * ── "FIND ALL LIKE THIS": ONE BOXED SYMBOL, EVERY COPY ON THE SHEET ──
 *
 * The estimator draws a box round one symbol — a receptacle, a sprinkler
 * head, a light, a door tag — and every other instance on the sheet is
 * wanted. A CAD symbol is the same block stamped again and again, so its
 * strokes are the same strokes, rotated, mirrored, moved. What is NOT the
 * same is the text beside it (a different mark each time) and whatever it
 * touches (a wall it sits on, a leader to a note).
 *
 * Three versions of this were measured on the training sheets before the
 * one below (NOTES-symbols.md §2). Histograms of a cluster's strokes failed
 * on the first real symbol, Baker's door tag, which straddles the wall it
 * names; laying the template over each CLUSTER of touching strokes turned
 * a symbol on a hatch into a cluster of a thousand strokes (49 s on Bunkie)
 * and let tiny arc pieces "lie along" hatch (192 false circles on Topeka).
 *
 * So: a RIGID match, anchored, over a grid of every stroke.
 *
 *   - The template is the strokes inside the box, less any under a text
 *     item, less whatever sits out at the box's edges (see `templateStrokes`
 *     and the centre weighting in `findSymbols`).
 *   - Take one of the template's heaviest strokes, find every stroke of that
 *     length on the sheet, lay the template over it in each of the four ways
 *     a rigid body can (two ends, mirrored or not), and ask how much of the
 *     template's ink lies along a stroke of comparable length within reach.
 *     Whatever else is near — a wall, a leader, letters drawn as paths — is
 *     not asked about. Rotation and mirroring cost nothing.
 *   - What recurs across the first pass's placements is the symbol; a
 *     template stroke that lands on fewer than half of them is context and
 *     is dropped before the strict pass, provided most of the ink survives.
 *
 * Units: whatever the strokes are in; the box is in the same units.
 */

export type Box = { x1: number; y1: number; x2: number; y2: number };
/** A text item's box — and its words, when the caller has them: the letters INSIDE a boxed symbol are part of the symbol (`label`). */
export type TextBox = { x: number; y: number; width: number; height: number; str?: string };

export type Signature = {
  count: number;
  /** Total stroke length over the RMS radius. */
  ink: number;
  /** RMS radius in the input units — the symbol's size. */
  radius: number;
  lengths: number[];
  angles: number[];
  radii: number[];
};

export type SymbolMatch = {
  /** The template's footprint where it landed. */
  box: Box;
  /** One minus the coverage: 0 means every template stroke landed. */
  distance: number;
  /** Strokes in the template that was matched. */
  segments: number;
};

/** A template stroke counts as found when both its ends lie this close to a candidate stroke, as a fraction of the template radius. */
export const END_TOLERANCE = 0.12;
/** How much of the template's (centre-weighted) ink must land on the sheet. Baker's door tags sat at 0.75 beside five things that were not tags; 0.8 keeps the tags and drops the five. */
export const COVERAGE = 0.8;
/** The anchor stroke on the sheet may differ in length from the template's by this fraction. */
export const ANCHOR_TOLERANCE = 0.1;
/** How many of the template's heaviest strokes are tried as the anchor. */
export const ANCHORS = 3;
/** An anchor length shared by more strokes than this is skipped while a rarer one exists: a hatch pitch tells nothing about where the symbol is. */
export const MOST_COMMON_ANCHOR = 2000;
/** Coverage at which a placement is settled, so strokes inside it are not tried again. */
const SETTLED_COVERAGE = 0.9;
/**
 * A grey level at or above this is a grey pen; below it, black. A covering
 * stroke must be the same class as the template stroke it covers: on Baker's
 * lighting plan every 2x4 fixture sits on a 2x4 ceiling tile drawn in thin
 * grey, and without this the fixture's black rectangle was "covered" by an
 * empty tile, a desk and a pendant's outline — six false in twenty-nine.
 */
export const GREY_PEN = 0.3;
/** …and within this ratio of its width, where both pens are known. */
export const PEN_WIDTH_RATIO = 4;
/**
 * When the black strokes in the box carry at least this share of its ink,
 * the grey ones are background and are left out of the template: the
 * ceiling tile a 2x4 fixture sits on, the wall hatch round a sensor, an
 * existing wall under a receptacle. Below it the box IS a grey symbol — an
 * existing fixture drawn screened — and every stroke stays.
 */
export const BLACK_IS_THE_SYMBOL = 0.4;
/** The most of a template's weight one chain of micro-pieces (a drawn circle) may carry when straight strokes are present too. */
export const CHAIN_SHARE = 0.5;
/** Two placements whose footprints overlap by this share of the smaller are one placement. */
export const SAME_PLACEMENT_OVERLAP = 0.5;
/** Strokes closer than this fraction of the box diagonal are one cluster when the template is picked. */
export const TOUCH_FRACTION = 0.03;
const BINS = 8;

type Pt = { x: number; y: number };
const len = (s: StrokeSegment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
/** The same pen: both grey or both black, and the widths within `PEN_WIDTH_RATIO` where both are known. */
export function samePen(a: StrokeSegment, b: StrokeSegment): boolean {
  if (((a.gray ?? 0) >= GREY_PEN) !== ((b.gray ?? 0) >= GREY_PEN)) return false;
  if (a.width !== undefined && b.width !== undefined && a.width > 0 && b.width > 0) {
    const r = a.width / b.width;
    if (r > PEN_WIDTH_RATIO || r < 1 / PEN_WIDTH_RATIO) return false;
  }
  return true;
}

function histogram(values: readonly number[], weights: readonly number[], max: number): number[] {
  const h = new Array<number>(BINS).fill(0);
  let total = 0;
  values.forEach((v, i) => {
    const b = Math.min(BINS - 1, Math.max(0, Math.floor((v / max) * BINS)));
    h[b] = h[b]! + weights[i]!;
    total += weights[i]!;
  });
  return total > 0 ? h.map((x) => x / total) : h;
}

/** Strokes whose midpoint lies under a text item are the text, not the symbol. */
export function withoutText(segments: readonly StrokeSegment[], text: readonly TextBox[], slack = 0): StrokeSegment[] {
  if (text.length === 0) return [...segments];
  return segments.filter((s) => {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    return !text.some((t) => mx >= t.x - slack && mx <= t.x + t.width + slack && my >= t.y - slack && my <= t.y + t.height + slack);
  });
}

/**
 * A rotation-, mirror- and translation-invariant summary of a set of strokes.
 * Kept for the size (its `radius` sets every tolerance) and for tests; the
 * matching itself is rigid.
 */
export function signatureOf(segments: readonly StrokeSegment[]): Signature | null {
  const kept = segments.filter((s) => len(s) > 0);
  if (kept.length === 0) return null;
  const weights = kept.map(len);
  const total = weights.reduce((a, b) => a + b, 0);
  let cx = 0, cy = 0;
  kept.forEach((s, i) => { cx += ((s.x1 + s.x2) / 2) * weights[i]!; cy += ((s.y1 + s.y2) / 2) * weights[i]!; });
  cx /= total; cy /= total;
  let r2 = 0;
  for (const s of kept) r2 += (s.x1 - cx) ** 2 + (s.y1 - cy) ** 2 + (s.x2 - cx) ** 2 + (s.y2 - cy) ** 2;
  const radius = Math.sqrt(r2 / (2 * kept.length));
  if (!(radius > 0)) return null;
  let sxx = 0, syy = 0, sxy = 0;
  for (const s of kept) for (const p of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }] as Pt[]) { sxx += (p.x - cx) ** 2; syy += (p.y - cy) ** 2; sxy += (p.x - cx) * (p.y - cy); }
  const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const angles = kept.map((s) => {
    let a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1) - axis;
    a = Math.abs(((a % Math.PI) + Math.PI) % Math.PI);
    if (a > Math.PI / 2) a = Math.PI - a;
    return a;
  });
  const radii = kept.map((s) => Math.hypot((s.x1 + s.x2) / 2 - cx, (s.y1 + s.y2) / 2 - cy) / radius);
  return {
    count: kept.length,
    ink: total / radius,
    radius,
    lengths: histogram(weights.map((w) => w / radius), weights, 2.5),
    angles: histogram(angles, weights, Math.PI / 2 + 1e-9),
    radii: histogram(radii, weights, 2),
  };
}

export function signatureDistance(a: Signature, b: Signature): number {
  const l1 = (p: number[], q: number[]) => p.reduce((t, v, i) => t + Math.abs(v - q[i]!), 0);
  const countTerm = Math.abs(a.count - b.count) / Math.max(a.count, b.count);
  const inkTerm = Math.abs(a.ink - b.ink) / Math.max(a.ink, b.ink);
  return l1(a.lengths, b.lengths) + l1(a.angles, b.angles) + l1(a.radii, b.radii) + countTerm + inkTerm;
}

/**
 * The strokes of the box: wholly inside it, or THROUGH it — a stroke no
 * longer than the box's diagonal whose midpoint is in.
 *
 * Baker's duplex receptacle is a circle with two lines that run a little
 * past it top and bottom; a box drawn snug round the circle cut both lines
 * off, the template was a bare circle, and every junction box and GFCI of
 * that radius counted as a receptacle. An estimator's box is drawn by eye,
 * and the line that pokes out of it is the one that says what the symbol is.
 */
export function strokesInBox(segments: readonly StrokeSegment[], box: Box): StrokeSegment[] {
  const x1 = Math.min(box.x1, box.x2), x2 = Math.max(box.x1, box.x2), y1 = Math.min(box.y1, box.y2), y2 = Math.max(box.y1, box.y2);
  const inside = (x: number, y: number) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
  const diag = Math.hypot(x2 - x1, y2 - y1);
  return segments.filter((s) => {
    if (inside(s.x1, s.y1) && inside(s.x2, s.y2)) return true;
    // Through the box or out of one side: the symbol's own line when it is no
    // longer than the box; a wall running through is not.
    return len(s) <= diag && inside((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
  });
}

/** Clusters of strokes no longer than `maxLen` that touch within `touch`; union-find over a grid. */
export function clusters(segments: readonly StrokeSegment[], maxLen: number, touch: number): StrokeSegment[][] {
  const idx = segments.map((s, i) => ({ s, i })).filter(({ s }) => { const l = len(s); return l > 0 && l <= maxLen; });
  const parent = idx.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const cell = Math.max(touch, maxLen, 1e-9);
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  idx.forEach(({ s }, i) => {
    for (const k of new Set([key(s.x1, s.y1), key(s.x2, s.y2)])) (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const d2seg = (p: Pt, s: StrokeSegment) => {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / l2));
    return Math.hypot(p.x - (s.x1 + t * dx), p.y - (s.y1 + t * dy));
  };
  idx.forEach(({ s }, i) => {
    for (const p of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]) {
      const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
      for (let ax = gx - 1; ax <= gx + 1; ax++) for (let ay = gy - 1; ay <= gy + 1; ay++) {
        for (const j of grid.get(`${ax},${ay}`) ?? []) {
          if (j <= i || find(i) === find(j)) continue;
          if (d2seg(p, idx[j]!.s) <= touch) union(i, j);
        }
      }
    }
  });
  const groups = new Map<number, StrokeSegment[]>();
  idx.forEach(({ s }, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(s); });
  return [...groups.values()];
}

const boxOf = (segments: readonly StrokeSegment[]): Box => ({
  x1: Math.min(...segments.flatMap((s) => [s.x1, s.x2])),
  y1: Math.min(...segments.flatMap((s) => [s.y1, s.y2])),
  x2: Math.max(...segments.flatMap((s) => [s.x1, s.x2])),
  y2: Math.max(...segments.flatMap((s) => [s.y1, s.y2])),
});

/**
 * THE SYMBOL IS WHAT SITS IN THE MIDDLE OF THE BOX. An estimator's box is
 * loose: on Baker a box round door tag 107 took the hexagon, the jamb pieces
 * it straddles and the start of the door's swing. The strokes inside the box
 * are clustered, and every cluster whose centre lies in the middle half of
 * the box is the template — a door-rating bubble is its circle AND the
 * digits in it, which Topeka draws as paths, and taking the one cluster
 * nearest the centre took the digits alone and matched every "2" on the
 * sheet. A stroke longer than the box's diagonal is never part of it.
 */
export function templateStrokes(segments: readonly StrokeSegment[], box: Box): StrokeSegment[] {
  const inside = strokesInBox(segments, box);
  if (inside.length === 0) return [];
  const w = Math.abs(box.x2 - box.x1), h = Math.abs(box.y2 - box.y1);
  const diag = Math.hypot(w, h);
  const groups = clusters(inside, diag, diag * TOUCH_FRACTION);
  if (groups.length === 0) return [];
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
  const centre = (g: StrokeSegment[]) => {
    const b = boxOf(g);
    return Math.hypot((b.x1 + b.x2) / 2 - cx, (b.y1 + b.y2) / 2 - cy);
  };
  const central = groups.filter((g) => centre(g) <= diag * 0.25);
  if (central.length > 0) return central.flat();
  return groups.sort((a, b) => centre(a) - centre(b))[0]!;
}

type Rigid = { cos: number; sin: number; mirror: boolean; tx: number; ty: number };
const apply = (t: Rigid, p: Pt, origin: Pt): Pt => {
  const x = p.x - origin.x, y = (t.mirror ? -1 : 1) * (p.y - origin.y);
  return { x: x * t.cos - y * t.sin + t.tx, y: x * t.sin + y * t.cos + t.ty };
};

/** A grid of strokes for "what is near this point", built once per sheet. */
export class StrokeGrid {
  private readonly cells = new Map<string, number[]>();
  constructor(readonly strokes: readonly StrokeSegment[], readonly cell: number) {
    strokes.forEach((s, i) => {
      // A stroke is registered in every cell it crosses, so a long wall is
      // found from any point along it.
      const steps = Math.max(1, Math.ceil(len(s) / cell));
      const seen = new Set<string>();
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const key = this.key(s.x1 + (s.x2 - s.x1) * t, s.y1 + (s.y2 - s.y1) * t);
        if (seen.has(key)) continue;
        seen.add(key);
        (this.cells.get(key) ?? this.cells.set(key, []).get(key)!).push(i);
      }
    });
  }
  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }
  /** Indices of strokes registered in the cells round a point (the cell and its eight neighbours). */
  near(p: Pt): number[] {
    const gx = Math.floor(p.x / this.cell), gy = Math.floor(p.y / this.cell);
    const out: number[] = [];
    for (let ax = gx - 1; ax <= gx + 1; ax++) for (let ay = gy - 1; ay <= gy + 1; ay++) {
      const list = this.cells.get(`${ax},${ay}`);
      if (list) for (const i of list) out.push(i);
    }
    return out;
  }
}

/**
 * ── A CIRCLE OF TWO HUNDRED MICRO-PIECES HAS NOTHING TO ANCHOR ON ──
 *
 * Revit draws Baker's occupancy sensor as 236 pieces of 0.13‰; the anchor
 * floor (`radius * END_TOLERANCE * 2`) rightly refuses pieces that short,
 * so the only anchors left were two grid pieces under the symbol, and three
 * sensors of twelve were found. A CAD block is the same path stamped again,
 * so its pieces come in the same order every time: chaining consecutive
 * short pieces and taking the chord of every `minLen` of path gives a
 * stroke that exists, identically placed, in every instance — and is used
 * ONLY as an anchor. Coverage is still measured on the drawn pieces.
 */
/** The chains of connected pieces shorter than `minLen`, as indices into `strokes`, each in path order. */
export function chains(strokes: readonly StrokeSegment[], minLen: number): number[][] {
  const short = strokes.map((s, i) => ({ s, i })).filter(({ s }) => { const l = len(s); return l > 0 && l < minLen; });
  if (short.length < 2) return [];
  const eps = Math.max(minLen * 0.02, 1e-9);
  const key = (x: number, y: number) => `${Math.round(x / eps)},${Math.round(y / eps)}`;
  const byStart = new Map<string, number>();
  short.forEach(({ s }, k) => { const kk = key(s.x1, s.y1); if (!byStart.has(kk)) byStart.set(kk, k); });
  const next = short.map(({ s }) => { const n = byStart.get(key(s.x2, s.y2)); return n === undefined ? -1 : n; });
  const hasPrev = new Set<number>();
  next.forEach((n) => { if (n >= 0) hasPrev.add(n); });
  const seen = new Set<number>();
  const out: number[][] = [];
  const walk = (start: number) => { const chain: number[] = []; let k = start; while (k >= 0 && !seen.has(k)) { seen.add(k); chain.push(short[k]!.i); k = next[k]!; } if (chain.length >= 2) out.push(chain); };
  short.forEach((_, k) => { if (!hasPrev.has(k)) walk(k); });
  short.forEach((_, k) => { if (!seen.has(k)) walk(k); });
  return out;
}

export function chainChords(strokes: readonly StrokeSegment[], minLen: number): StrokeSegment[] {
  const short = strokes.map((s, i) => ({ s, i })).filter(({ s }) => { const l = len(s); return l > 0 && l < minLen; });
  if (short.length < 2) return [];
  const eps = Math.max(minLen * 0.02, 1e-9);
  const key = (x: number, y: number) => `${Math.round(x / eps)},${Math.round(y / eps)}`;
  const byStart = new Map<string, number>();
  short.forEach(({ s }, k) => { const kk = key(s.x1, s.y1); if (!byStart.has(kk)) byStart.set(kk, k); });
  const hasPrev = new Set<number>();
  const next = short.map(({ s }) => { const n = byStart.get(key(s.x2, s.y2)); return n === undefined ? -1 : n; });
  next.forEach((n) => { if (n >= 0) hasPrev.add(n); });
  const out: StrokeSegment[] = [];
  const seen = new Set<number>();
  const walk = (start: number) => {
    let k = start, acc = 0, from = short[k]!.s;
    while (k >= 0 && !seen.has(k)) {
      seen.add(k);
      const piece = short[k]!.s;
      acc += len(piece);
      if (acc >= minLen) {
        out.push({ ...from, x1: from.x1, y1: from.y1, x2: piece.x2, y2: piece.y2 });
        acc = 0;
        const n = next[k]!;
        from = n >= 0 && !seen.has(n) ? short[n]!.s : piece;
      }
      k = next[k]!;
    }
  };
  // Open chains from their heads, in path order; closed chains from their first piece.
  short.forEach((_, k) => { if (!hasPrev.has(k)) walk(k); });
  short.forEach((_, k) => { if (!seen.has(k)) walk(k); });
  return out;
}

/**
 * The template laid over the sheet with its `anchorIndex` stroke on `onto`
 * (one of four ways), and how much of its weighted ink lands along a stroke
 * of comparable length. Stops as soon as the floor is out of reach.
 */
/**
 * Heaviest strokes first, so a wrong placement fails in two or three tests
 * rather than forty — what makes a 260,000-stroke sheet answer in seconds. Kept
 * per weights array, because a template of 236 pieces was re-sorted for every
 * one of 22,000 placements.
 */
const visitOrders = new WeakMap<readonly number[], { total: number; order: number[] }>();
function visitOrder(weights: readonly number[]): { total: number; order: number[] } {
  const held = visitOrders.get(weights);
  if (held) return held;
  const made = { total: weights.reduce((a, b) => a + b, 0), order: weights.map((_, i) => i).sort((a, b) => weights[b]! - weights[a]!) };
  visitOrders.set(weights, made);
  return made;
}

export function coverageAt(
  template: readonly StrokeSegment[],
  weights: readonly number[],
  anchor: StrokeSegment,
  onto: StrokeSegment,
  flip: boolean,
  mirror: boolean,
  grid: StrokeGrid,
  radius: number,
  floor = 0,
): { coverage: number; hit: boolean[]; transform: Rigid; origin: Pt } {
  const tol = radius * END_TOLERANCE;
  const origin = { x: anchor.x1, y: anchor.y1 };
  const aAng = Math.atan2(anchor.y2 - anchor.y1, anchor.x2 - anchor.x1);
  const c1 = flip ? { x: onto.x2, y: onto.y2 } : { x: onto.x1, y: onto.y1 };
  const c2 = flip ? { x: onto.x1, y: onto.y1 } : { x: onto.x2, y: onto.y2 };
  const cAng = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  const rot = cAng - (mirror ? -aAng : aAng);
  const t: Rigid = { cos: Math.cos(rot), sin: Math.sin(rot), mirror, tx: c1.x, ty: c1.y };
  const d2seg = (p: Pt, k: StrokeSegment) => {
    const dx = k.x2 - k.x1, dy = k.y2 - k.y1, l2 = dx * dx + dy * dy;
    const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - k.x1) * dx + (p.y - k.y1) * dy) / l2));
    return Math.hypot(p.x - (k.x1 + u * dx), p.y - (k.y1 + u * dy));
  };
  const { total, order } = visitOrder(weights);
  let covered = 0;
  let missed = 0;
  const hit = template.map(() => false);
  for (const i of order) {
    if (missed > (1 - floor) * total) break;
    const s = template[i]!;
    const p = apply(t, { x: s.x1, y: s.y1 }, origin), q = apply(t, { x: s.x2, y: s.y2 }, origin);
    const sl = len(s);
    const a = Math.atan2(q.y - p.y, q.x - p.x);
    const ok = grid.near({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }).some((j) => {
      const k = grid.strokes[j]!;
      // Comparable length: the same edge drawn as one piece or two halves,
      // never a tiny arc piece "lying along" a wall.
      const kl = len(k);
      if (kl < sl * 0.4 || kl > sl * 2.5) return false;
      if (!samePen(s, k)) return false;
      if (d2seg(p, k) > tol || d2seg(q, k) > tol) return false;
      const b = Math.atan2(k.y2 - k.y1, k.x2 - k.x1);
      const d = Math.abs(((a - b) % Math.PI) + Math.PI) % Math.PI;
      return Math.min(d, Math.PI - d) <= 0.15;
    });
    if (ok) covered += weights[i]!;
    else missed += weights[i]!;
    hit[i] = ok;
  }
  return { coverage: total > 0 ? covered / total : 0, hit, transform: t, origin };
}

/** How much of the template's ink lies on the candidate's strokes, at the best anchor and orientation. */
export function coverageOf(template: readonly StrokeSegment[], candidate: readonly StrokeSegment[], radius: number): number {
  const grid = new StrokeGrid(candidate, Math.max(radius * 2, 1e-6));
  const weights = template.map(len);
  const order = template.map((_, i) => i).filter((i) => len(template[i]!) > radius * END_TOLERANCE * 2).sort((a, b) => weights[b]! - weights[a]!).slice(0, ANCHORS);
  let best = 0;
  for (const ai of order) for (const onto of candidate) {
    if (Math.abs(len(onto) - len(template[ai]!)) > len(template[ai]!) * ANCHOR_TOLERANCE) continue;
    for (const flip of [false, true]) for (const mirror of [false, true]) best = Math.max(best, coverageAt(template, weights, template[ai]!, onto, flip, mirror, grid, radius).coverage);
  }
  return best;
}

/** The template laid over the sheet at a transform: its footprint. */
function footprintOf(template: readonly StrokeSegment[], transform: Rigid, origin: Pt): Box {
  const pts = template.flatMap((s) => [apply(transform, { x: s.x1, y: s.y1 }, origin), apply(transform, { x: s.x2, y: s.y2 }, origin)]);
  return { x1: Math.min(...pts.map((p) => p.x)), y1: Math.min(...pts.map((p) => p.y)), x2: Math.max(...pts.map((p) => p.x)), y2: Math.max(...pts.map((p) => p.y)) };
}

/** Every placement of the template on the sheet reaching the floor, one per place. */
function placements(
  template: readonly StrokeSegment[],
  weights: readonly number[],
  grid: StrokeGrid,
  radius: number,
  floor: number,
  field: { chords: readonly StrokeSegment[] },
): { box: Box; detail: ReturnType<typeof coverageAt> }[] {
  const minAnchor = radius * END_TOLERANCE * 2;
  // Anchors: the template's own strokes above the floor, plus the chords of
  // its chains of micro-pieces, weighted by the ink they stand for.
  const own = template.map((s, i) => ({ s, w: weights[i]! })).filter(({ s }) => len(s) > minAnchor);
  const chordW = (c: StrokeSegment) => len(c);
  const anchorsAll = [...own, ...chainChords(template, minAnchor * 1.5).map((c) => ({ s: c, w: chordW(c) }))];
  // By weight, longest first among equals — but a length that thousands of
  // strokes on the sheet share (a hatch pitch, an arc piece) says nothing
  // about where the symbol is and costs a placement test each. Such an
  // anchor is skipped while a rarer one exists.
  const candidates = [...grid.strokes, ...field.chords];
  const byWeight = [...anchorsAll].sort((a, b) => b.w - a.w || len(b.s) - len(a.s));
  const commonness = (a: StrokeSegment) => {
    const l = len(a);
    let n = 0;
    for (const k of candidates) if (Math.abs(len(k) - l) <= l * ANCHOR_TOLERANCE) n++;
    return n;
  };
  const rare = byWeight.filter((a) => commonness(a.s) <= MOST_COMMON_ANCHOR);
  const order = (rare.length > 0 ? rare : [...byWeight].sort((a, b) => commonness(a.s) - commonness(b.s))).slice(0, ANCHORS);
  const found: { box: Box; detail: ReturnType<typeof coverageAt> }[] = [];
  // Two placements within a radius of each other are the same symbol seen
  // from two anchors (a circle found from opposite pieces lands half a
  // symbol apart); two real symbols that close would be drawn over each other.
  // For a LONG symbol the radius is short against its length — Baker's S1
  // strip lights chain tick-to-tick, and a template of one unit also lands
  // half a unit along, where the line still covers it — so footprints that
  // mostly overlap are one placement too.
  const same = radius;
  const overlap = (a: Box, b: Box) => {
    const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (w <= 0 || h <= 0) return 0;
    const inter = w * h;
    const areaA = (a.x2 - a.x1) * (a.y2 - a.y1), areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
    return inter / Math.min(areaA, areaB);
  };
  for (const { s: anchor } of order) {
    const aLen = len(anchor);
    for (const onto of candidates) {
      if (Math.abs(len(onto) - aLen) > aLen * ANCHOR_TOLERANCE) continue;
      // A spot already matched almost whole has nothing left to prove, and its
      // own pieces would each re-test it: Baker's OS circle is 236 of them, 12 s.
      const mx = (onto.x1 + onto.x2) / 2, my = (onto.y1 + onto.y2) / 2;
      if (found.some((f) => f.detail.coverage >= SETTLED_COVERAGE && mx >= f.box.x1 && mx <= f.box.x2 && my >= f.box.y1 && my <= f.box.y2)) continue;
      let best: ReturnType<typeof coverageAt> | null = null;
      for (const flip of [false, true]) for (const mirror of [false, true]) {
        const d = coverageAt(template, weights, anchor, onto, flip, mirror, grid, radius, floor);
        if (d.coverage >= floor && (best === null || d.coverage > best.coverage)) best = d;
      }
      if (best === null) continue;
      const box = footprintOf(template, best.transform, best.origin);
      const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
      const at = found.findIndex((f) => Math.hypot((f.box.x1 + f.box.x2) / 2 - cx, (f.box.y1 + f.box.y2) / 2 - cy) <= same || overlap(f.box, box) >= SAME_PLACEMENT_OVERLAP);
      if (at < 0) found.push({ box, detail: best });
      else if (best.coverage > found[at]!.detail.coverage) found[at] = { box, detail: best };
    }
  }
  return found;
}

/**
 * The symbol an estimator boxed, ready to be looked for on ANY sheet: its
 * strokes (less text, less what sits at the box's edges), the box they came
 * from (the centre weighting below is measured from it), and the size.
 *
 * Carried separately from `findSymbols` so one template can be laid over
 * every sheet of a set — the across-the-set count — or taken off a legend
 * sheet's own swatch and counted on the plan. Translation costs nothing
 * (the match is anchored), so the strokes stay in their own page's
 * coordinates; `scaleSymbolTemplate` is for a sheet at another scale.
 */
export type SymbolTemplate = {
  strokes: StrokeSegment[];
  box: Box;
  signature: Signature;
  /** Strokes the box held before the centre weighting, for the panel's sentence. */
  boxed: number;
  /** Nothing is printed in the symbol's middle, so a match with text there is something else. */
  blank?: boolean;
  /** The tag decided on the boxed sheet, set before the template walks other sheets. */
  decidedTag?: string | null;
  /**
   * The words printed INSIDE the box, upper-cased and joined — "OS" in an
   * occupancy sensor's circle, "PC" in a photocell's. Baker's lighting plan
   * draws both as the same circle, so the letters are the only thing that
   * tells them apart, and a match must carry the same letters. Null when
   * the box holds no text, and then nothing is asked.
   */
  label: string | null;
  /** The type tag beside the symbol ("E2"), when the nearest text reads like one — see `tagBeside`. */
  tag: string | null;
};

/**
 * The words whose centre lies inside a box, as one upper-cased label; null
 * for none — and null for a NUMBER. A door tag's "107", a keynote's "12"
 * and a rating bubble's "20" name the instance, not the kind; Baker's
 * eighteen door hexagons would be eighteen symbols otherwise. Letters name
 * the kind: OS, PC, GFI, WP.
 */
/** Whether any text overlaps a symbol, digits included. Overlap, not centre: XXXXXX straddles two boxes on E0.02. */
function textInside(text: readonly TextBox[], box: Box): boolean {
  const x1 = Math.min(box.x1, box.x2), x2 = Math.max(box.x1, box.x2), y1 = Math.min(box.y1, box.y2), y2 = Math.max(box.y1, box.y2);
  return text.some((t) => {
    if (t.str === undefined || t.str.trim() === "") return false;
    return t.x < x2 && t.x + t.width > x1 && t.y < y2 && t.y + t.height > y1;
  });
}

export function labelInside(text: readonly TextBox[], box: Box): string | null {
  // The inner half of the box: a switch-leg "a" at a fixture's corner is in
  // the box the estimator drew and is not inside the symbol.
  const bx1 = Math.min(box.x1, box.x2), bx2 = Math.max(box.x1, box.x2), by1 = Math.min(box.y1, box.y2), by2 = Math.max(box.y1, box.y2);
  const mx = (bx2 - bx1) / 4, my = (by2 - by1) / 4;
  const x1 = bx1 + mx, x2 = bx2 - mx, y1 = by1 + my, y2 = by2 - my;
  const words = text
    .filter((t) => t.str !== undefined && t.str.trim() !== "")
    .filter((t) => { const cx = t.x + t.width / 2, cy = t.y + t.height / 2; return cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2; })
    .map((t) => t.str!.replace(/\s+/g, " ").trim().toUpperCase())
    .filter((w) => /[A-Z]/.test(w));
  return words.length === 0 ? null : words.join(" ");
}

/**
 * ── THE TYPE TAG BESIDE A SYMBOL IS PART OF IT ──
 *
 * Baker's E2 emergency fixture and its R2 emergency can are the SAME block —
 * a filled circle with an arc — and only the tag beside them says which:
 * "E2 /INV-1" against "R2 /INV-1". A tag is the short code a schedule keys
 * on (E2, R1, S1, X1, GFI), written as the first token of the nearest text
 * within `TAG_REACH` radii of the symbol; a room name or a dimension there
 * does not look like one and asks nothing of the matches.
 */
export const TAG_REACH = 4;
/** …and never less than this, in page-width units: a quarter inch on an ARCH D sheet, so a 1/8"-wide fixture's tag a letter-height away is within reach. */
export const TAG_MIN_REACH = 0.007;
const TYPE_TAG = /^(?:[A-Z]{1,3}\d{1,2}[A-Z]?|[A-Z]{2,3})$/;
/** The distinct type-tag tokens of the text within reach of a box, nearest first. */
export function tagsWithin(text: readonly TextBox[], box: Box, radius: number): string[] {
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
  const x1 = Math.min(box.x1, box.x2), x2 = Math.max(box.x1, box.x2), y1 = Math.min(box.y1, box.y2), y2 = Math.max(box.y1, box.y2);
  const found: { d: number; token: string }[] = [];
  for (const t of text) {
    if (t.str === undefined) continue;
    const tx = t.x + t.width / 2, ty = t.y + t.height / 2;
    if (tx >= x1 && tx <= x2 && ty >= y1 && ty <= y2) continue;
    const d = Math.hypot(tx - cx, ty - cy);
    if (d > Math.max(radius * TAG_REACH, TAG_MIN_REACH)) continue;
    const token = t.str.trim().toUpperCase().split(/[\s/]+/)[0] ?? "";
    if (TYPE_TAG.test(token)) found.push({ d, token });
  }
  found.sort((a, b) => a.d - b.d);
  return [...new Set(found.map((f) => f.token))];
}
/** The template's type tag: of the tag-like tokens beside it, the one most of the matches also have beside them. */
export function tagBeside(text: readonly TextBox[], box: Box, radius: number, matches: readonly { box: Box }[] = []): string | null {
  const own = tagsWithin(text, box, radius);
  if (own.length === 0) return null;
  if (matches.length === 0) return own[0]!;
  const support = own.map((token) => ({ token, n: matches.filter((m) => tagsWithin(text, m.box, radius).includes(token)).length }));
  support.sort((a, b) => b.n - a.n);
  return support[0]!.n > 0 ? support[0]!.token : null;
}

export function symbolTemplate(segments: readonly StrokeSegment[], text: readonly TextBox[], box: Box): SymbolTemplate | null {
  const clean = withoutText(segments, text);
  const own = symbolInk(templateStrokes(clean, box));
  const sig = signatureOf(own);
  if (sig === null) return null;
  const ink = { x1: Math.min(...own.flatMap((s) => [s.x1, s.x2])), y1: Math.min(...own.flatMap((s) => [s.y1, s.y2])), x2: Math.max(...own.flatMap((s) => [s.x1, s.x2])), y2: Math.max(...own.flatMap((s) => [s.y1, s.y2])) };
  return { strokes: own, box, signature: sig, boxed: own.length, label: labelInside(text, box), tag: tagBeside(text, box, sig.radius), blank: !textInside(text, ink) };
}

/** The box's strokes less the grey background, when black carries the symbol — see `BLACK_IS_THE_SYMBOL`. */
export function symbolInk(strokes: readonly StrokeSegment[]): StrokeSegment[] {
  const black = strokes.filter((s) => (s.gray ?? 0) < GREY_PEN);
  const total = strokes.reduce((t, s) => t + len(s), 0);
  const dark = black.reduce((t, s) => t + len(s), 0);
  return total > 0 && dark / total >= BLACK_IS_THE_SYMBOL ? black : [...strokes];
}

/**
 * The same symbol drawn `factor` times larger — a 1/4" enlarged plan beside
 * a 1/8" plan draws a model-space fixture twice the size, while an
 * annotative symbol stays the size it is on paper. Which of the two a
 * drawing used is not written anywhere, so a caller tries the paper size
 * first and the model size where the sheets' scales differ (`acrossSheets`).
 */
export function scaleSymbolTemplate(template: SymbolTemplate, factor: number): SymbolTemplate {
  if (!(factor > 0) || factor === 1) return template;
  const cx = (template.box.x1 + template.box.x2) / 2, cy = (template.box.y1 + template.box.y2) / 2;
  const sx = (x: number) => cx + (x - cx) * factor, sy = (y: number) => cy + (y - cy) * factor;
  const strokes = template.strokes.map((s) => ({ ...s, x1: sx(s.x1), y1: sy(s.y1), x2: sx(s.x2), y2: sy(s.y2) }));
  const box = { x1: sx(template.box.x1), y1: sy(template.box.y1), x2: sx(template.box.x2), y2: sy(template.box.y2) };
  const sig = signatureOf(strokes);
  return { strokes, box, signature: sig ?? template.signature, boxed: template.boxed, label: template.label, tag: template.tag, blank: template.blank, decidedTag: template.decidedTag };
}

/**
 * Every instance of the symbol in the box, on this sheet. The template's own
 * instance is in the list too (distance 0), so the count is the list's length.
 */
export function findSymbols(
  segments: readonly StrokeSegment[],
  text: readonly TextBox[],
  template: Box,
  options: { coverage?: number } = {},
): { matches: SymbolMatch[]; template: Signature | null; candidates: number; kept: number; boxed: number; label: string | null; offLabel: number; tag: string | null; offTag: number } {
  const made = symbolTemplate(segments, text, template);
  if (made === null) return { matches: [], template: null, candidates: 0, kept: 0, boxed: 0, label: null, offLabel: 0, tag: null, offTag: 0 };
  return findSymbolsFrom(segments, text, made, options);
}

/** Every instance of a template — boxed on this sheet, another sheet, or a legend — on this sheet's strokes. */
export function findSymbolsFrom(
  segments: readonly StrokeSegment[],
  text: readonly TextBox[],
  made: SymbolTemplate,
  options: { coverage?: number } = {},
): { matches: SymbolMatch[]; template: Signature; candidates: number; kept: number; boxed: number; label: string | null; offLabel: number; tag: string | null; offTag: number } {
  const coverage = options.coverage ?? COVERAGE;
  const clean = withoutText(segments, text);
  const own = made.strokes;
  const sig = made.signature;
  const template = made.box;
  // ── THE MIDDLE OF THE BOX IS WHAT WAS MEANT ──
  // A box round a door tag also holds the jamb and the start of the swing,
  // and those differ at the next door. Each template stroke's ink is weighted
  // by how close its midpoint sits to the box's centre, so the tag decides
  // and the edges of the box only help; ink that weighs almost nothing is
  // not even carried (a box that brushed a hatch on Bunkie took 1,044 strokes).
  const cx = (template.x1 + template.x2) / 2, cy = (template.y1 + template.y2) / 2;
  const half = Math.hypot(template.x2 - template.x1, template.y2 - template.y1) / 2;
  const weightOf = (s: StrokeSegment) => {
    const d = Math.hypot((s.x1 + s.x2) / 2 - cx, (s.y1 + s.y2) / 2 - cy) / Math.max(half, 1e-9);
    return len(s) * Math.exp(-((d / 0.6) ** 2));
  };
  const maxW = Math.max(...own.map(weightOf));
  const weighty = own.filter((s) => weightOf(s) >= maxW * 0.02);
  let tpl: StrokeSegment[] = weighty.length >= 3 ? weighty : own;
  // ── A CURVE IS ONE FEATURE, HOWEVER MANY PIECES IT IS DRAWN IN ──
  // Baker's duplex receptacle is a circle of micro-pieces and two straight
  // lines; by ink the circle is most of the symbol, so every circle of that
  // size — a junction box's three-spoke circle, a filled GFCI — covered 80%
  // and counted. A chain of connected micro-pieces may carry at most
  // `CHAIN_SHARE` of the weight while straight strokes carry the rest, so
  // the lines keep their say. A symbol that is ONLY a circle is left alone.
  const chainWeightOf = (strokes: readonly StrokeSegment[]): ((s: StrokeSegment) => number) => {
    const base = new Map(strokes.map((s) => [s, weightOf(s)] as const));
    const total = [...base.values()].reduce((a, b) => a + b, 0);
    const groups = chains(strokes, sig.radius * END_TOLERANCE * 3);
    const inChains = new Set(groups.flat());
    const straightW = strokes.reduce((t, s, i) => t + (inChains.has(i) ? 0 : base.get(s)!), 0);
    if (total <= 0 || straightW / total < 1 - CHAIN_SHARE) return (s) => base.get(s) ?? weightOf(s);
    for (const g of groups) {
      const w = g.reduce((t, i) => t + base.get(strokes[i]!)!, 0);
      if (w / total > CHAIN_SHARE) { const f = (CHAIN_SHARE * total) / w; for (const i of g) base.set(strokes[i]!, base.get(strokes[i]!)! * f); }
    }
    return (s) => base.get(s) ?? weightOf(s);
  };
  const grid = new StrokeGrid(clean, Math.max(sig.radius * 2, 1e-6));
  const field = { chords: chainChords(clean, sig.radius * END_TOLERANCE * 3) };
  // ── THE SYMBOL IS WHAT RECURS ──
  // A first pass finds the instances; a template stroke that lands on fewer
  // than half of them is context and is dropped; the strict pass runs on what
  // is left — only when what recurs is still most of the symbol (a template
  // cut to four strokes matched 22 things on Baker that were not door tags).
  const w1 = chainWeightOf(tpl);
  const first = placements(tpl, tpl.map(w1), grid, sig.radius, coverage, field);
  if (first.length >= 3) {
    const votes = tpl.map((_, i) => first.filter((m) => m.detail.hit[i]).length);
    const kept = tpl.filter((_, i) => votes[i]! >= first.length / 2);
    const keptW = kept.reduce((t, k) => t + w1(k), 0), allW = tpl.reduce((t, k) => t + w1(k), 0);
    if (kept.length >= 3 && keptW >= 0.6 * allW) tpl = kept;
  }
  const w2 = chainWeightOf(tpl);
  const matches: SymbolMatch[] = placements(tpl, tpl.map(w2), grid, sig.radius, coverage, field).map(({ box, detail }) => ({ box, distance: 1 - detail.coverage, segments: tpl.length }));
  matches.sort((a, b) => a.distance - b.distance);
  // ── THE LETTERS INSIDE ARE PART OF THE SYMBOL ──
  // A footprint a quarter larger than the template's, because the match box
  // is the strokes' extent and a letter can sit at the rim.
  // An empty symbol's matches are empty too: Baker's E0.02 prints XXXXXX in a
  // box the shape of a troffer's, in its legend of tags.
  const labelled = made.label === null ? matches.filter((m) => !made.blank || !textInside(text, m.box)) : matches.filter((m) => {
    const w = m.box.x2 - m.box.x1, h = m.box.y2 - m.box.y1;
    return labelInside(text, { x1: m.box.x1 - w / 4, y1: m.box.y1 - h / 4, x2: m.box.x2 + w / 4, y2: m.box.y2 + h / 4 }) === made.label;
  });
  // ── AND SO IS THE TYPE TAG BESIDE IT ──
  // Decided against the matches: of the tag-like tokens beside the template,
  // the one the matches carry too (an exit sign's "X1" over the switch
  // zone's "LV2" written nearer to it).
  // Letters inside already say what the symbol is, so a tag beside it can only
  // be its neighbour's: an OS sensor by an R1 troffer is still an OS. On another
  // sheet `made.box` means nothing, so the tag decided on the boxed sheet travels.
  const tag = made.label !== null ? null : made.decidedTag !== undefined ? made.decidedTag : tagBeside(text, made.box, sig.radius, labelled);
  const tagged = tag === null ? labelled : labelled.filter((m) => tagsWithin(text, m.box, sig.radius).includes(tag));
  return {
    matches: tagged, template: sig, candidates: first.length, kept: tpl.length, boxed: made.boxed,
    label: made.label, offLabel: matches.length - labelled.length, tag, offTag: labelled.length - tagged.length,
  };
}
