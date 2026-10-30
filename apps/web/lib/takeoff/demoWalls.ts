import { insideView, sheetDrawings } from "./sheetViews";
import { tagByRun, wallTypeTags } from "./wallTags";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── WALLS TO BE REMOVED, READ OFF A DEMOLITION PLAN ──
 *
 * A demolition plan draws a wall to go as two parallel DASHED lines, and the
 * wall finder is built to set exactly that aside. So this does not start from
 * the finder. It strings short collinear strokes into dashed lines, then pairs
 * dashed lines that sit a wall's thickness apart.
 *
 * Lengths here are PAPER inches, because a dash is a pen setting and does not
 * change with the drawing's scale. Thickness and run length are in real units.
 * The pairing is what keeps a lone dashed outline (a slab cut, a canopy above)
 * out: nothing a drawing dashes on its own is a wall.
 */

export const DASH_MIN_IN = 0.012;
/** Longer than this is a gridline's long dash or a solid line. */
export const DASH_MAX_IN = 0.4;
export const DASH_GAP_MIN_IN = 0.008;
export const DASH_GAP_MAX_IN = 0.3;
export const DASH_MIN_PIECES = 4;
/** Share of the line's length that is ink. A solid line cut into pieces reads near 1. */
export const DASH_MAX_INK = 0.92;
export const ANGLE_BIN_DEG = 2;
/** Pieces further apart than this across the line are not on one line. */
export const SAME_LINE_IN = 0.02;
export const WALL_MIN_INCHES = 2;
export const WALL_MAX_INCHES = 14;
export const RUN_MIN_FEET = 2;
export const PAIR_MIN_OVERLAP = 0.6;
/** Strokes bridging the two faces per foot of run, above which it is a hatched strip such as a sawcut, not a wall. */
export const HATCH_PER_FOOT = 0.75;
/** A legend's sample sits this close left of its words, and level with them. */
export const SWATCH_REACH_IN = 2.5;
const LEGEND_WORDS = /\b(REMOVE|DEMOLISH|DEMOLISHED|DEMO|TO BE REMOVED)\b/i;

export type DashLine = { theta: number; perp: number; t0: number; t1: number; pieces: number };
export type DemoRun = { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessIn: number; /** The wall type tagged beside it, where the plan tags one. */ tag?: string };

type Piece = { theta: number; perp: number; t0: number; t1: number; pen: number };

/**
 * Read per pen, because a drawing can lay one dashed line twice in two widths
 * with the dashes offset (E Street A1.1: 0.96 pt over 0.48 pt). Together they
 * cover the line, so read as one they look solid and the wall is lost.
 */
const penOf = (s: StrokeSegment) => Math.round((s.width ?? 0) * 100);

/** Dashed lines among the strokes. All values in points. */
export function dashLines(segments: readonly StrokeSegment[]): DashLine[] {
  const pieces: Piece[] = [];
  for (const s of segments) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
    if (len < DASH_MIN_IN * 72 || len > DASH_MAX_IN * 72) continue;
    let theta = Math.atan2(dy, dx);
    if (theta < 0) theta += Math.PI;
    if (theta >= Math.PI) theta -= Math.PI;
    const bin = (Math.round(((theta * 180) / Math.PI) / ANGLE_BIN_DEG) * ANGLE_BIN_DEG) % 180;
    const a = (bin * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    const t1 = s.x1 * ux + s.y1 * uy, t2 = s.x2 * ux + s.y2 * uy;
    pieces.push({ theta: a, perp: -s.x1 * uy + s.y1 * ux, t0: Math.min(t1, t2), t1: Math.max(t1, t2), pen: penOf(s) });
  }
  pieces.sort((p, q) => p.theta - q.theta || p.pen - q.pen || p.perp - q.perp);
  const out: DashLine[] = [];
  let i = 0;
  while (i < pieces.length) {
    let j = i + 1;
    while (j < pieces.length && pieces[j].theta === pieces[i].theta && pieces[j].pen === pieces[i].pen && pieces[j].perp - pieces[j - 1].perp <= SAME_LINE_IN * 72) j += 1;
    const onLine = pieces.slice(i, j).sort((p, q) => p.t0 - q.t0);
    let chain = [onLine[0]], end = onLine[0].t1;
    const flush = () => {
      const t0 = chain[0].t0, span = end - t0;
      const ink = chain.reduce((n, p) => n + (p.t1 - p.t0), 0);
      if (chain.length >= DASH_MIN_PIECES && span > 0 && ink / span <= DASH_MAX_INK) {
        out.push({ theta: chain[0].theta, perp: chain.reduce((n, p) => n + p.perp, 0) / chain.length, t0, t1: end, pieces: chain.length });
      }
    };
    for (const p of onLine.slice(1)) {
      if (p.t0 - end > DASH_GAP_MAX_IN * 72) { flush(); chain = [p]; end = p.t1; continue; }
      chain.push(p);
      end = Math.max(end, p.t1);
    }
    flush();
    i = j;
  }
  return out;
}

