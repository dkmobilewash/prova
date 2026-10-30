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
  /**
   * A white gap along a run no longer than this, in inches, is bridged — 0.08 in
   * by default. A drawn face is interrupted where a joining wall meets it (the
   * join's width, 3-8 in on the sheet is 0.03-0.08 in at 1/8"), and on a scan
   * by dropouts; a door is 2 ft. Bridging happens AFTER the shortest-run cut,
   * so the dashes of a dashed line, each shorter than that cut, never join.
   */
  maxGapInches?: number;
  /**
   * A second ink pass for FAINT lines: below this grey a pixel is faint ink,
   * 228 by default, and only runs at least `faintMinLengthInches` long count —
   * a hairline face a scanner blurred to grey 210 is long, a blurred speck
   * (227 at the centre of a 3×3 blur of one black pixel) is three pixels.
   * Faint lines the ink pass already found are not reported twice. 0 turns it off.
   */
  faintThreshold?: number;
  /** The shortest faint run worth keeping, in inches. 0.5 by default. */
  faintMinLengthInches?: number;
};

type Run = { from: number; to: number };
type Band = { rows: number; first: number; last: number; min: number; max: number; minAt: number; maxAt: number; runLen: number; extent: number; open: boolean };

export type RasterLine = StrokeSegment & { width: number; axis: "h" | "v"; filled: boolean };

/** Runs of ink along one line of pixels (a row, or a column via the step). */
function runsAlong(data: Uint8Array, start: number, step: number, count: number, threshold: number, minLen: number, maxGap = 0): Run[] {
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
  if (maxGap <= 0 || runs.length < 2) return runs;
  // ── BRIDGE THE SMALL GAPS, between runs that each stood on their own ──
  // A face line is cut where a joining wall meets it and, on a scan, where
  // the ink dropped out; the finder pairs faces by their overlap, and a face
  // in four pieces pairs with nothing. Only runs that passed the shortest-run
  // cut are joined, so a dashed line's dashes never become a solid one.
  const joined: Run[] = [runs[0]];
  for (let i = 1; i < runs.length; i += 1) {
    const last = joined[joined.length - 1];
    if (runs[i].from - last.to - 1 <= maxGap) last.to = runs[i].to;
    else joined.push(runs[i]);
  }
  return joined;
}

/**
 * The lines in `fresh` that no line in `have` already covers: same axis,
 * within `tolPx` across it, overlapping it along at least half of `fresh`'s
 * own length. A thick drawn line is found three times without this — once by
 * the ink pass along its middle and once per EDGE by the contour pass — and
 * the finder then pairs the two edges into a wall three inches thick, the
 * whole length of the line. On Crosslines A100 that was 187 ft of "wall"
 * along a dimension line, twice. The same check keeps the faint pass from
 * re-reporting what the ink pass found.
 */
