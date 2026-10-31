import { faceDash, isDashPattern } from "./dashedFaces";
import { faceStrokes } from "./existingWalls";
import { hatchedRuns } from "./stageGroups";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── THE USER SAYS WHICH WALLS ARE NOT THE JOB, AND THE SHEET IS READ THE WAY THEY DRAW IT ──
 *
 * Every rule that tried to tell an existing wall from a new one on an
 * unseen renovation sheet has failed the held-out test (NOTES.md,
 * 2026-10-30: existing-walls removed 17 ft there, the grey-pen rule took
 * 334 ft of new wall, the dimension-string rule 139). The person reading
 * the sheet can tell at a glance, because the drafter drew the two kinds
 * differently and the legend — or habit — says which is which. So two
 * tools, both SHEET-RELATIVE and never carried to another sheet:
 *
 *   1. EXCLUDE WALLS LIKE THIS. One click on an offered wall; every offered
 *      wall on the sheet drawn the same way is set aside "excluded by you":
 *      the same pen grey band, the same weight band relative to the sheet,
 *      dashed or not, filled grey, filled white or outline, hatched or not,
 *      and a thickness within a band of the clicked one. A count and a
 *      one-click undo. The style is the one the census read
 *      (`realplan/zzExistingCensus.eval.ts`), which is what the drafter
 *      varies between new and existing.
 *   2. WORK AREA. One or more polygons for the area of work; a wall wholly
 *      outside is set aside "outside the work area", one that crosses the
 *      boundary is split at it and only the inside part is offered.
 *
 * Pure, so each has a test and the simulation
 * (`realplan/zzUserAssist.eval.ts`) can play the user from the labels.
 */

export type Line = { x1: number; y1: number; x2: number; y2: number };

/** A wall's drawing style, in bands, read off its face strokes. */
export type WallStyle = {
  /** black (< 0.1), mid, light (≥ 0.6) — the bands the grey-pen census used. */
  grey: "black" | "mid" | "light";
  /** Against the sheet's length-weighted median pen: thin (< 0.7×), usual, heavy (> 1.5×). */
  weight: "thin" | "usual" | "heavy";
  dashed: boolean;
  /** How the band between the faces is drawn. */
  fill: "outline" | "white" | "grey";
  hatched: boolean;
  thicknessFeet: number;
};

/** Two thicknesses are "like" each other within an inch or 15%, whichever is more. */
export const THICKNESS_BAND_FEET = 1 / 12;
export const THICKNESS_BAND_SHARE = 0.15;

const len = (s: Line) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const median = (xs: number[]) => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]);

/** The sheet's length-weighted median face pen width, for the weight band. */
export function sheetMedianPen(runs: readonly WallCandidate[], segments: readonly StrokeSegment[], feetPerUnit: number): number {
  const widths: number[] = [];
  for (const w of runs) {
    for (const s of [...faceStrokes(w, 1, segments, feetPerUnit), ...faceStrokes(w, -1, segments, feetPerUnit)]) {
      for (let i = 0; i < Math.max(1, Math.round(len(s) * feetPerUnit)); i += 1) widths.push(s.width ?? 0);
    }
  }
  return median(widths);
}

export function wallStyles(runs: readonly WallCandidate[], segments: readonly StrokeSegment[], feetPerUnit: number): Map<WallCandidate, WallStyle> {
  const medianPen = sheetMedianPen(runs, segments, feetPerUnit);
  const hatched = hatchedRuns(runs, segments, feetPerUnit);
  const out = new Map<WallCandidate, WallStyle>();
  for (const w of runs) {
    const faces = [...faceStrokes(w, 1, segments, feetPerUnit), ...faceStrokes(w, -1, segments, feetPerUnit)];
    const weighted = (f: (s: StrokeSegment) => number | undefined) => {
      const xs: number[] = [];
      for (const s of faces) {
        const v = f(s);
        if (v === undefined) continue;
        for (let i = 0; i < Math.max(1, Math.round(len(s) * feetPerUnit)); i += 1) xs.push(v);
      }
      return xs;
    };
    const gray = median(weighted((s) => s.gray ?? 0));
    const width = median(weighted((s) => s.width ?? 0));
    const faceLen = faces.reduce((n, s) => n + len(s), 0);
    const filledLen = faces.filter((s) => s.fill !== undefined).reduce((n, s) => n + len(s), 0);
    const fills = weighted((s) => s.fill);
    const fillGray = fills.length === 0 ? null : median(fills);
    out.set(w, {
      grey: gray < 0.1 ? "black" : gray >= 0.6 ? "light" : "mid",
      weight: medianPen > 0 && width < 0.7 * medianPen ? "thin" : medianPen > 0 && width > 1.5 * medianPen ? "heavy" : "usual",
      dashed: isDashPattern(faceDash(w, 1, segments, feetPerUnit)) || isDashPattern(faceDash(w, -1, segments, feetPerUnit)),
      fill: faceLen > 0 && filledLen >= 0.4 * faceLen && fillGray !== null ? (fillGray >= 0.99 ? "white" : "grey") : "outline",
      hatched: hatched.has(w),
      thicknessFeet: w.thicknessFeet,
    });
  }
  return out;
}

