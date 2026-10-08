/**
 * A WALL IS TWO PARALLEL LINES A WALL-THICKNESS APART, and on a CAD sheet those
 * lines are already in the file.
 *
 * ── WHAT THE MEASUREMENT ESTABLISHED, BEFORE ANY OF THIS WAS WRITTEN ──
 *
 * `page.getOperatorList()` works in Node on the `pdfjs-dist` this app already
 * ships, with no canvas — unlike `page.render()`, which `plan-ingest/planPdf.ts`
 * measured as failing for want of one. Probed 2026-10-06 against a sheet with
 * four stroked lines on it:
 *
 *   operators returned: 9
 *   by kind: { setLineWidth: 1, constructPath: 4, stroke: 4 }
 *   constructPath args: [[13, 14], [100, 500, 400, 500], …]   // 13=moveTo 14=lineTo
 *
 * The coordinates come back EXACTLY as drawn. So wall takeoff does not need
 * vision and does not need rasterisation — #641 measured that at 46MB a sheet —
 * and the lengths are not estimated, they are the drawing's own numbers.
 *
 * ── WHY THAT MATTERS MORE THAN THE CONVENIENCE ──
 *
 * `symbolCount.eval.ts` refused symbol counting for a reason above its numbers:
 * a wrong count reads as certain and a person cannot check it. The band that was
 * wrong was the band that was right.
 *
 * Nothing here states a number. This returns the CENTRELINE of each wall it
 * found, as a polyline, and the footage comes from `polylineLength` in
 * `lib/sheet-geometry.ts` through the sheet's own calibration — the same path a
 * hand-traced measurement takes. So a wrong answer is a line in the wrong place
 * on a drawing somebody is looking at, which is a mistake a person catches in a
 * glance. "Confidently wrong number" is not a failure this shape can have.
 *
 * ── IT WORKS IN FEET, NOT POINTS ──
 *
 * A 4-7/8" partition is 3.6pt at 1/8" scale and 7.3pt at 1/4". A thickness
 * tolerance in points would therefore mean something different on every sheet,
 * and would be silently wrong on a detail. The caller converts using the
 * calibration the app already has, and every bound here is in FEET of building.
 */

/** One stroked segment, in page points as the PDF drew it. */
export type StrokeSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The pen that drew it, in page points, with the matrix in force applied.
   *  Optional because a synthetic segment need not have one — and because the
   *  question of whether it DISCRIMINATES a wall from a slab joint is being
   *  measured rather than assumed. */
  width?: number;
};

/** A wall this module is willing to claim: the centreline, in page points. */
export type WallCandidate = {
  /** Centreline start and end — what an estimator would have traced. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The two faces it came from, so a reviewer can see WHY this is a wall. */
  thicknessFeet: number;
  /** Along the centreline, in feet. Derived here only for the eval's grading;
   *  the app computes its own from the geometry and the live calibration. */
  lengthFeet: number;
};

export type WallFinderOptions = {
  /** Feet of building per page point, from the sheet's calibration. */
  feetPerPoint: number;
  /**
   * The thinnest and thickest thing worth calling a wall, in feet.
   *
   * 0.2 ft (2-1/2") is a furring wall; 1.5 ft (18") covers a shaft wall or a
   * double-stud assembly with board both sides. Outside that, two parallel lines
   * are a pair of unrelated walls across a corridor, or a dimension string and
   * its witness line — not one wall.
   */
  minThicknessFeet?: number;
  maxThicknessFeet?: number;
  /** The shortest wall worth reporting, in feet. Below this a pair is as likely
   *  to be a jamb detail, a hatch stroke or a leader as a wall. */
  minLengthFeet?: number;
};

const DEFAULTS = {
  minThicknessFeet: 0.2,
  maxThicknessFeet: 1.5,
  minLengthFeet: 2,
};

/**
 * HOW PARALLEL IS PARALLEL, in radians.
 *
 * CAD draws a wall's two faces at exactly the same angle, so this could be near
 * zero for a clean export. It is 2° because a sheet that has been through a
 * raster-and-revector round trip, or a hand-drafted-then-scanned-then-traced
 * plan, carries a little noise — and a 2° tolerance over a 20ft wall admits a
 * 0.7ft drift at the far end, which the overlap test below still rejects.
 */
const PARALLEL_TOLERANCE_RAD = (2 * Math.PI) / 180;

/**
 * How unequal two faces of one wall may be.
 *
 * 3 is generous — a wall whose far end is interrupted by a doorway is drawn as a
 * long face and a short one — and it is still nowhere near the 13-fold gap
 * between a sheet border and a title block, which is the case it was measured
 * against.
 */
const MAX_FACE_LENGTH_RATIO = 3;