function notCoveredBy(fresh: RasterLine[], have: RasterLine[], slackPt: number): RasterLine[] {
  const across = (l: RasterLine) => (l.axis === "h" ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2);
  const along = (l: RasterLine): [number, number] => (l.axis === "h" ? [Math.min(l.x1, l.x2), Math.max(l.x1, l.x2)] : [Math.min(l.y1, l.y2), Math.max(l.y1, l.y2)]);
  const byAxis = { h: [] as RasterLine[], v: [] as RasterLine[] };
  for (const l of have) byAxis[l.axis].push(l);
  for (const k of ["h", "v"] as const) byAxis[k].sort((a, b) => across(a) - across(b));
  const keys = { h: byAxis.h.map(across), v: byAxis.v.map(across) };
  const lowerBound = (arr: number[], v: number) => {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
    return lo;
  };
  return fresh.filter((f) => {
    const m = across(f);
    const [a1, a2] = along(f);
    const len = a2 - a1;
    const list = byAxis[f.axis], ks = keys[f.axis];
    // Within the EXISTING line's own half-width plus a pixel or two: the edge
    // of a thick line sits half its width from the middle the ink pass found.
    // Not a fixed band — the two faces of a thin partition are 7 px apart at
    // 200 dpi and 1/8", and a band that wide dropped the fainter face as a
    // copy of the darker one (Crosslines A100: 1,098 ft of key wall with
    // lines under it and no candidate).
    const reach = Math.max(...list.map((l) => l.width / 2)) + slackPt;
    for (let i = lowerBound(ks, m - reach); i < ks.length && ks[i] <= m + reach; i += 1) {
      if (Math.abs(ks[i] - m) > list[i].width / 2 + slackPt) continue;
      const [b1, b2] = along(list[i]);
      if (Math.min(a2, b2) - Math.max(a1, b1) >= 0.5 * len) return false;
    }
    return true;
  });
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
  const maxGap = Math.round((options.maxGapInches ?? 0.08) * options.dpi);
  const faintThreshold = options.faintThreshold ?? 228;
  const faintMinLen = Math.max(minLen, Math.round((options.faintMinLengthInches ?? 0.5) * options.dpi));
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

  const pass = (page: Uint8Array, cut: number, fillsOnly: boolean, shortest = minLen) => {
    const rows: Run[][] = [];
    for (let y = 0; y < height; y += 1) rows.push(runsAlong(page, y * width, 1, width, cut, shortest, maxGap));
    for (const band of bandsFrom(rows)) emit(band, "h", fillsOnly);
    const cols: Run[][] = [];
    for (let x = 0; x < width; x += 1) cols.push(runsAlong(page, x, width, height, cut, shortest, maxGap));
    for (const band of bandsFrom(cols)) emit(band, "v", fillsOnly);
  };
  // Lines a later pass finds that an earlier one already has are dropped —
  // within a line's own thickness across, covering half its length along.
  const slackPt = 1.5 * ptPerPx;
  const addNew = (from: number) => {
    const fresh = out.splice(from);
    out.push(...notCoveredBy(fresh, out, slackPt));
  };
  /**
   * Faint lines standing in a FIELD of parallels are hatch, not faces. The
   * blur that greys a hairline face greys a hatch pattern's lines the same,
   * and Bunkie A100's existing building — hatched at a tenth of an inch — came
   * out of the faint pass as 1,137 ft of long thin "wall". A wall face has one
   * parallel neighbour, the other face; a hatch line has them on both sides.
   */
  const notInAField = (fresh: RasterLine[], all: RasterLine[]): RasterLine[] => {
    const reachPt = 0.2 * 72;
    const across = (l: RasterLine) => (l.axis === "h" ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2);
    const along = (l: RasterLine): [number, number] => (l.axis === "h" ? [Math.min(l.x1, l.x2), Math.max(l.x1, l.x2)] : [Math.min(l.y1, l.y2), Math.max(l.y1, l.y2)]);
    const byAxis = { h: all.filter((l) => l.axis === "h").sort((a, b) => across(a) - across(b)), v: all.filter((l) => l.axis === "v").sort((a, b) => across(a) - across(b)) };
    const keys = { h: byAxis.h.map(across), v: byAxis.v.map(across) };
    return fresh.filter((f) => {
      const m = across(f);
      const [a1, a2] = along(f);
      const len = a2 - a1;
      const ks = keys[f.axis], list = byAxis[f.axis];
      let lo = 0, hi = ks.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (ks[mid] < m - reachPt) lo = mid + 1; else hi = mid; }
      let before = 0, after = 0;
      for (let i = lo; i < ks.length && ks[i] <= m + reachPt; i += 1) {
        if (list[i] === f) continue;
        const [b1, b2] = along(list[i]);
        if (Math.min(a2, b2) - Math.max(a1, b1) < 0.5 * len) continue;
        if (ks[i] < m) before += 1; else after += 1;
      }
      return !(before >= 1 && after >= 1 && before + after >= 3);
    });
  };
  pass(data, threshold, false);
  if (faintThreshold > 0 && faintThreshold > threshold) {
    // ── THE FAINT PASS: hairlines a scanner greyed past the ink threshold ──
    // Measured on six training sheets rasterised and blurred like a scan:
    // 3,013 ft of key wall had NO line under it at the ink threshold, 2,562
    // of them on Crosslines A100, whose partition faces are 0.4-pt hairlines
    // — one pixel at 200 dpi, grey 210 after the blur. Long runs only, so a
    // speck (227 at its centre, three pixels wide) is never one.
    const before = out.length;
    pass(data, faintThreshold, false, faintMinLen);
    const faint = notCoveredBy(out.splice(before), out, slackPt);
    out.push(...notInAField(faint, [...out, ...faint]));
  }
  if (fillThreshold > 0) {
    if ((options.fills ?? "contour") === "contour") {
      // The fill's outline as thin ink, through the same bands; every band
      // is a face of a fill, so it is marked so. A thick LINE is a fill to
      // the contour too, and its two edges would come out beside the middle
      // the ink pass found — see `notCoveredBy`.
      const { edges } = fillEdges(gray, { fillThreshold, dpi: options.dpi });
      const before = out.length;
      pass(edges.data, 128, false);
      for (let i = before; i < out.length; i += 1) out[i].filled = true;
      addNew(before);
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
