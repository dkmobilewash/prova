import type { StrokeSegment } from "./wallVectors";

/**
 * ── FINDING LINES ON A SHEET THAT HAS NO VECTORS ──
 *
 * Three of the twenty fixtures are scans: zero strokes, zero text, and the
 * pipeline refuses them honestly because there is nothing in the file to read.
 * A real share of real sets are the same — of eleven plan sets on this machine,
 * five carry image-only pages and one is scanned end to end.
 *
 * This finds the LINES. It is deliberately all it does: geometry on this
 * product is computed by code and never by a model (CLAUDE.md), and a bitmap
 * does not change that. Reading the WORDS off a scan — the printed scale, the
 * room names — is interpretation and goes elsewhere.
 *
 * **The output is ordinary `StrokeSegment`s in viewport space**, which is the
 * same thing `sheetStrokes` produces from a vector page: origin top left, y
 * increasing downward, one unit per point. So everything downstream — the
 * scale vote, the wall pairer, the room tracer — works on a scan without
 * knowing it is one, and nothing had to be taught a second coordinate system.
 *
 * **How it is graded, and why that needs no new ground truth.** The three
 * scanned fixtures are rasters of three VECTOR fixtures that are already in
 * this repo — S18 of S02, S19 of S08, S20 of S13, each named in its own title
 * block. So the vector original's own strokes are the answer key: run the
 * vector path on S02 and the raster path on S18 and compare. See
 * `raster.eval.ts`.
 *
 * ponytail: axis-aligned runs only. A diagonal or curved wall is invisible to
 * this, and on a sheet that has them the miss is silent — `diagonalInk` is
 * reported for exactly that reason, so a caller can tell "no diagonals" from
 * "diagonals this cannot see". Upgrade path is a Hough transform if a real set
 * ever needs one; none of the twenty fixtures does.
 */

/** A page's pixels, as a canvas hands them over. */
export type Bitmap = {
  /** Row-major luminance, one byte per pixel, `width * height` long. */
  readonly grey: Uint8Array;
  readonly width: number;
  readonly height: number;
};

export type RasterStrokeOptions = {
  /** Pixels per inch the bitmap was rendered at. 72 points to the inch. */
  dpi: number;
  /**
   * A pixel this dark or darker is ink.
   *
   * A drawing is black on white and the midpoint would do, but a scan's white
   * is never 255 and its black is never 0 — the speckle on S19 lands in the
   * 40s and its paper in the 230s. 160 sits clear of both and is not tuned to
   * either: `darkFraction` is reported so a threshold that has swallowed the
   * page, or found nothing, is visible rather than inferred.
   */
  darkMax?: number;
  /**
   * The shortest run that can be a line, in POINTS rather than pixels, so the
   * same number means the same thing at any dpi.
   *
   * **The first version of this said 6pt and claimed text could not reach it,
   * on the reasoning that a run is CONSECUTIVE ink and lettering is strokes
   * with paper between them. That is true ACROSS a word and false DOWN a
   * letter**: the vertical stem of 9pt lettering is a solid 9pt run, and a
   * hand-drawn row of forty letters came back as eighty vertical segments.
   *
   * So the floor is set above the tallest lettering on a drawing instead.
   * Fourteen points clears body text, room tags and dimension strings — and
   * admits a line of about five feet at 1/4" = 1'-0", which is shorter than
   * anything the wall pairer keeps anyway.
   *
   * It does NOT clear display type: a title block's sheet number is drawn at
   * twenty-odd points and its stems are real runs. That is left alone rather
   * than tuned away, because the building filter already discards ink in the
   * title block, and raising the floor far enough to catch it would start
   * discarding walls.
   */
  minRunPt?: number;
  /**
   * How much of two neighbouring rows' runs must overlap to be one line.
   *
   * This is what turns a wall drawn six pixels thick into ONE segment with a
   * width rather than six hairlines stacked on each other.
   */
  joinOverlap?: number;
  /**
   * The thickest band that is still a line rather than a filled region.
   * In points. Poché, a solid title block and a logo all exceed it.
   */
  maxWidthPt?: number;
  /**
   * How much blank paper a run may cross without ending, in points.
   *
   * **A scan's dropout is what this is for, and it was measured rather than
   * anticipated.** S19 is the one fixture with real speckle, and without this
   * it produced 942 segments against 336 real lines: a single light pixel in
   * the middle of a wall splits one run into two short ones, and a wall
   * crossed by a dozen specks becomes a dozen fragments, most of them too
   * short to survive the floor at all.
   *
   * It is deliberately small. Bridging a real gap is how a doorway gets
   * paved over, and a doorway is the thing openings detection exists to find
   * — so this clears dropout and nothing wider.
   */
  bridgePt?: number;
  /**
   * How thick a band must be before it is reported as two faces instead of
   * one line, in points.
   *
   * Below this there is nothing to have two sides of — a dimension line, a
   * leader or a grid line is one stroke, and splitting it would invent a
   * parallel partner for the wall pairer to find.
   */
  minFacePt?: number;
};