/**
 * How unequal two faces may be and still be PREFERRED as a wall, when several
 * partners are valid.
 *
 * `MAX_FACE_LENGTH_RATIO` above is the hard gate — past 3 a pair is not a wall
 * at all. This is a softer question that only arises once more than one partner
 * passes it: which of them is the wall?
 *
 * MEASURED ON THE EXTERIOR ENVELOPE, where the choice is real. On one sheet the
 * faces within two feet of the west wall sit at +0.00, +1.56, +2.28, +8.28,
 * +8.88 and +12.48 inches, and the last of those is a COLUMN GRID LINE — 115 ft
 * long, running past the building at both ends. It is inside the thickness band
 * and it is the widest, so "take the widest" takes it: 188 ft of one sheet came
 * back at 12.4in, which is no assembly on the drawing.
 *
 * A wall's two faces are the two sides of one wall and are close to the same
 * length — 41 ft against 28.3 ft here, a ratio of 1.45. The grid line is 2.87
 * times its partner on the page where the hard gate misses it, and 4.06 on the
 * page where the gate catches it. Two sits between with margin on both sides.
 *
 * It is a PREFERENCE and not a gate: if no balanced partner exists, the widest
 * valid one is still taken, so nothing that used to be found stops being found.
 */
const BALANCED_FACE_RATIO = 2;

/**
 * HATCHING IS A SERIES; A WALL IS A PAIR. This is the whole discriminator, and
 * it was arrived at by measurement rather than by taste.
 *
 * On the first run the hatched sheet produced **230 phantom walls** and claimed
 * 11,584ft where 100ft was drawn. `syntheticSheet.ts`'s poché is parallel
 * diagonals every 6 points, which is 4.24pt perpendicular — 0.47ft at 1/8"
 * scale, almost exactly a 4-7/8" partition. So EVERY adjacent pair of hatch
 * strokes is a textbook wall by thickness, parallelism, overlap and length, and
 * CLAUDE.md predicted precisely this: *"at 44 DPI a hatch line and a door leaf
 * are both one thin stroke"*, one level up.
 *
 * No tolerance can fix it, because the geometry of a hatch pair and the geometry
 * of a wall pair are the same geometry. What differs is the COMPANY they keep: a
 * wall has two faces and nothing else alongside, while poché is a repeating
 * series, so a third stroke continues the spacing. That is also how a person
 * reads it — nobody measures the gap, they see the stripes.
 *
 * So a pair is rejected when a third parallel stroke sits within this multiple
 * of its own spacing beyond either face. 2.5 admits the irregular last stroke of
 * a band without admitting a wall's neighbour across a 5ft corridor.
 */
const SERIES_REACH = 2.5;

/**
 * How far off a whole number of steps a third stroke may sit and still count as
 * continuing the series, as a fraction of one step.
 *
 * Hatching is machine-generated at a constant pitch — this repo's own generator
 * emits it with `offset += 6` — so a real series member lands on a whole
 * multiple to within a rounding error, and 0.2 is loose by a wide margin. It is
 * the two strokes it must NOT admit that set the ceiling: on a measured
 * exterior wall the inboard gypsum line sits at 1.07 steps and the column grid
 * line at 1.51. The nearer of those is 0.07 from a whole number, which is why
 * this cannot simply be made generous — and why `nearest === 1` is excluded
 * rather than tolerated, since 1 is `b` itself.
 */
const SERIES_PITCH_TOLERANCE = 0.2;

/** Direction of a segment, normalised to [0, π) so a line and its reverse are
 *  the same direction — which they are, for a wall face. */
function angleOf(segment: StrokeSegment): number {
  const angle = Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1);
  return ((angle % Math.PI) + Math.PI) % Math.PI;
}

function lengthOf(segment: StrokeSegment): number {
  return Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
}

/** Smallest difference between two directions in [0, π). */
function angleGap(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, Math.PI - raw);
}

/**
 * Perpendicular distance from a point to the infinite line through a segment.
 * Zero-length segments are filtered before this runs.
 */
function perpendicularDistance(segment: StrokeSegment, px: number, py: number): number {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const len = Math.hypot(dx, dy);
  return Math.abs(dy * (px - segment.x1) - dx * (py - segment.y1)) / len;
}

/** How much two parallel segments overlap when projected onto their shared
 *  direction. Two walls meeting end to end overlap by nothing. */
