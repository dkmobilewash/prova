import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── ON A COMPARED RENOVATION SHEET, THE MINORITY GREY PEN IS THE EXISTING BUILDING ──
 *
 * The demolition-plan compare (`planCompare.ts`) sets aside what the prior
 * plan also draws, but misses existing walls it cannot line up (Baker A100,
 * E Street A2.1, Green Bay A3.1, Crosslines). Many renovation sheets draw the
 * existing building in a lighter pen. No pen means "existing" across all sets
 * (NOTES.md, 2026-10-30), so this is read only where the sheet is already
 * known to be a renovation, because it was paired with its demolition plan,
 * and only where grey is the MINORITY pen of what would be offered. Where
 * most of the sheet is grey (Supreme Court A111, every wall grey), grey is
 * just how this sheet draws.
 *
 * Priced on the training renovation sheets (snap 1755, 2026-11-12): 697 ft of
 * junk set aside for 34 ft of real wall (0.63% of real, 20:1).
 */

/** Share of a run's own strokes drawn grey for the run to read as grey. */
export const GREY_RUN_SHARE = 0.8;
/** Grey must be under this share of the sheet's runs, in feet, for it to mean "existing". */
export const GREY_SHEET_MAX = 0.4;
/** A stroke this light or lighter is grey (0 black, 1 white). */
const GREY_PEN = 0.25;

type Run = Pick<WallCandidate, "x1" | "y1" | "x2" | "y2" | "lengthFeet" | "thicknessFeet">;

/** Share of the strokes drawn along `r` that are grey. `segments` in points, `r` in page-width units. */
export function greyShare(r: Run, segments: readonly StrokeSegment[], widthPt: number, feetPerUnit: number): number {
  const L = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
  if (L === 0) return 0;
  const ux = (r.x2 - r.x1) / L, uy = (r.y2 - r.y1) / L, band = Math.max(1, r.thicknessFeet / 2 + 0.5) / feetPerUnit;
  let n = 0, grey = 0;
  for (const g of segments) {
    const gl = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
    if (gl === 0 || Math.abs(((g.x2 - g.x1) * ux + (g.y2 - g.y1) * uy) / gl) <= 0.97) continue;
    const mx = (g.x1 + g.x2) / 2 / widthPt, my = (g.y1 + g.y2) / 2 / widthPt;
    const t = (mx - r.x1) * ux + (my - r.y1) * uy, off = Math.abs((mx - r.x1) * uy - (my - r.y1) * ux);
    if (t < 0 || t > L || off > band) continue;
    n += 1;
    if ((g.gray ?? 0) >= GREY_PEN) grey += 1;
  }
  return n === 0 ? 0 : grey / n;
}

/** The grey runs to set aside as existing, or none when grey is not the minority pen. */
export function greyExistingRuns<T extends Run>(runs: readonly T[], segments: readonly StrokeSegment[], widthPt: number, feetPerUnit: number): T[] {
  const grey = runs.filter((r) => greyShare(r, segments, widthPt, feetPerUnit) >= GREY_RUN_SHARE);
  const all = runs.reduce((n, r) => n + r.lengthFeet, 0);
  if (grey.length === 0 || all === 0 || grey.reduce((n, r) => n + r.lengthFeet, 0) / all >= GREY_SHEET_MAX) return [];
  return grey;
}
