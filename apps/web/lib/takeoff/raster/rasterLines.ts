import type { StrokeSegment } from "../wallVectors";
import type { Gray } from "./pgm";
import { fillEdges } from "./fillContours";
import { blur3 } from "./rasterDegrade";

/**
 * ── LINES OFF A SCAN, FOR THE FINDER THAT WAS BUILT FOR VECTORS ──
 *
 * A scanned plan has no path operators, so `sheetStrokes` returns nothing and
 * the wall finder has nothing to pair. This reads straight lines off the
 * bitmap instead and hands them over in the finder's own shape, in POINTS,
 * so everything downstream of the strokes — pairing, grouping, views, the
 * scorer — is the existing pipeline untouched.
 *
 * ── THE METHOD, AND WHY NOT HOUGH ──
 *
 * Plan line work is overwhelmingly axis-aligned: walls, grid lines, the
 * border. So: binarise, then walk every row for runs of dark pixels, and
 * merge runs that sit on top of each other row after row into BANDS. A band
 * is one drawn line (thin: a face of a wall, a grid line) or one filled area
 * (thick: a poché wall, a title-block fill). Columns the same way for the
 * verticals. That is one pass over the pixels, no parameter but a threshold
 * and a shortest length, and it degrades gracefully on a skewed scan because
 * a tilted line still overlaps itself from one row to the next.
 *
 * A band becomes one segment from the row where its ink starts to the row
 * where it ends — corner to corner, so a line tilted by a scanner comes out
 * tilted and a square one comes out flat. A thick band whose rows are all
 * full is a FILLED shape, and the finder wants its two faces — so it becomes
 * two segments, one along each edge, which is the pair a drawn wall would
 * have produced.
 *
 * ── TWO THRESHOLDS, BECAUSE INK AND FILL ARE NOT THE SAME GREY ──
 *
 * Lines are dark; a poché wall or an existing-building fill is light grey,
 * lighter than a scan's speckle after the optics blur it. One threshold
 * cannot have both: loose enough for the fills, it reads noise as line work
 * (measured: 2,300 ft of junk on one sheet). So the ink pass runs at the ink
 * threshold, and a second pass on a blurred copy at the fill threshold keeps
 * ONLY the thick filled bands — the blur takes the specks out, and a thin
 * band in that pass is a line the ink pass already has.
 *
 * Diagonal walls are NOT found by this pass — see the report. The keys say
 * how much footage that is.
 */

export type RasterLinesOptions = {
  /** Pixels per inch of the raster. Sets the shortest run worth keeping and the line-width cutoff. */
  dpi: number;
  /** Below this grey value a pixel is ink. 160 of 255 by default: a scan's ink is never pure black. */
  threshold?: number;
  /** The shortest line worth reporting, in inches on the sheet. 0.15 in by default — shorter is lettering and hatch. */
  minLengthInches?: number;
  /** A band thicker than this, in inches, is a filled shape rather than a line. 0.04 in (≈3 pt) by default. */
  maxLineInches?: number;
  /** Below this grey a pixel of the BLURRED page belongs to a fill. 245 by default; 0 turns the fill pass off. */
  fillThreshold?: number;
  /** How fills become faces: `"runs"` (bands of the blurred page) or `"contour"` (edges of hole-filled shapes, `fillContours.ts`). Contour by default. */
  fills?: "runs" | "contour";
};

type Run = { from: number; to: number };
type Band = { rows: number; first: number; last: number; min: number; max: number; minAt: number; maxAt: number; runLen: number; extent: number; open: boolean };

export type RasterLine = StrokeSegment & { width: number; axis: "h" | "v"; filled: boolean };

/** Runs of ink along one line of pixels (a row, or a column via the step). */
function runsAlong(data: Uint8Array, start: number, step: number, count: number, threshold: number, minLen: number): Run[] {
  const runs: Run[] = [];
  let from = -1;
  for (let i = 0; i < count; i += 1) {
    const ink = data[start + i * step] < threshold;
    if (ink && from < 0) from = i;
    if (!ink && from >= 0) {
      if (i - from >= minLen) runs.push({ from, to: i - 1 });
      from = -1;
    }
  }
  if (from >= 0 && count - from >= minLen) runs.push({ from, to: count - 1 });
  return runs;
}

/**
 * Bands from the runs of successive lines.
 *
 * A run joins the band it overlaps by a third of the shorter one's length: a
 * line tilted by a degree only overlaps itself about half a run from one row
 * to the next. One run per band per line for ink — two lines side by side
 * are two bands.
 *
 * KNOWN LIMIT, measured and left: the lettering inside a grey room splits
 * that row's run, so a filled room comes out as several bands and the fill
 * pass draws an edge at each line of text. Letting a band take several runs
 * per line was tried and merges the rooms ACROSS the walls between them
 * (A100: the found footage fell by two thirds). The fix is a contour of the
 * fill rather than runs — see the report's production plan.
 */