function overlapAlong(a: StrokeSegment, b: StrokeSegment): number {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const project = (px: number, py: number) => (px - a.x1) * ux + (py - a.y1) * uy;

  const aStart = 0;
  const aEnd = len;
  const bOne = project(b.x1, b.y1);
  const bTwo = project(b.x2, b.y2);
  const bStart = Math.min(bOne, bTwo);
  const bEnd = Math.max(bOne, bTwo);

  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * The walls two faces make, if they make one.
 *
 * Returns null rather than a maybe. A pair either satisfies all four tests or it
 * is not a wall — there is no confidence band here, deliberately: the thing a
 * person checks is the LINE on the drawing, and a line drawn with a shrug is
 * worse than no line.
 */
export function wallFromPair(
  a: StrokeSegment,
  b: StrokeSegment,
  options: WallFinderOptions,
): WallCandidate | null {
  const minThickness = options.minThicknessFeet ?? DEFAULTS.minThicknessFeet;
  const maxThickness = options.maxThicknessFeet ?? DEFAULTS.maxThicknessFeet;
  const minLength = options.minLengthFeet ?? DEFAULTS.minLengthFeet;

  const aLen = lengthOf(a);
  const bLen = lengthOf(b);
  if (aLen === 0 || bLen === 0) return null;

  // 1. PARALLEL. A wall's faces are.
  if (angleGap(angleOf(a), angleOf(b)) > PARALLEL_TOLERANCE_RAD) return null;

  // 2. A WALL-THICKNESS APART. Measured from b's midpoint to a's line, so a
  // slight angle between them is averaged rather than read at its worst end.
  const midX = (b.x1 + b.x2) / 2;
  const midY = (b.y1 + b.y2) / 2;
  const thicknessPoints = perpendicularDistance(a, midX, midY);
  const thicknessFeet = thicknessPoints * options.feetPerPoint;
  if (thicknessFeet < minThickness || thicknessFeet > maxThickness) return null;

  // 3. THEY OVERLAP. Two faces of one wall run alongside each other; two walls
  // across a corridor, or a wall and the next wall along, do not. This is the
  // test that rejects a dimension string's witness lines, which are parallel and
  // the right distance apart and sit END TO END with the wall rather than beside
  // it.
  const overlap = overlapAlong(a, b);
  const shorter = Math.min(aLen, bLen);
  if (overlap < shorter * 0.5) return null;

  // 4. LONG ENOUGH TO BE A WALL rather than a jamb, a hatch stroke or a leader.
  const lengthFeet = overlap * options.feetPerPoint;
  if (lengthFeet < minLength) return null;

  // 5. THE TWO FACES ARE COMPARABLE IN LENGTH, because one wall's two faces are
  // drawn the same length.
  //
  // MEASURED, not anticipated: on the first run every clean sheet reported one
  // phantom and 120ft of wall where 100ft was drawn. The extra 20ft was the
  // SHEET BORDER paired with the TITLE-BLOCK box — two parallel lines 10pt
  // apart, which at 1/8" scale is 1.1ft and sits squarely inside the partition
  // window. Nothing about thickness, parallelism or overlap can separate them.
  // Their LENGTHS can: the border runs the width of a 36" sheet and the title
  // block is 180pt, a 13-fold difference no wall has.
  if (Math.max(aLen, bLen) / Math.min(aLen, bLen) > MAX_FACE_LENGTH_RATIO) return null;

  // The centreline, over the OVERLAPPING span only — the part that is actually
  // two-sided. A face that runs past its partner is a different wall's face or
  // a drafting artefact, and claiming it would overstate the footage.
  const dx = (a.x2 - a.x1) / aLen;
  const dy = (a.y2 - a.y1) / aLen;
  const bOne = (b.x1 - a.x1) * dx + (b.y1 - a.y1) * dy;
  const bTwo = (b.x2 - a.x1) * dx + (b.y2 - a.y1) * dy;
  const from = Math.max(0, Math.min(bOne, bTwo));
  const to = Math.min(aLen, Math.max(bOne, bTwo));

  // Halfway between the two faces, which is where somebody tracing by hand puts
  // the line.
  const offX = (midX - (a.x1 + dx * ((from + to) / 2))) / 2;
  const offY = (midY - (a.y1 + dy * ((from + to) / 2))) / 2;

  return {
    x1: a.x1 + dx * from + offX,
    y1: a.y1 + dy * from + offY,
    x2: a.x1 + dx * to + offX,
    y2: a.y1 + dy * to + offY,
    thicknessFeet,
    lengthFeet,
  };
}

/**
 * Every wall the strokes on a sheet make.
 *
 * EACH FACE IS USED ONCE. A corridor drawn as three parallel lines — two rooms
 * sharing a middle wall — would otherwise yield three "walls" from two, and the
 * middle face would be counted twice. First match wins, which is why the
 * segments are sorted longest-first: the long run of a corridor wall should
 * claim its partner before a short jamb stub does.
 */
export function wallsFromStrokes(
  segments: readonly StrokeSegment[],
  options: WallFinderOptions,
): WallCandidate[] {
  // ── THE LENGTH FILTER IS HOISTED, AND THAT IS WHAT MAKES THIS RUNNABLE ──
  //
  // The pairing below is O(n²) with `inAHatchSeries` scanning inside it. A real
  // ARCH D export carries 79,001 stroked segments and one measured here carried
  // 116,893 — call it 10¹⁰ operations, which is not slow, it is never.
  //
  // `minLengthFeet` was already being applied, per PAIR, inside `wallFromPair`.
  // Applying it to the INPUT first is not an approximation and not a heuristic:
  // a wall's length is the overlap of its two faces, which is at most the
  // shorter face, so a face below the minimum cannot belong to a wall above it.
  // Exactly the same walls come back.
  //
  // Measured on real sheets, 2026-10-07: 116,893 segments → 7,998, and 23,351 →
  // 1,623. Most of what a CAD sheet strokes is lettering outlines, hatching and
  // leader lines, none of which is two feet of building long. That took the
  // worst sheet to 1.7s and the smallest to 81ms.
  const minLengthPoints = (options.minLengthFeet ?? DEFAULTS.minLengthFeet) / options.feetPerPoint;
  const usable = segments.filter((segment) => lengthOf(segment) >= minLengthPoints);
  const order = [...usable].sort((a, b) => lengthOf(b) - lengthOf(a));
  const used = new Set<number>();
  const walls: WallCandidate[] = [];

  for (let i = 0; i < order.length; i += 1) {
    if (used.has(i)) continue;
    // ── THE OUTERMOST PARTNER, NOT THE FIRST ONE ──
    //
    // This used to take the first valid partner it met in length order and
    // stop. For a wall drawn as two faces that is the only partner there is, so
    // it was right for years. An exterior wall is drawn as FOUR — outer finish,
    // sheathing, stud face, inner face — and then three of the six pairings are
    // inside the thickness band:
    //
    //   outer finish -> inner face   8.28in   the wall
    //   sheathing    -> inner face   6.72in   two layers of it
    //   stud face    -> inner face   6.00in   the stud cavity
    //
    // Whichever came first won. Measured against a 60-page answer key, the
    // envelope was being found and then reported at 6.6in — 297 ft of it on one
    // sheet — against a true EXT-2 of 8-1/8in. A wall at the wrong thickness is
    // priced as the wrong assembly, which is a worse failure than not finding
    // it: the footage looks right and the bid is wrong.
    //
    // What an estimator measures is finish to finish, so the widest valid pair
    // is the wall and the narrower ones are its layers.
    // The widest valid partner whose face is a PLAUSIBLE PARTNER, falling back
    // to the widest of any kind. Taking the widest alone reaches past the wall
    // and pairs with the column grid line — see `BALANCED_FACE_RATIO`.
    let bestJ = -1;
    let bestWall: WallCandidate | null = null;
    let anyJ = -1;
    let anyWall: WallCandidate | null = null;
    const iLength = lengthOf(order[i]);
    for (let j = i + 1; j < order.length; j += 1) {
      if (used.has(j)) continue;
      const wall = wallFromPair(order[i], order[j], options);
      if (wall === null) continue;
      if (inAHatchSeries(order, i, j, options)) continue;
      if (anyWall === null || wall.thicknessFeet > anyWall.thicknessFeet) {
        anyWall = wall;
        anyJ = j;
      }
      const jLength = lengthOf(order[j]);
      const ratio = Math.max(iLength, jLength) / Math.max(Math.min(iLength, jLength), 1e-9);
      if (ratio > BALANCED_FACE_RATIO) continue;
      if (bestWall === null || wall.thicknessFeet > bestWall.thicknessFeet) {
        bestWall = wall;
        bestJ = j;
      }
    }
    const chosen = bestWall ?? anyWall;
    const chosenJ = bestWall !== null ? bestJ : anyJ;
    if (chosen !== null) {
      used.add(i);
      used.add(chosenJ);
      walls.push(chosen);
    }
  }

  return walls;
}

/**
 * Whether a pair is two strokes of a hatch band rather than a wall's two faces.
 *
 * Looks for a THIRD stroke parallel to both, overlapping them, and offset in the
 * same direction by a comparable step — the signature of a repeating series. See
 * `SERIES_REACH` for the 230-phantom measurement that produced this.
 */
function inAHatchSeries(
  segments: readonly StrokeSegment[],
  aIndex: number,
  bIndex: number,
  options: WallFinderOptions,
): boolean {
  const a = segments[aIndex];
  const b = segments[bIndex];
  const direction = angleOf(a);

  // Signed offsets along the normal of `a`, so "beyond b" and "before a" are
  // distinguishable rather than both reading as distance.
  const aLen = lengthOf(a);
  const nx = -(a.y2 - a.y1) / aLen;
  const ny = (a.x2 - a.x1) / aLen;
  const offsetOf = (segment: StrokeSegment) => {
    const mx = (segment.x1 + segment.x2) / 2 - a.x1;
    const my = (segment.y1 + segment.y2) / 2 - a.y1;
    return mx * nx + my * ny;
  };

  const step = offsetOf(b);
  if (step === 0) return false;
  const reach = Math.abs(step) * SERIES_REACH;

  for (let k = 0; k < segments.length; k += 1) {
    if (k === aIndex || k === bIndex) continue;
    const other = segments[k];
    if (lengthOf(other) === 0) continue;
    if (angleGap(angleOf(other), direction) > PARALLEL_TOLERANCE_RAD) continue;
    // It has to be alongside the pair, not somewhere else on the sheet.
    if (overlapAlong(a, other) < Math.min(aLen, lengthOf(other)) * 0.5) continue;

    const where = offsetOf(other);
    // ── IT MUST CONTINUE THE SPACING, NOT MERELY BE NEARBY ──
    //
    // This header has always said a third stroke "continues the spacing", and
    // for a long time the code only checked that one was somewhere in a RANGE
    // beside the pair. That is a different test, and it cost the whole exterior
    // envelope: measured against a 60-page answer key, EXT-1 and EXT-2 came
    // back 13 ft found of 12,830 — zero per cent, on every export style.
    //
    // An exterior wall is not two lines. It is four — outer finish, sheathing,
    // stud face, inner face — with a 5/8" board line and a column grid line
    // beside them. On one real sheet the faces sit at 24.52, 24.65, 24.71 and
    // 25.21 ft, with the board at 25.26 and the grid at 25.56. Fed those four
    // lines alone the pairer returns the wall correctly; on the page it
    // returned nothing, because two of those neighbours fall in the range and
    // the range was the whole test.
    //
    // Hatching is a REPEATED pattern — it is generated at a constant pitch, and
    // a wall assembly's layers are not. So the ratio is what decides: a series
    // member sits at a whole number of steps from the pair, and a wall's
    // neighbour does not. The board line lands at 1.07 steps and the grid at
    // 1.51; neither is a whole number, and both used to reject the envelope.
    const ratio = where / step;
    const nearest = Math.round(ratio);
    const offPitch = Math.abs(ratio - nearest);
    // 0 is `a` and 1 is `b`; -1 continues before `a`, 2 and 3 continue past
    // `b`, which is the same span `SERIES_REACH` already allowed.
    const continuesTheSeries =
      offPitch <= SERIES_PITCH_TOLERANCE && (nearest === -1 || nearest === -2 || nearest === 2 || nearest === 3);
    if (continuesTheSeries && Math.abs(where) <= Math.abs(step) + reach + Math.abs(step)) return true;
  }

  return false;
}

/** One thickness of wall found on a sheet: how many runs, and how much of it. */
export type WallCluster = {
  /** The cluster's thickness in INCHES, averaged over its runs — what an
   *  estimator recognises ("4-7/8" is a 3-5/8" stud with board both sides"). */
  inches: number;
  runs: WallCandidate[];
  feet: number;
};

/**
 * HOW FAR APART TWO THICKNESSES HAVE TO BE TO BE DIFFERENT WALLS, in inches.
 *
 * MEASURED, not chosen. Real sheets do not return clean thicknesses: one came
 * back with 4.92" and 4.64" as separate values holding 739ft and 682ft, which is
 * one partition type split by how CAD drew its two faces. At 0.25" they stay
 * apart; at 0.5" they merge, which is right.
 *
 * It does not go higher, and the reason is the whole value of the grouping: a
 * 3-5/8" stud wall and a 4-7/8" partition are 1.25" apart and are DIFFERENT
 * WALLS with different material. A bucket wide enough to swallow that gap would
 * quietly add one type's footage to another's — a wrong number on a bid, which
 * is worse than showing an estimator two groups where they expected one.
 *
 * Tested across 7 real sheets: 0.5" took one from 21 clusters to 13 while
 * leaving every pair of real partition types distinct.
 */
export const CLUSTER_INCHES = 0.5;

/**
 * The walls on a sheet, grouped by thickness, BIGGEST FOOTAGE FIRST.
 *
 * ── WHY FOOTAGE AND NOT COUNT, AND WHY GROUPS AT ALL ──
 *
 * A real floor plan returns 15-21 thickness clusters, not the three anybody
 * would guess, and the top three hold only about half the footage. That is the
 * measurement this function is shaped by: there is no tidy "here are your three
 * wall types", and pretending otherwise would mean hiding footage an estimator
 * is going to bid.
 *
 * What IS true is that the LARGEST clusters are the ones a bid turns on, and
 * they land on dimensions walls are actually built at — 4.88", 4.92", 4.80" on
 * three unrelated projects, all of them 4-7/8": a 3-5/8" stud with 5/8" board
 * each side. Noise does not land on 4-7/8". So sorting by footage puts the real
 * partition runs at the top, where accepting ONE of them replaces ninety-nine
 * hand traces, and leaves the long tail for a person to judge or ignore.
 *
 * Pure, like everything else in this file.
 */
export function clusterByThickness(
  walls: readonly WallCandidate[],
  clusterInches = CLUSTER_INCHES,
): WallCluster[] {
  const byThickness = [...walls].sort((a, b) => a.thicknessFeet - b.thicknessFeet);
  const clusters: { runs: WallCandidate[]; feet: number }[] = [];

  for (const wall of byThickness) {
    const inches = wall.thicknessFeet * 12;
    const open = clusters[clusters.length - 1];
    // Against the cluster's FIRST member rather than its running mean: a mean
    // drifts as members join, so a long enough chain of near-misses would walk
    // a cluster across the 1.25" gap this is meant to preserve.
    const start = open === undefined ? null : open.runs[0].thicknessFeet * 12;
    if (open !== undefined && start !== null && inches - start <= clusterInches) {
      open.runs.push(wall);
      open.feet += wall.lengthFeet;
    } else {
      clusters.push({ runs: [wall], feet: wall.lengthFeet });
    }
  }

  return clusters
    .map((cluster) => ({
      // The average, so the label is the thickness the runs actually have
      // rather than whichever one happened to open the cluster.
      inches:
        cluster.runs.reduce((total, run) => total + run.thicknessFeet * 12, 0) / cluster.runs.length,
      runs: cluster.runs,
      feet: cluster.feet,
    }))
    .sort((a, b) => b.feet - a.feet);
}

/**
 * A THICKNESS AN ESTIMATOR RECOGNISES: 4.875 → `4-7/8"`.
 *
 * To the nearest EIGHTH, because that is how a wall is specified, sold and
 * talked about. `clusterByThickness` averages over a group's runs and hands
 * back decimals no drawing ever carried — printing `4.81"` would state a
 * precision the measurement does not have, on a label whose only job is to be
 * recognised. `4-3/4"` is a wall somebody can picture.
 *
 * HERE RATHER THAN IN THE VIEWER, and that is a rule rather than a preference:
 * it lived in `TakeoffPlanViewer.tsx` for one commit and the client/server
 * boundary census failed it — a `"use client"` module may export components,
 * not plain values. It is pure and it is about walls, so it belongs beside the
 * finder that produces the number.
 */
export function inchLabel(inches: number): string {
  const eighths = Math.round(inches * 8);
  const whole = Math.floor(eighths / 8);
  const part = eighths % 8;
  if (part === 0) return `${whole}"`;
  const half = part % 2 === 0 ? part / 2 : part;
  const over = part % 2 === 0 ? 4 : 8;
  const reduced = half % 2 === 0 ? `${half / 2}/${over / 2}` : `${half}/${over}`;
  return whole === 0 ? `${reduced}"` : `${whole}-${reduced}"`;
}

/**
 * ── HOW FAR APART TWO RUNS CAN BE AND STILL BE THE SAME BUILDING, IN FEET ──
 *
 * MEASURED, by looking. At 6ft a real floor plan shattered into 46 pieces and
 * the biggest held 49 of 203 runs — a corner of the offices, with the rest of
 * the plan thrown away. Sweeping it: 12ft kept 132, 20ft kept 178, 30ft kept
 * 186. It plateaus at 20, which is the number here.
 *
 * It has to be this generous because detected runs do not touch as often as a
 * drawing suggests: a doorway, a cased opening, a corridor crossing or a wall
 * the finder simply missed all leave a gap, and a plan is still one building
 * across them. 20ft is wider than any of those and far narrower than the
 * distance from a floor plan to the title block beside it.
 */
export const SAME_BUILDING_FEET = 20;

/** Fewer runs than this is not a floor plan — see `wallsInTheBuilding`. */
export const NOT_A_BOX = 10;

/** Closest approach between two centrelines, point to segment. */
function gapBetween(a: WallCandidate, b: WallCandidate): number {
  const toSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  return Math.min(
    toSegment(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2),
    toSegment(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2),
    toSegment(b.x1, b.y1, a.x1, a.y1, a.x2, a.y2),
    toSegment(b.x2, b.y2, a.x1, a.y1, a.x2, a.y2),
  );
}

/**
 * THE RUNS THAT BELONG TO THE BUILDING, AND NOT TO THE REST OF THE SHEET.
 *
 * ── WHY THIS EXISTS, AND IT IS NOT A REFINEMENT ──
 *
 * The finder had no idea WHERE on the sheet the drawing was. It read the whole
 * page, so it returned the title block's ruled lines, the notes column, the
 * sheet border, and the wall-section details printed above the plan — every one
 * of them a real pair of parallel lines at a real spacing, and none of them a
 * wall in this building.
 *
 * Nobody noticed from the numbers. The thicknesses looked right — clusters at
 * 4.88", 4.92", 4.80" on three projects — and that was read as proof the result
 * was real. It proves nothing: a drawing is full of parallel pairs at
 * building-ish spacings, so some land on a partition thickness by arithmetic
 * alone. The first person to LOOK at the output found it drawing nothing like
 * the walls, and the fix only became obvious once there was a picture.
 *
 * ── THE IDEA ──
 *
 * A floor plan is ONE connected thing; everything else on the sheet is
 * somewhere else. So the runs say where the plan is: join the ones near each
 * other and keep the biggest group. Nothing here knows what a title block looks
 * like or where a drawing is normally placed, which is why it survives a sheet
 * laid out differently.
 *
 * Biggest by FOOTAGE rather than by count, because a dense notes column can
 * out-count a building without out-measuring it.
 *
 * ── WHAT IT DOES NOT FIX, STATED BECAUSE IT IS VISIBLE IN THE SAME PICTURE ──
 *
 * Noise INSIDE the footprint survives, and on the sheet this was measured
 * against that is five long lines down an apparatus bay — slab joints or a
 * trench drain, which really are two parallel lines a wall-thickness apart.
 * They are in the building, so they join the building. What saves an estimator
 * there is the drawing itself: the bay is visibly empty, the lines are visibly
 * not walls, and they are drawn on screen before anything is accepted.
 */
export function wallsInTheBuilding(
  walls: readonly WallCandidate[],
  feetPerPoint: number,
  sameBuildingFeet = SAME_BUILDING_FEET,
): WallCandidate[] {
  if (walls.length === 0) return [];
  const joinPoints = sameBuildingFeet / feetPerPoint;

  const parent = walls.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      if (gapBetween(walls[i], walls[j]) <= joinPoints) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }

  const groups = new Map<number, WallCandidate[]>();
  walls.forEach((wall, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(wall);
    groups.set(root, list);
  });

  let best: WallCandidate[] = [];
  let bestFeet = -1;
  for (const group of groups.values()) {
    const feet = group.reduce((total, wall) => total + wall.lengthFeet, 0);
    if (feet > bestFeet) {
      bestFeet = feet;
      best = group;
    }
  }

  // ── A BUILDING IS NOT A BOX ──
  //
  // "The biggest group" is only the plan when there IS a plan. On a sheet that
  // yields almost no wall — a roof plan, an equipment plan, a demolition sheet
  // drawn in dashed line work — the biggest group is whatever else is on the
  // page, and what won on one real sheet was the TITLE BLOCK: four runs, 64ft,
  // a rectangle in the corner offered to an estimator as the walls of a
  // building. Found by looking at the picture; the numbers looked unremarkable.
  //
  // A rectangle is four runs. Real floor plans measured here returned 38, 58,
  // 68, 230, 295 and 453 — so the gap between "a box" and "a plan" is an order
  // of magnitude, not a margin, and this does not have to be a finely judged
  // number to sit inside it.
  //
  // Returning NOTHING is the right answer rather than a weak one: the panel
  // already says "No walls found on this sheet. That is a fact about the
  // drawing, not a failure", which is true of a roof plan and is far better
  // than four lines somebody has to recognise as a title block.
  return best.length < NOT_A_BOX ? [] : best;
}