const DARK_MAX = 160;
const MIN_RUN_PT = 14;
const JOIN_OVERLAP = 0.5;
const MAX_WIDTH_PT = 24;
const BRIDGE_PT = 1.5;
const MIN_FACE_PT = 2;

export type RasterStrokes = {
  segments: StrokeSegment[];
  /**
   * The fraction of the page that is ink.
   *
   * Reported rather than used, and it is the honesty of the whole module: a
   * blank render, a failed decode and a page of pure speckle all produce
   * segment lists, and only this tells them apart. A drawing is a few percent
   * ink. Near zero means nothing was rendered; a third means the threshold ate
   * the page.
   */
  darkFraction: number;
  /**
   * Ink that no axis-aligned run claimed, as a fraction of all ink.
   *
   * The bound on this module stated as a number. Diagonals, curves, text and
   * hatching all land here, so it is never zero on a real sheet — but a sheet
   * whose walls are drawn at 45 degrees shows up as a large one, which is the
   * difference between "this page has no walls" and "this page has walls I
   * cannot see".
   */
  diagonalInk: number;
};

/** One row's worth of consecutive ink. */
type Run = { at: number; from: number; to: number };

/**
 * Runs of ink at least `minRun` long, along one scan line.
 *
 * A run may cross up to `bridge` blank pixels — see `bridgePt`. `end` tracks
 * the last pixel that was actually INK, so a run bridged at its tail reports
 * where the ink stopped rather than where the scan gave up on it.
 */
function runsIn(
  dark: (i: number) => boolean,
  length: number,
  at: number,
  minRun: number,
  bridge: number,
): Run[] {
  const out: Run[] = [];
  let start = -1;
  let end = -1;
  for (let i = 0; i <= length; i += 1) {
    const ink = i < length && dark(i);
    if (ink) {
      if (start < 0) start = i;
      end = i;
      continue;
    }
    if (start < 0) continue;
    if (i - end <= bridge && i < length) continue;
    if (end - start + 1 >= minRun) out.push({ at, from: start, to: end });
    start = -1;
  }
  return out;
}

/**
 * Stack runs from neighbouring scan lines into bands.
 *
 * A band is a line: its extent along the scan is the line, and how many scan
 * lines it spans is the pen width. Growing the band's extent to the UNION as
 * it goes is what lets a wall whose ends are ragged still come out as one
 * segment.
 */
function bandsFrom(runs: Run[][], joinOverlap: number): { from: number; to: number; at: number; thick: number }[] {
  const done: { from: number; to: number; at: number; thick: number }[] = [];
  let open: { from: number; to: number; first: number; last: number }[] = [];

  for (const line of runs) {
    const next: typeof open = [];
    const taken = new Set<number>();
    for (const band of open) {
      let best = -1;
      let bestOverlap = 0;
      for (let i = 0; i < line.length; i += 1) {
        if (taken.has(i)) continue;
        const r = line[i];
        const overlap = Math.min(band.to, r.to) - Math.max(band.from, r.from) + 1;
        const shorter = Math.min(band.to - band.from, r.to - r.from) + 1;
        const ratio = overlap / shorter;
        if (overlap > 0 && ratio >= joinOverlap && ratio > bestOverlap) {
          best = i;
          bestOverlap = ratio;
        }
      }
      if (best < 0) {
        done.push({ from: band.from, to: band.to, at: (band.first + band.last) / 2, thick: band.last - band.first + 1 });
        continue;
      }
      taken.add(best);
      const r = line[best];
      next.push({ from: Math.min(band.from, r.from), to: Math.max(band.to, r.to), first: band.first, last: r.at });
    }
    for (let i = 0; i < line.length; i += 1) {
      if (taken.has(i)) continue;
      next.push({ from: line[i].from, to: line[i].to, first: line[i].at, last: line[i].at });
    }
    open = next;
  }
  for (const band of open) {
    done.push({ from: band.from, to: band.to, at: (band.first + band.last) / 2, thick: band.last - band.first + 1 });
  }
  return done;
}