export function sameStyle(a: WallStyle, b: WallStyle): boolean {
  return (
    a.grey === b.grey &&
    a.weight === b.weight &&
    a.dashed === b.dashed &&
    a.fill === b.fill &&
    a.hatched === b.hatched &&
    Math.abs(a.thicknessFeet - b.thicknessFeet) <= Math.max(THICKNESS_BAND_FEET, THICKNESS_BAND_SHARE * Math.max(a.thicknessFeet, b.thicknessFeet))
  );
}

/** A clicked line names the offered run it lies on: same place within 1 ft, same direction, overlapping. */
export function runAt(click: Line, runs: readonly WallCandidate[], feetPerUnit: number): WallCandidate | null {
  const reach = 1 / feetPerUnit;
  let best: { w: WallCandidate; d: number } | null = null;
  for (const w of runs) {
    const dl = len(w), cl = len(click);
    if (dl === 0 || cl === 0) continue;
    const cos = Math.abs(((w.x2 - w.x1) * (click.x2 - click.x1) + (w.y2 - w.y1) * (click.y2 - click.y1)) / (dl * cl));
    if (cos < 0.97) continue;
    const mid = { x: (click.x1 + click.x2) / 2, y: (click.y1 + click.y2) / 2 };
    const t = ((mid.x - w.x1) * (w.x2 - w.x1) + (mid.y - w.y1) * (w.y2 - w.y1)) / (dl * dl);
    if (t < -0.05 || t > 1.05) continue;
    const d = Math.abs((w.x2 - w.x1) * (w.y1 - mid.y) - (w.x1 - mid.x) * (w.y2 - w.y1)) / dl;
    if (d <= reach && (best === null || d < best.d)) best = { w, d };
  }
  return best?.w ?? null;
}

/**
 * Every offered run drawn like the clicked ones. `clicks` are the walls the
 * user clicked, as lines (so a click survives a re-detection); each names
 * the run it lies on, and that run's style is the pattern.
 */
export function wallsLikeThese(clicks: readonly Line[], runs: readonly WallCandidate[], segments: readonly StrokeSegment[], feetPerUnit: number): { excluded: Set<WallCandidate>; patterns: WallStyle[] } {
  const excluded = new Set<WallCandidate>();
  const patterns: WallStyle[] = [];
  if (clicks.length === 0 || runs.length === 0) return { excluded, patterns };
  const styles = wallStyles(runs, segments, feetPerUnit);
  for (const click of clicks) {
    const target = runAt(click, runs, feetPerUnit);
    if (target === null) continue;
    const pattern = styles.get(target);
    if (pattern === undefined) continue;
    patterns.push(pattern);
    for (const [w, s] of styles) if (sameStyle(s, pattern)) excluded.add(w);
  }
  return { excluded, patterns };
}

/** The words for a pattern, for the panel: "light grey, usual pen, outline, 8 in". */
export function describeStyle(s: WallStyle): string {
  const parts = [
    s.grey === "black" ? "black" : s.grey === "light" ? "light grey" : "grey",
    `${s.weight} pen`,
    s.dashed ? "dashed" : null,
    s.fill === "outline" ? "outline" : s.fill === "white" ? "white fill" : "grey fill",
    s.hatched ? "hatched" : null,
    `${Math.round(s.thicknessFeet * 12)} in`,
  ];
  return parts.filter((p): p is string => p !== null).join(", ");
}

/**
 * The user's exclusions as `TakeoffSheetExclusion` holds them: `WORK_AREA` a
 * polygon, `EXCLUDE_LIKE` the line of the clicked wall, page-width units.
 * Null when the page has none, so a caller can leave the field out and
 * detect as before.
 */
export function userExclusionsFromRows(rows: readonly { kind: string; xs: readonly number[]; ys: readonly number[] }[]): { excludeLike: Line[]; workArea: Polygon[] } | null {
  const excludeLike: Line[] = [];
  const workArea: Polygon[] = [];
  for (const r of rows) {
    if (r.kind === "EXCLUDE_LIKE" && r.xs.length >= 2 && r.ys.length >= 2) excludeLike.push({ x1: r.xs[0], y1: r.ys[0], x2: r.xs[1], y2: r.ys[1] });
    else if (r.kind === "WORK_AREA" && r.xs.length >= 3 && r.ys.length >= 3) workArea.push({ xs: [...r.xs], ys: [...r.ys] });
  }
  return excludeLike.length === 0 && workArea.length === 0 ? null : { excludeLike, workArea };
}

// ── THE WORK AREA ──

export type Polygon = { xs: readonly number[]; ys: readonly number[] };

/** No work area drawn means the whole sheet is the job. */
export function insideWorkArea(x: number, y: number, polygons: readonly Polygon[]): boolean {
  return polygons.length === 0 || polygons.some((p) => insidePolygon(x, y, p));
}