/**
 * ── THE PEN FILTER WAS HERE, AND IT COST MORE THAN IT SAVED ──
 *
 * #669 dropped every stroke at or below a sheet's commonest pen width, on the
 * reasoning that CAD draws walls heavy and hatching thin. It worked on the
 * sheet it was measured against: five slab joints running an apparatus bay
 * disappeared, and the wall count went UP because thin strokes had been
 * stealing partners from real wall faces.
 *
 * The cost was never measured, and it is enormous. Across 13 sheets from four
 * projects:
 *
 *   WITH the filter     919 walls
 *   WITHOUT it        2,264 walls
 *
 * On one sheet it was 12 against 380. **It was deleting 59% of the walls on a
 * drawing to remove a handful of wrong lines.**
 *
 * The premise is what fails: "the commonest pen is the hatching pen" is true of
 * some exports and false of others. On one sheet the mode landed ABOVE the pen
 * the walls were drawn with, so the filter kept the furniture and deleted the
 * building. Dropping only the THINNEST band instead was tried and is better on
 * one sheet, worse on another — neither rule wins, which is the signal that the
 * idea needs a discriminator it does not have.
 *
 * And the trade was the wrong way round for this product. A missing wall is a
 * SHORT BID that nothing on screen reveals; a wrong line is drawn on the
 * drawing and gets rejected in a glance. Precision was never the complaint —
 * what was reported as "reading the wrong walls" was the title block and the
 * room numbers, and both are fixed by `wallsInTheBuilding` and
 * `wallsNotLettering`, which stay.
 *
 * `StrokeSegment.width` is still read and still carried, because the
 * measurement that produced those numbers needs it and because a future rule
 * may use the pen as one signal among several rather than as a gate.
 */

