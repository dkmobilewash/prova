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
    for (let j = i + 1; j < order.length; j += 1) {
      if (used.has(j)) continue;
      const wall = wallFromPair(order[i], order[j], options);
      if (wall === null) continue;
      if (inAHatchSeries(order, i, j, options)) continue;
      used.add(i);
      used.add(j);
      walls.push(wall);
      break;
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
    // A third stroke continuing the series: past `b` in the same direction, or
    // before `a` in the other — both within reach of one more step.
    const continuesPastB = step > 0 ? where > step && where <= step + reach : where < step && where >= step - reach;
    const continuesBeforeA = step > 0 ? where < 0 && where >= -reach : where > 0 && where <= reach;
    if (continuesPastB || continuesBeforeA) return true;
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