/** Pairs of dashed lines a wall's thickness apart, nearest first, each line used once. Page-width units. */
export function demoRuns(
  segments: readonly StrokeSegment[],
  widthPt: number,
  feetPerUnit: number,
  textItems: readonly { str: string; x: number; y: number; height: number }[] = [],
): DemoRun[] {
  if (!(widthPt > 0) || !(feetPerUnit > 0)) return [];
  const feetPerPt = feetPerUnit / widthPt;
  const lines = dashLines(segments);
  const pairs: { a: DashLine; b: DashLine; inches: number; lo: number; hi: number }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i], b = lines[j];
      if (b.theta !== a.theta) break;
      const inches = Math.abs(a.perp - b.perp) * feetPerPt * 12;
      if (inches < WALL_MIN_INCHES || inches > WALL_MAX_INCHES) continue;
      const lo = Math.max(a.t0, b.t0), hi = Math.min(a.t1, b.t1);
      if (hi <= lo || hi - lo < PAIR_MIN_OVERLAP * Math.min(a.t1 - a.t0, b.t1 - b.t0)) continue;
      pairs.push({ a, b, inches, lo, hi });
    }
  }
  pairs.sort((p, q) => p.inches - q.inches);
  const used = new Set<DashLine>();
  const runs: DemoRun[] = [];
  for (const { a, b, inches, lo, hi } of pairs) {
    if (used.has(a) || used.has(b)) continue;
    const lengthFeet = (hi - lo) * feetPerPt;
    if (lengthFeet < RUN_MIN_FEET) continue;
    const ux = Math.cos(a.theta), uy = Math.sin(a.theta), perp = (a.perp + b.perp) / 2;
    const at = (t: number) => ({ x: (t * ux - perp * uy) / widthPt, y: (t * uy + perp * ux) / widthPt });
    const p = at(lo), q = at(hi);
    const run = { x1: p.x, y1: p.y, x2: q.x, y2: q.y, lengthFeet, thicknessIn: inches };
    if (sameWallAs(run, runs, feetPerUnit) || isSwatch(run) || isHatched(a, b, lo, hi)) continue;
    used.add(a); used.add(b);
    runs.push(run);
  }
  return runs;

  function isHatched(a: DashLine, b: DashLine, lo: number, hi: number): boolean {
    const ux = Math.cos(a.theta), uy = Math.sin(a.theta);
    const low = Math.min(a.perp, b.perp), high = Math.max(a.perp, b.perp);
    let bridges = 0;
    for (const s of segments) {
      const p1 = -s.x1 * uy + s.y1 * ux, p2 = -s.x2 * uy + s.y2 * ux;
      const t = ((s.x1 + s.x2) / 2) * ux + ((s.y1 + s.y2) / 2) * uy;
      if (t >= lo && t <= hi && Math.min(p1, p2) <= low + 0.25 * (high - low) && Math.max(p1, p2) >= high - 0.25 * (high - low)) bridges += 1;
    }
    return bridges / Math.max(1, (hi - lo) * feetPerPt) > HATCH_PER_FOOT;
  }

  function isSwatch(run: DemoRun): boolean {
    const rx = Math.max(run.x1, run.x2) * widthPt, ry = ((run.y1 + run.y2) / 2) * widthPt;
    return textItems.some((w) => LEGEND_WORDS.test(w.str) && w.x >= rx && w.x - rx <= SWATCH_REACH_IN * 72 && Math.abs(w.y - w.height / 2 - ry) <= 0.25 * 72);
  }
}

/** A second pen draws the same wall again: the same line, within a foot, mostly overlapping. */
function sameWallAs(run: DemoRun, runs: readonly DemoRun[], feetPerUnit: number): boolean {
  const dx = run.x2 - run.x1, dy = run.y2 - run.y1, len = Math.hypot(dx, dy) || 1e-9, ux = dx / len, uy = dy / len;
  return runs.some((o) => {
    const off = Math.abs(-(((o.x1 + o.x2) / 2) - run.x1) * uy + (((o.y1 + o.y2) / 2) - run.y1) * ux) * feetPerUnit;
    const ou = Math.abs((o.x2 - o.x1) * ux + (o.y2 - o.y1) * uy) / (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1e-9);
    if (off > 1 || ou < 0.98) return false;
    const a = (o.x1 - run.x1) * ux + (o.y1 - run.y1) * uy, b = (o.x2 - run.x1) * ux + (o.y2 - run.y1) * uy;
    return Math.min(Math.max(a, b), len) - Math.max(Math.min(a, b), 0) >= 0.7 * Math.min(len, Math.abs(b - a));
  });
}

// ── DOORS TO GO: THE KEYNOTE THAT SAYS SO ──

const KEYNOTE_CODE = /^[A-Z]{0,2}\d{1,2}(\.\d{1,2})?$/;
const REMOVE_DOOR = /\b(REMOVE|DEMO|DEMOLISH)\b.*\bDOORS?\b(?!\s+HARDWARE)/i;
const KEEP_DOOR = /\bTO REMAIN\b/i;
/** A keynote's code sits this close left of its sentence, level with it. */
const CODE_REACH_IN = 1;
const CODE_LEVEL_IN = 0.08;
const EDGE_SHARE = 0.04;