/**
 * ── A STROKED GLYPH IS TWO PARALLEL LINES, AND THE PAIRER TAKES IT ──
 *
 * Reported from a real sheet by somebody looking at the drawing: two entire
 * groups were text. 64 runs at 14-1/2" sitting on dimension strings — `4'-0"`,
 * `10'-0"`, `12'-0"` — and 15 at 13-1/2" entirely on room-number tags (121, 133,
 * and an A106 marker), with not one wall among them. 79 of 205 runs.
 *
 * When a drawing's lettering is saved as line work rather than text, the two
 * sides of a `0` or a `1` are parallel, a few inches apart at drawing scale, and
 * the right length. Nothing about their SHAPE says they are letters. The pen
 * does not help either: a title is drawn heavy.
 *
 * What does say it is the text layer, which this app already extracts for every
 * sheet — `PlanTextItem` carries each item's box in the same coordinate space as
 * the strokes. A candidate sitting inside one is lettering.
 *
 * ── AND IT IS BOUNDED BY LENGTH, BECAUSE A ROOM TAG SITS ON A WALL ──
 *
 * A plan puts its labels ON the thing they label, so a long partition can easily
 * run under a room number. Dropping it would be worse than keeping the tag: a
 * missing wall is a short bid, while a wrong one is visible on the drawing and
 * gets rejected.
 *
 * So length decides. Lettering on a drawing is a foot or two of building at
 * plan scale; a wall is not. Above `LETTER_FEET` a candidate is kept wherever it
 * sits, which costs a few tag-sized false positives and cannot cost a wall.
 */