function bandsFrom(lines: Run[][]): Band[] {
  const done: Band[] = [];
  let active: Band[] = [];
  lines.forEach((runs, line) => {
    const next: Band[] = [];
    for (const run of runs) {
      const len = run.to - run.from + 1;
      const band = active.find((b) => b.open && Math.min(b.max, run.to) - Math.max(b.min, run.from) + 1 >= 0.3 * Math.min(len, b.max - b.min + 1));
      if (band) {
        band.open = false; // taken this line; reopened below
        band.rows += 1;
        band.last = line;
        if (run.from < band.min) {
          band.min = run.from;
          band.minAt = line;
        }
        if (run.to > band.max) {
          band.max = run.to;
          band.maxAt = line;
        }
        band.runLen += len;
        next.push(band);
      } else {
        next.push({ rows: 1, first: line, last: line, min: run.from, max: run.to, minAt: line, maxAt: line, runLen: len, extent: 0, open: true });
      }
    }
    for (const b of active) if (b.open) done.push(b);
    for (const b of next) b.open = true;
    active = next;
  });
  done.push(...active);
  for (const b of done) b.extent = b.max - b.min + 1;
  return done;
}

export function rasterLines(gray: Gray, options: RasterLinesOptions): RasterLine[] {
  const { width, height, data } = gray;
  const threshold = options.threshold ?? 200;
  const fillThreshold = options.fillThreshold ?? 245;
  const minLen = Math.max(3, Math.round((options.minLengthInches ?? 0.15) * options.dpi));
  const maxLine = Math.max(1, Math.round((options.maxLineInches ?? 0.04) * options.dpi));
  const ptPerPx = 72 / options.dpi;
  const out: RasterLine[] = [];

  const emit = (band: Band, axis: "h" | "v", fillsOnly: boolean) => {
    const thickness = band.last - band.first + 1;
    const meanRun = band.runLen / band.rows;
    const filled = thickness > maxLine && meanRun >= 0.8 * band.extent;
    const seg = (a1: number, l1: number, a2: number, l2: number, w: number, isFilled: boolean) => {
      // `a` runs along the axis, `l` across it; swap for verticals.
      const [x1, y1, x2, y2] = axis === "h" ? [a1, l1, a2, l2] : [l1, a1, l2, a2];
      out.push({ x1: x1 * ptPerPx, y1: y1 * ptPerPx, x2: x2 * ptPerPx, y2: y2 * ptPerPx, width: w * ptPerPx, axis, filled: isFilled });
    };
    if (filled) {
      // Two faces, one along each edge of the fill.
      seg(band.min, band.first + 0.5, band.max + 1, band.first + 0.5, 1, true);
      seg(band.min, band.last + 0.5, band.max + 1, band.last + 0.5, 1, true);
    } else if (!fillsOnly) {
      // Corner to corner: the row where the ink starts to the row where it
      // ends. Flat for a square line, tilted for a skewed one. A tall thin
      // band's drawn width is its thickness over the rows the tilt spreads it.
      const w = thickness <= maxLine ? thickness : Math.max(1, meanRun > 0 ? thickness / Math.max(1, band.extent / meanRun) : 1);
      seg(band.min, band.minAt + 0.5, band.max + 1, band.maxAt + 0.5, w, false);
    }
  };

  const pass = (page: Uint8Array, cut: number, fillsOnly: boolean) => {
    const rows: Run[][] = [];
    for (let y = 0; y < height; y += 1) rows.push(runsAlong(page, y * width, 1, width, cut, minLen));
    for (const band of bandsFrom(rows)) emit(band, "h", fillsOnly);
    const cols: Run[][] = [];
    for (let x = 0; x < width; x += 1) cols.push(runsAlong(page, x, width, height, cut, minLen));
    for (const band of bandsFrom(cols)) emit(band, "v", fillsOnly);
  };
  pass(data, threshold, false);
  if (fillThreshold > 0) {
    if ((options.fills ?? "contour") === "contour") {
      // The fill's outline as thin ink, through the same bands; every band
      // is a face of a fill, so it is marked so.
      const { edges } = fillEdges(gray, { fillThreshold, dpi: options.dpi });
      const before = out.length;
      pass(edges.data, 128, false);
      for (let i = before; i < out.length; i += 1) out[i].filled = true;
    } else {
      pass(blur3(gray).data, fillThreshold, true);
    }
  }
  return out;
}

/** The page size the finder wants, in points, from the raster's pixels. */
export function pageSizeOf(gray: Gray, dpi: number): { widthPt: number; heightPt: number } {
  return { widthPt: (gray.width * 72) / dpi, heightPt: (gray.height * 72) / dpi };
}

/**
 * The scan's tilt, from the lines themselves: the median angle of the long
 * ones off their nearest axis. A sheet off the glass by a degree returns
 * about a degree; a square sheet returns about zero. Degrees, positive
 * meaning the same sense `skew()` applies.
 */
export function estimateSkewDegrees(lines: readonly StrokeSegment[], minLengthPt = 216): number {
  const angles: number[] = [];
  for (const l of lines) {
    const dx = l.x2 - l.x1;
    const dy = l.y2 - l.y1;
    if (Math.hypot(dx, dy) < minLengthPt) continue;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Fold onto the nearest axis: -45..45 about horizontal or vertical.
    deg = ((deg % 90) + 90) % 90;
    if (deg > 45) deg -= 90;
    angles.push(deg);
  }
  if (angles.length === 0) return 0;
  angles.sort((a, b) => a - b);
  return angles[Math.floor(angles.length / 2)];
}