export type DemoDoor = { x: number; y: number; code: string };

/**
 * A door to go is read from the keynote: a row saying to remove a door names
 * a code, and each copy of that code on the plan points at one. Dashed swing
 * geometry was tried first and rejected: on the training sheets it read 11 on
 * E Street against 3 keynoted, and none on Green Bay, Murray or Crosslines.
 * A code that is also a grid bubble would count the bubble: no training sheet does.
 * A "TYP." note means more doors than tags, so `typical` flags an undercount.
 */
export function demoDoors(textItems: readonly { str: string; x: number; y: number; width: number; height: number }[], widthPt: number): { doors: DemoDoor[]; typical: boolean } {
  const doors: DemoDoor[] = [];
  const codes = new Set<string>();
  // A short code also matches a sheet's border numbers and its revision block.
  const bottom = Math.max(...textItems.map((t) => t.y), 0) / widthPt;
  const inAList = (t: { str: string; x: number; y: number }) =>
    t.x / widthPt < EDGE_SHARE || t.x / widthPt > 1 - EDGE_SHARE || t.y / widthPt < EDGE_SHARE || t.y / widthPt > bottom - EDGE_SHARE / 2 ||
    (/^\d+$/.test(t.str.trim()) && textItems.some((o) => o !== t && /^\d+$/.test(o.str.trim()) && Math.abs(o.x - t.x) <= 3 && Math.abs(o.y - t.y) > 0 && Math.abs(o.y - t.y) <= 30));
  const rows = textItems.filter((t) => REMOVE_DOOR.test(t.str) && !KEEP_DOOR.test(t.str));
  for (const row of rows) {
    const level = row.y - row.height / 2;
    const code = textItems
      .filter((t) => t !== row && KEYNOTE_CODE.test(t.str.trim()) && t.x < row.x && row.x - t.x <= CODE_REACH_IN * 72 && Math.abs(t.y - t.height / 2 - level) <= CODE_LEVEL_IN * 72)
      .sort((a, b) => b.x - a.x)[0];
    if (!code || codes.has(code.str.trim())) continue;
    const name = code.str.trim();
    codes.add(name);
    for (const t of textItems) if (t !== code && t.str.trim() === name && !inAList(t)) doors.push({ x: (t.x + t.width / 2) / widthPt, y: (t.y - t.height / 2) / widthPt, code: name });
  }
  const typical = doors.some((d) => textItems.some((t) => /^TYP\.?$/i.test(t.str.trim()) && Math.hypot(t.x / widthPt - d.x, t.y / widthPt - d.y) <= 0.03));
  return { doors, typical };
}

/** Whether a sheet's title or number says it is a demolition plan. */
export function demoSheetTitle(text: string | null | undefined): boolean {
  return /\bDEMO(LITION)?\b/i.test(text ?? "") || /^(A|AD)?D[-\d]/i.test((text ?? "").trim());
}

const NOT_A_PLAN = /\b(SECTIONS?|ELEVATIONS?|DETAILS?|LEGEND|SCHEDULE)\b/i;

export type DemoSheet = { runs: DemoRun[]; doors: DemoDoor[]; doorsTypical: boolean; skippedViews: string[] };

/**
 * One demolition sheet. A section, elevation or detail dashes its lines too
 * (Bunkie AD101's wall section read as 116 ft), so anything inside a view
 * whose caption says it is not a plan is left out.
 */
export function demoForSheet(input: {
  segments: readonly StrokeSegment[];
  textItems: readonly { str: string; x: number; y: number; width: number; height: number }[];
  widthPt: number;
  heightPt: number;
  feetPerUnit: number;
}): DemoSheet {
  const { segments, textItems, widthPt, heightPt, feetPerUnit } = input;
  const views = sheetDrawings({ items: textItems, segments, pageSize: { widthPt, heightPt } });
  const notPlans = views.filter((v) => NOT_A_PLAN.test(v.name ?? ""));
  const outside = (x: number, y: number) => !notPlans.some((v) => insideView(v, x, y));
  const runs = demoRuns(segments, widthPt, feetPerUnit, textItems).filter((r) => outside((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2));
  const candidates = runs.map((r) => ({ ...r, thicknessFeet: r.thicknessIn / 12 })) as unknown as WallCandidate[];
  const tags = tagByRun(candidates, wallTypeTags(textItems, widthPt), feetPerUnit);
  candidates.forEach((c, i) => { const tag = tags.get(c); if (tag) runs[i].tag = tag; });
  const read = demoDoors(textItems, widthPt);
  return {
    runs,
    doors: read.doors.filter((d) => outside(d.x, d.y)),
    doorsTypical: read.typical,
    skippedViews: notPlans.map((v) => v.name ?? ""),
  };
}