export const LETTER_FEET = 4;

/** Each text item's box, as this filter needs it. */
export type TextBox = { x: number; y: number; width: number; height: number };

export function wallsNotLettering(
  walls: readonly WallCandidate[],
  text: readonly TextBox[],
  feetPerPoint: number,
  letterFeet = LETTER_FEET,
): WallCandidate[] {
  if (text.length === 0) return [...walls];
  // THE PAD IS IN FEET, CONVERTED — not in whatever units the caller happens to
  // use. The first version wrote a bare `2`, which is 2 points to the server
  // reader and TWO PAGE WIDTHS to the viewer, where coordinates run 0..1. That
  // would have put every wall on the sheet inside a text box and filtered the
  // drawing away. The same unit mistake the CTM bug made with lengths.
  const padFeet = 0.5;
  const pad = feetPerPoint > 0 ? padFeet / feetPerPoint : 0;
  return walls.filter((wall) => {
    if (wall.lengthFeet > letterFeet) return true;
    const midX = (wall.x1 + wall.x2) / 2;
    const midY = (wall.y1 + wall.y2) / 2;
    const inside = text.some(
      (box) =>
        midX >= box.x - pad &&
        midX <= box.x + box.width + pad &&
        midY >= box.y - pad &&
        midY <= box.y + box.height + pad,
    );
    return !inside;
  });
}