/**
 * The lines on a page of pixels.
 *
 * Pure, so it can be tested on a bitmap written by hand — which is the only
 * way to know the geometry is right rather than merely plausible.
 */
export function strokesFromBitmap(bitmap: Bitmap, options: RasterStrokeOptions): RasterStrokes {
  const { grey, width, height } = bitmap;
  const darkMax = options.darkMax ?? DARK_MAX;
  const perPoint = options.dpi / 72;
  const minRun = Math.max(2, Math.round((options.minRunPt ?? MIN_RUN_PT) * perPoint));
  const joinOverlap = options.joinOverlap ?? JOIN_OVERLAP;
  const maxWidth = (options.maxWidthPt ?? MAX_WIDTH_PT) * perPoint;
  const bridge = Math.round((options.bridgePt ?? BRIDGE_PT) * perPoint);
  const minFacePx = Math.max(2, (options.minFacePt ?? MIN_FACE_PT) * perPoint);

  let inkPixels = 0;
  for (let i = 0; i < grey.length; i += 1) if (grey[i] <= darkMax) inkPixels += 1;

  const rows: Run[][] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(runsIn((x) => grey[y * width + x] <= darkMax, width, y, minRun, bridge));
  }
  const cols: Run[][] = [];
  for (let x = 0; x < width; x += 1) {
    cols.push(runsIn((y) => grey[y * width + x] <= darkMax, height, x, minRun, bridge));
  }

  // ── A BAND BECOMES ITS TWO FACES, NOT ITS CENTRELINE ──
  //
  // This returned one segment down the middle of each band, which reads as the
  // obviously right answer and cost the whole measurement. A vector drawing
  // gives a wall as TWO lines, one per face, and everything downstream is
  // built on that: `findWallsOnSheet` makes a wall by PAIRING parallel faces,
  // so a lone centreline has nothing to pair with and becomes no wall at all.
  //
  // Measured, not reasoned: with centrelines the scanned office suite returned
  // 31 feet of wall against the drawing's 555, which is 5%. The residence,
  // whose thinner walls happened to resolve as two separate bands anyway,
  // managed 60%. The difference between those two numbers is this decision.
  //
  // So a band thick enough to have two sides is emitted as two, each carrying
  // the band's thickness as its pen width. A hairline — a dimension line, a
  // leader, a grid line — has only one side and stays one segment.
  const segments: StrokeSegment[] = [];
  const claimedMask = new Uint8Array(width * height);
  const emit = (alongFrom: number, alongTo: number, across: number, thick: number, horizontalBand: boolean) => {
    const w = thick / perPoint;
    if (horizontalBand) {
      segments.push({ x1: alongFrom / perPoint, y1: across / perPoint, x2: alongTo / perPoint, y2: across / perPoint, width: w });
    } else {
      segments.push({ x1: across / perPoint, y1: alongFrom / perPoint, x2: across / perPoint, y2: alongTo / perPoint, width: w });
    }
  };

  for (const [bands, horizontalBand] of [
    [bandsFrom(rows, joinOverlap), true] as const,
    [bandsFrom(cols, joinOverlap), false] as const,
  ]) {
    for (const b of bands) {
      if (b.thick > maxWidth) continue;
      const half = (b.thick - 1) / 2;
      for (let i = Math.round(b.at - half); i <= Math.round(b.at + half); i += 1) {
        for (let j = b.from; j <= b.to; j += 1) {
          const px = horizontalBand ? j : i;
          const py = horizontalBand ? i : j;
          if (px >= 0 && px < width && py >= 0 && py < height) claimedMask[py * width + px] = 1;
        }
      }
      if (b.thick >= minFacePx) {
        emit(b.from, b.to + 1, b.at - half, b.thick, horizontalBand);
        emit(b.from, b.to + 1, b.at + half, b.thick, horizontalBand);
      } else {
        emit(b.from, b.to + 1, b.at, b.thick, horizontalBand);
      }
    }
  }
  let claimed = 0;
  for (let i = 0; i < claimedMask.length; i += 1) if (claimedMask[i] === 1 && grey[i] <= darkMax) claimed += 1;

  return {
    segments,
    darkFraction: grey.length === 0 ? 0 : inkPixels / grey.length,
    // Counted on a MASK rather than by summing band areas. The first version
    // multiplied each band's length by its thickness and summed, which
    // double-counts every crossing on a floor plan — so it read 0% unseen on
    // all three scans and could never have reported anything else.
    diagonalInk: inkPixels === 0 ? 0 : Math.max(0, 1 - claimed / inkPixels),
  };
}
