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
export type TextBox = { x: number; y: number; width: number; height: number };

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
/** Strokes closer than this fraction of the box diagonal are one cluster when the template is picked. */
export const TOUCH_FRACTION = 0.03;
const BINS = 8;

type Pt = { x: number; y: number };
const len = (s: StrokeSegment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

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

/** The strokes wholly inside the box. */
export function strokesInBox(segments: readonly StrokeSegment[], box: Box): StrokeSegment[] {
  const x1 = Math.min(box.x1, box.x2), x2 = Math.max(box.x1, box.x2), y1 = Math.min(box.y1, box.y2), y2 = Math.max(box.y1, box.y2);
  const inside = (x: number, y: number) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
  return segments.filter((s) => inside(s.x1, s.y1) && inside(s.x2, s.y2));
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
 * The template laid over the sheet with its `anchorIndex` stroke on `onto`
 * (one of four ways), and how much of its weighted ink lands along a stroke
 * of comparable length. Stops as soon as the floor is out of reach.
 */
export function coverageAt(
  template: readonly StrokeSegment[],
  weights: readonly number[],
  anchorIndex: number,
  onto: StrokeSegment,
  flip: boolean,
  mirror: boolean,
  grid: StrokeGrid,
  radius: number,
  floor = 0,
): { coverage: number; hit: boolean[]; transform: Rigid; origin: Pt } {
  const tol = radius * END_TOLERANCE;
  const anchor = template[anchorIndex]!;
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
  const total = weights.reduce((a, b) => a + b, 0);
  let covered = 0;
  let missed = 0;
  const hit = template.map(() => false);
  // Heaviest strokes first, so a wrong placement fails in two or three tests
  // rather than forty — what makes a 260,000-stroke sheet answer in seconds.
  const order = template.map((_, i) => i).sort((a, b) => weights[b]! - weights[a]!);
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
    for (const flip of [false, true]) for (const mirror of [false, true]) best = Math.max(best, coverageAt(template, weights, ai, onto, flip, mirror, grid, radius).coverage);
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
): { box: Box; detail: ReturnType<typeof coverageAt> }[] {
  // Anchors by weight, longest first among equals — but a length that
  // thousands of strokes on the sheet share (a hatch pitch, an arc piece)
  // says nothing about where the symbol is and costs a placement test each.
  // Such an anchor is skipped while a rarer one exists.
  const byWeight = template.map((_, i) => i).filter((i) => len(template[i]!) > radius * END_TOLERANCE * 2).sort((a, b) => weights[b]! - weights[a]! || len(template[b]!) - len(template[a]!));
  const commonness = (i: number) => {
    const l = len(template[i]!);
    let n = 0;
    for (const k of grid.strokes) if (Math.abs(len(k) - l) <= l * ANCHOR_TOLERANCE) n++;
    return n;
  };
  const rare = byWeight.filter((i) => commonness(i) <= MOST_COMMON_ANCHOR);
  const order = (rare.length > 0 ? rare : [...byWeight].sort((a, b) => commonness(a) - commonness(b))).slice(0, ANCHORS);
  const found: { box: Box; detail: ReturnType<typeof coverageAt> }[] = [];
  // Two placements within a radius of each other are the same symbol seen
  // from two anchors (a circle found from opposite pieces lands half a
  // symbol apart); two real symbols that close would be drawn over each other.
  const same = radius;
  for (const ai of order) {
    const aLen = len(template[ai]!);
    for (const onto of grid.strokes) {
      if (Math.abs(len(onto) - aLen) > aLen * ANCHOR_TOLERANCE) continue;
      let best: ReturnType<typeof coverageAt> | null = null;
      for (const flip of [false, true]) for (const mirror of [false, true]) {
        const d = coverageAt(template, weights, ai, onto, flip, mirror, grid, radius, floor);
        if (d.coverage >= floor && (best === null || d.coverage > best.coverage)) best = d;
      }
      if (best === null) continue;
      const box = footprintOf(template, best.transform, best.origin);
      const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
      const at = found.findIndex((f) => Math.hypot((f.box.x1 + f.box.x2) / 2 - cx, (f.box.y1 + f.box.y2) / 2 - cy) <= same);
      if (at < 0) found.push({ box, detail: best });
      else if (best.coverage > found[at]!.detail.coverage) found[at] = { box, detail: best };
    }
  }
  return found;
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
): { matches: SymbolMatch[]; template: Signature | null; candidates: number; kept: number; boxed: number } {
  const coverage = options.coverage ?? COVERAGE;
  const clean = withoutText(segments, text);
  const own = templateStrokes(clean, template);
  const sig = signatureOf(own);
  if (sig === null) return { matches: [], template: null, candidates: 0, kept: 0, boxed: 0 };
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
  const grid = new StrokeGrid(clean, Math.max(sig.radius * 2, 1e-6));
  // ── THE SYMBOL IS WHAT RECURS ──
  // A first pass finds the instances; a template stroke that lands on fewer
  // than half of them is context and is dropped; the strict pass runs on what
  // is left — only when what recurs is still most of the symbol (a template
  // cut to four strokes matched 22 things on Baker that were not door tags).
  const first = placements(tpl, tpl.map(weightOf), grid, sig.radius, coverage);
  if (first.length >= 3) {
    const votes = tpl.map((_, i) => first.filter((m) => m.detail.hit[i]).length);
    const kept = tpl.filter((_, i) => votes[i]! >= first.length / 2);
    const keptW = kept.reduce((t, k) => t + weightOf(k), 0), allW = tpl.reduce((t, k) => t + weightOf(k), 0);
    if (kept.length >= 3 && keptW >= 0.6 * allW) tpl = kept;
  }
  const matches: SymbolMatch[] = placements(tpl, tpl.map(weightOf), grid, sig.radius, coverage).map(({ box, detail }) => ({ box, distance: 1 - detail.coverage, segments: tpl.length }));
  matches.sort((a, b) => a.distance - b.distance);
  return { matches, template: sig, candidates: first.length, kept: tpl.length, boxed: own.length };
}
