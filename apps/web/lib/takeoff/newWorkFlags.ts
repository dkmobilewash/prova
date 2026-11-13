import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── A WALL WITH A TYPE FLAG ON IT IS NEW WORK, EVEN WHERE THE DEMOLITION PLAN DRAWS IT ──
 *
 * The demolition-plan compare (`planCompare.ts`) sets aside a wall the prior
 * plan also draws: existing to remain. But new work is often done ON an
 * existing wall — furring, a new layer of board — and the drawing says so with
 * a type flag: a short filled bar set square to the wall, touching its face,
 * with a leader running on from the bar to the type code (Wendell A101.2:
 * F2, F4, F7, SW2-1 on existing walls the demolition plan also draws).
 *
 * Read by shape, not by nearness: a code merely NEAR a wall named the wrong
 * walls (the proximity version added 418 ft of junk on training, 2026-11-12).
 * The bar is the drawing's own arrow from the code to the wall.
 */

/** A flag's bar, in page points: this long… */
const BAR_MIN_PT = 6;
const BAR_MAX_PT = 40;
/** …and this thick, at least `BAR_ASPECT` times longer than thick. */
const BAR_THICK_MIN_PT = 1.5;
const BAR_THICK_MAX_PT = 8;
const BAR_ASPECT = 2.5;
/** The code sits beyond the bar's outer end, along its line, within these, in points. */
const CODE_ALONG_PT = 90;
const CODE_ASIDE_PT = 14;
/** The bar's inner end touches the wall: within half its thickness plus this, in points. */
const TOUCH_PT = 4;
/** A wall-type code: letters then a number, maybe a dash or dot part (F2, SW2-1, P08, IW-7). */
const TYPE_CODE = /^[A-Z]{1,3}-?\d{1,2}([.-]\d{1,2})?[A-Z]?$/;

type Text = { str: string; x: number; y: number; width: number; height: number };
type Bar = { ax: number; ay: number; bx: number; by: number; thick: number };

const len = (s: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Filled black bars: two parallel filled edges of one length, close together. */
function bars(segments: readonly StrokeSegment[]): Bar[] {
  const edges = segments.filter((s) => s.fill !== undefined && s.fill <= 0.2 && len(s) >= BAR_MIN_PT && len(s) <= BAR_MAX_PT);
  const out: Bar[] = [];
  for (let i = 0; i < edges.length; i += 1) {
    const s = edges[i]!, L = len(s), ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L;
    for (let j = i + 1; j < edges.length; j += 1) {
      const t = edges[j]!, Lt = len(t);
      if (Math.abs(Lt - L) > 0.15 * L || Math.abs(((t.x2 - t.x1) * ux + (t.y2 - t.y1) * uy) / Lt) < 0.99) continue;
      const d = Math.abs((t.x1 - s.x1) * uy - (t.y1 - s.y1) * ux);
      if (d < BAR_THICK_MIN_PT || d > BAR_THICK_MAX_PT || L / d < BAR_ASPECT) continue;
      const a = (t.x1 - s.x1) * ux + (t.y1 - s.y1) * uy, b = (t.x2 - s.x1) * ux + (t.y2 - s.y1) * uy;
      if (Math.min(L, Math.max(a, b)) - Math.max(0, Math.min(a, b)) < 0.8 * L) continue;
      const mx = ((t.x1 + t.x2) / 2 - (s.x1 + s.x2) / 2) / 2, my = ((t.y1 + t.y2) / 2 - (s.y1 + s.y2) / 2) / 2;
      out.push({ ax: s.x1 + mx, ay: s.y1 + my, bx: s.x2 + mx, by: s.y2 + my, thick: d });
      break;
    }
  }
  return out;
}

/**
 * The runs a type flag points at. `runs` in page-width units; `segments` and
 * `text` in page points, as the sheet gives them.
 */
export function flaggedRuns<T extends Pick<WallCandidate, "x1" | "y1" | "x2" | "y2" | "thicknessFeet">>(
  runs: readonly T[],
  segments: readonly StrokeSegment[],
  text: readonly Text[],
  widthPt: number,
  feetPerUnit: number,
): Set<T> {
  const out = new Set<T>();
  const codes = text.filter((t) => TYPE_CODE.test(t.str.trim())).map((t) => ({ x: t.x + t.width / 2, y: t.y - t.height / 2 }));
  if (codes.length === 0) return out;
  for (const bar of bars(segments)) {
    const L = Math.hypot(bar.bx - bar.ax, bar.by - bar.ay), ux = (bar.bx - bar.ax) / L, uy = (bar.by - bar.ay) / L;
    // Which end is outer: the one the code lies beyond.
    let inner: [number, number] | null = null;
    for (const c of codes) {
      const t = (c.x - bar.ax) * ux + (c.y - bar.ay) * uy, aside = Math.abs((c.x - bar.ax) * uy - (c.y - bar.ay) * ux);
      if (aside > CODE_ASIDE_PT) continue;
      if (t > L && t - L <= CODE_ALONG_PT) inner = [bar.ax, bar.ay];
      else if (t < 0 && -t <= CODE_ALONG_PT) inner = [bar.bx, bar.by];
      if (inner !== null) break;
    }
    if (inner === null) continue;
    const px = inner[0] / widthPt, py = inner[1] / widthPt;
    let best: T | null = null, bestOff = Infinity;
    for (const r of runs) {
      const rl = len(r);
      if (rl === 0) continue;
      const rx = (r.x2 - r.x1) / rl, ry = (r.y2 - r.y1) / rl;
      if (Math.abs(rx * ux + ry * uy) > 0.2) continue; // the bar stands square to the wall
      const along = (px - r.x1) * rx + (py - r.y1) * ry, off = Math.abs((px - r.x1) * ry - (py - r.y1) * rx);
      if (along < 0 || along > rl) continue;
      const reach = r.thicknessFeet / 2 / feetPerUnit + TOUCH_PT / widthPt;
      if (off <= reach && off < bestOff) {
        best = r;
        bestOff = off;
      }
    }
    if (best !== null) out.add(best);
  }
  return out;
}