/**
 * ── HOW MUCH OF THE SHEET A WALL MAY SPAN ──
 *
 * A click-through on a real permit set reported a group reading "10-1/2" · 1
 * run · 114 ft", and it was a single line down the LEFT SHEET BORDER. One
 * group, 114 feet, entirely false — and the most inviting thing in the panel,
 * because a 114ft run is the longest single thing on the sheet.
 *
 * The border is geometrically distinctive in one way that nothing inside the
 * building is: it runs the full extent of the PAGE. On that sheet the border
 * line measured about 95% of the page height. A building drawn at a sensible
 * scale leaves margins, a title block and a dimension zone, so its longest wall
 * cannot approach the paper's own dimension — the one measured there was 68% of
 * the sheet's width, and that is a long exterior wall on a tightly laid-out
 * sheet.
 *
 * 90% therefore sits in a gap rather than on a judgement call. It is compared
 * against the page extent ALONG THE RUN'S OWN AXIS, because a vertical border
 * on a landscape sheet is short against the width and nearly the whole height —
 * comparing against the wrong dimension is how this would miss.
 */
export const MOST_OF_THE_SHEET = 0.9;

/**
 * Walls that are not the sheet's own border.
 *
 * `pageHeight` is in the same units as the coordinates — the viewer's box has x
 * running 0..1 and y over that same width, so a landscape sheet's height is
 * LESS than 1. Passing the wrong one would compare a vertical run against the
 * width and let the border through, which is the mistake this is written to
 * avoid.
 */
export function wallsNotTheSheetBorder(
  walls: readonly WallCandidate[],
  pageWidth: number,
  pageHeight: number,
  mostOfTheSheet = MOST_OF_THE_SHEET,
): WallCandidate[] {
  if (!(pageWidth > 0) || !(pageHeight > 0)) return [...walls];
  return walls.filter((wall) => {
    const dx = Math.abs(wall.x2 - wall.x1);
    const dy = Math.abs(wall.y2 - wall.y1);
    // The page's extent along whichever axis this run mostly follows.
    const extent = dx >= dy ? pageWidth : pageHeight;
    const span = Math.max(dx, dy);
    return span < extent * mostOfTheSheet;
  });
}