/**
 * Doors and windows inside the work area. `join.openings` runs index for index
 * with `doors`, so the two are filtered together. Page-width units, like the polygons.
 */
export function openingsInWorkArea<
  D extends { hinge: { x: number; y: number }; strike: { x: number; y: number } },
  W extends { x1: number; y1: number; x2: number; y2: number },
  J extends { openings: readonly unknown[] },
  R extends { doors: D[]; windows: W[]; join: J | null },
>(result: R, polygons: readonly Polygon[]): R {
  if (polygons.length === 0) return result;
  const keep = result.doors.map((d) => insideWorkArea((d.hinge.x + d.strike.x) / 2, (d.hinge.y + d.strike.y) / 2, polygons));
  return {
    ...result,
    doors: result.doors.filter((_, i) => keep[i]),
    windows: result.windows.filter((w) => insideWorkArea((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, polygons)),
    join: result.join === null ? null : { ...result.join, openings: result.join.openings.filter((_, i) => keep[i]) },
  };
}

export function insidePolygon(px: number, py: number, p: Polygon): boolean {
  let inside = false;
  const n = p.xs.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    if (p.ys[i] > py !== p.ys[j] > py && px < ((p.xs[j] - p.xs[i]) * (py - p.ys[i])) / (p.ys[j] - p.ys[i]) + p.xs[i]) inside = !inside;
  }
  return inside;
}

/** The parameter values along the line where it crosses the polygon's edges, plus 0 and 1, sorted. */
function cuts(line: Line, polygons: readonly Polygon[]): number[] {
  const ts = new Set<number>([0, 1]);
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
  for (const p of polygons) {
    const n = p.xs.length;
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      const ex = p.xs[i] - p.xs[j], ey = p.ys[i] - p.ys[j];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p.xs[j] - line.x1) * ey - (p.ys[j] - line.y1) * ex) / den;
      const u = ((p.xs[j] - line.x1) * dy - (p.ys[j] - line.y1) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.add(t);
    }
  }
  return [...ts].sort((a, b) => a - b);
}

export type WorkAreaResult = {
  /** Runs wholly inside, as they were. */
  inside: WallCandidate[];
  /** The inside parts of runs the boundary crossed, as new runs. */
  split: { from: WallCandidate; piece: WallCandidate }[];
  /** Runs wholly outside, and the outside feet of split runs. */
  outside: WallCandidate[];
  outsideFeet: number;
};

/**
 * Keep what the work area covers. A straight run is cut at every boundary
 * crossing and each piece judged by its midpoint; a curved run (whose
 * endpoints are only its chord) is kept or set aside whole by its midpoint.
 */
export function clipToWorkArea(runs: readonly WallCandidate[], polygons: readonly Polygon[], feetPerUnit: number): WorkAreaResult {
  const out: WorkAreaResult = { inside: [], split: [], outside: [], outsideFeet: 0 };
  if (polygons.length === 0) {
    out.inside.push(...runs);
    return out;
  }
  const inAny = (x: number, y: number) => insideWorkArea(x, y, polygons);
  for (const w of runs) {
    if (w.curved === true) {
      if (inAny((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2)) out.inside.push(w);
      else {
        out.outside.push(w);
        out.outsideFeet += w.lengthFeet;
      }
      continue;
    }
    const ts = cuts(w, polygons);
    const pieces: { t0: number; t1: number; in: boolean }[] = [];
    for (let i = 1; i < ts.length; i += 1) {
      const t0 = ts[i - 1], t1 = ts[i];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      pieces.push({ t0, t1, in: inAny(w.x1 + (w.x2 - w.x1) * tm, w.y1 + (w.y2 - w.y1) * tm) });
    }
    if (pieces.every((p) => p.in)) {
      out.inside.push(w);
      continue;
    }
    if (pieces.every((p) => !p.in)) {
      out.outside.push(w);
      out.outsideFeet += w.lengthFeet;
      continue;
    }
    // Merge adjacent inside pieces, then make a run of each.
    const l = len(w);
    let open: { t0: number; t1: number } | null = null;
    const spans: { t0: number; t1: number }[] = [];
    for (const p of pieces) {
      if (p.in) {
        if (open !== null && Math.abs(open.t1 - p.t0) < 1e-9) open.t1 = p.t1;
        else {
          open = { t0: p.t0, t1: p.t1 };
          spans.push(open);
        }
      } else {
        open = null;
        out.outsideFeet += (p.t1 - p.t0) * l * feetPerUnit;
      }
    }
    for (const sp of spans) {
      const piece: WallCandidate = {
        ...w,
        x1: w.x1 + (w.x2 - w.x1) * sp.t0,
        y1: w.y1 + (w.y2 - w.y1) * sp.t0,
        x2: w.x1 + (w.x2 - w.x1) * sp.t1,
        y2: w.y1 + (w.y2 - w.y1) * sp.t1,
        lengthFeet: (sp.t1 - sp.t0) * l * feetPerUnit,
      };
      delete (piece as { openings?: unknown }).openings;
      out.split.push({ from: w, piece });
    }
  }
  return out;
}
