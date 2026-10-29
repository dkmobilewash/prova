import { layerVerdict } from "./layerNames";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── WHAT A CANDIDATE PAIRING LOOKS LIKE, AS NUMBERS ──
 *
 * The geometry engine measures well and decides badly: nearly every error left
 * on a real sheet is a DECISION — a grid line paired with its neighbour, a
 * hatch band read as a wall, a face given to the wrong partner. This turns one
 * candidate pairing into a fixed-length vector so a trained model can make
 * that decision instead of another hand-written rule.
 *
 * ── THE POOL IS EVERY PAIRING, NOT THE WINNERS ──
 *
 * The greedy pass awards a face to one partner and the alternatives vanish.
 * Measured from inside that loop, **1,031 pairings worth 44,012 ft are left on
 * the table across the bench against 1,864 ft of genuinely missing wall** — so
 * the alternatives are most of what there is to learn from, and a model shown
 * only the winners could never choose between two walls competing for a face.
 * Features are therefore extracted for every pair `wallFromPair` accepts, and
 * the existing filters are recorded as FEATURES rather than applied.
 *
 * ── NOTHING AN OFFICE CAN SET IS A FEATURE ──
 *
 * The first model trained on messy synthetic sheets put **0.721 of its
 * importance and 125 of its splits on `penMean`** — the absolute pen width the
 * two faces were drawn with. It was strictly better than the rules on the three
 * drafting styles it had seen and refused walls everywhere else, because pen
 * weight is a house convention: it had learned "a wall is drawn at 0.5 points"
 * rather than anything about walls. On ELEVEN03 it dropped the interior
 * partitions and 36% of the footage.
 *
 * So every absolute quantity an office could set differently is gone, replaced
 * by where that candidate STANDS ON ITS OWN SHEET:
 *
 *   | was                     | is                                        |
 *   | `penMean` (points)      | `penPercentile` among the sheet's strokes  |
 *   | `thicknessFt`, `..Inches` | `thicknessVsCommon`, `thicknessPercentile` |
 *   | `lengthFt`              | `lengthPercentile` among candidates         |
 *   | `localDensity` (count)  | `densityPercentile` among candidates        |
 *   | `nearestScheduledDeltaIn` | `scheduledDeltaShare`, as a share of thickness |
 *
 * A sheet drawn at a heavier pen, at a different scale, by a practice that
 * calls a partition 4 5/8 rather than 4 1/2, now produces the SAME numbers.
 * That is the whole point: the model should learn that a wall is drawn heavier
 * than the furniture around it, not that a wall is drawn at a particular
 * weight.
 *
 * `penDelta`, `faceRatio` and `overlapShare` were already ratios and are
 * unchanged. `offOrthogonalDeg` is an angle and no office owns it.
 *
 * ── A MISSING VALUE GETS ITS OWN COLUMN, NEVER A SENTINEL ──
 *
 * The first model trained on these put **196 of its 300 tree splits and 0.52
 * of its importance** on `nearestScheduledDeltaIn`, which was −1 whenever the
 * sheet had no wall-type schedule. In training it never was: every bench sheet
 * carries one, so the column ranged 0 to 2.81 inches and −1 sat below every
 * threshold the model had learned. On a real sheet without a schedule, each
 * tree therefore sent every candidate down the "this is exactly a scheduled
 * thickness" branch. **The sentinel failed toward YES**, and ELEVEN03's
 * A4.B-Y2 came back 47% over.
 *
 * So a value that may be absent is now TWO columns: the value, zero when
 * absent, and a `has…` flag beside it. A tree can then split on the flag and
 * ignore the value, which is the thing it could not do before. Zero is used
 * rather than −1 for the absent case so that a model which ignores the flag
 * is merely wrong rather than confidently wrong in the dangerous direction.
 *
 * ── THE ORDER OF THIS LIST IS A FILE FORMAT ──
 *
 * `wall-model.json` is trained against these columns in this order. Inserting
 * one in the middle silently reinterprets every number in the model, which
 * would not throw and would not be visibly wrong. `wallFeatures.test.ts`
 * pins the names and the length; add at the END and retrain.
 */
export const FEATURE_NAMES = [
  "thicknessVsCommon",
  "thicknessPercentile",
  "lengthPercentile",
  "lengthToSheetSpan",
  "scheduledDeltaShare",
  "hasSchedule",
  "isScheduled",
  "faceRatio",
  "overlapShare",
  "isCurved",
  "offOrthogonalDeg",
  "penDelta",
  "penPercentile",
  "hasPenWidths",
  "layerSaysWall",
  "layerSaysNotWall",
  "layerUnknown",
  "parallelNeighbours",
  "neighbourSpacingCv",
  "hasNeighbourSpacing",
  "nearestNeighbourThicknessRatio",
  "hasNearestNeighbour",
  "densityPercentile",
  "inHatchSeries",
  // ── ADDED 2026-10-29, FROM THE JUNK CENSUS (`zzJunkKinds`) ──
  // Appended, never inserted: the model names its columns and the loader
  // refuses a mismatch, so an older model file simply stops applying.
  /** Non-dimension words whose centre lies between the faces along the run —
   *  a schedule's rows, a notes box, a legend. Capped at 10. */
  "wordsBetween",
  /** How many of the two faces are dash patterns (0, 1, 2): several short
   *  pieces with short regular gaps. Needs `context.strokes`; 0 without. */
  "dashedFaces",
  /** Faces roughly perpendicular to the run with an end on its line — the
   *  partitions that meet a wall and never meet a table rule. Capped at 20. */
  "runsMeeting",
  /** Other faces on the sheet, parallel, of the same length to the quarter
   *  foot — a unit plan's repeated partition, a kennel grid's bay. Capped at 50. */
  "twinFaces",
  // ── ADDED 2026-10-29, SECOND ROUND: THE PEN'S COLOUR AND THE DIMENSION LINE'S OWN MARKS ──
  /** The faces' stroke luminance, 0 black to 1 white, averaged; 0 when the
   *  content set no colour (`hasGray` says which). Grey carries 11,457 ft of
   *  real wall on the training sets, so it is a feature, never a rule. */
  "faceGray",
  "hasGray",
  /** Short 30–60° strokes that CROSS one of the run's faces — a dimension
   *  line's ticks; hatching inside a wall never crosses its face.
   *  Capped at 20. Needs `context.strokes`; 0 without. */
  "crossingTicks",
  /** Dimension-looking words (digits, feet and inch marks) whose centre lies
   *  on the run's line within 0.6 ft — the number a dimension line carries.
   *  Capped at 10. */
  "centredNumbers",
  /** Ends of the run that a short perpendicular stroke reaches — an extension
   *  line at a dimension's end, 0, 1 or 2. Needs `context.strokes`. */
  "extensionEnds",
  /** Parallel faces whose line sits 20–28 in from this run's near face and
   *  lie along it for most of its length — the wall behind a cabinet front,
   *  or the cabinet front beside a wall. Casework depth. Capped at 5. The
   *  set-aside form of this (`diego/casework`) was 6.8:1 on training and
   *  1.6:1 on the held-out delta, so it is a feature the grey-out can weigh
   *  rather than a rule that hides. */
  "facesTwoFeetOff",
] as const;

/**
 * The columns that mean nothing until the whole sheet has been seen.
 *
 * `featuresFor` writes a RAW value into each of these — a thickness in feet, a
 * length in feet, a neighbour count — and `normaliseAcrossSheet` replaces it
 * with that value's standing among the sheet's own candidates. They are named
 * here rather than hard-coded as indices so that reordering the list above
 * cannot silently normalise the wrong column.
 */
const SHEET_RELATIVE = [
  "thicknessVsCommon",
  "thicknessPercentile",
  "lengthPercentile",
  "densityPercentile",
] as const;

const INDEX_OF = Object.fromEntries(FEATURE_NAMES.map((name, at) => [name, at])) as Record<
  FeatureName,
  number
>;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/** Everything the extractor needs that is not the pair itself. */
export type FeatureContext = {
  /**
   * Where a pen width stands among every stroke on this sheet, 0 to 1.
   *
   * Computed once from the face pool before any pairing, because the sheet's
   * pens are known before its walls are. A wall is drawn heavier than the
   * furniture beside it on every drawing; it is drawn at 0.5 points on only
   * some of them.
   */
  penPercentile: (width: number) => number;
  /** The face pool the pairing loop is working through, in its own order. */
  faces: readonly StrokeSegment[];
  /** Wall thicknesses the sheet's own schedule names, in inches. */
  scheduledIn: readonly number[];
  /** True when the engine's hatch-series test rejects this pair. Passed in
   *  rather than recomputed: it is the expensive one and the caller has it. */
  inHatchSeries: boolean;
  /** The longest dimension of the sheet in page units, for scale-free length. */
  sheetSpan: number;
  /** Every word on the sheet, CENTRED, in page units. Optional: a caller
   *  without text gets `wordsBetween` = 0. */
  words?: readonly { str: string; x: number; y: number }[];
  /** The sheet's raw strokes in page units (before faces were merged), for
   *  `dashedFaces`. Optional: 0 without. */
  strokes?: readonly StrokeSegment[];
};

const lengthOf = (s: StrokeSegment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

const unitOf = (s: StrokeSegment) => {
  const len = lengthOf(s) || 1;
  return { ux: (s.x2 - s.x1) / len, uy: (s.y2 - s.y1) / len };
};

/** How far b runs alongside a, along a's direction. */
const overlapAlong = (a: StrokeSegment, b: StrokeSegment) => {
  const len = lengthOf(a);
  if (!(len > 0)) return 0;
  const { ux, uy } = unitOf(a);
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const lo = Math.max(0, Math.min(at(b.x1, b.y1), at(b.x2, b.y2)));
  const hi = Math.min(len, Math.max(at(b.x1, b.y1), at(b.x2, b.y2)));
  return Math.max(0, hi - lo);
};

/** Perpendicular distance from b's midpoint to a's infinite line. */
const offsetOf = (a: StrokeSegment, b: StrokeSegment) => {
  const { ux, uy } = unitOf(a);
  const mx = (b.x1 + b.x2) / 2;
  const my = (b.y1 + b.y2) / 2;
  return -(mx - a.x1) * uy + (my - a.y1) * ux;
};

/**
 * Where each value stands among a sorted list, 0 to 1.
 *
 * Ties take the midpoint of their run rather than the first or last position,
 * so a sheet where every stroke is the same weight gives 0.5 everywhere
 * instead of 0 or 1 — which matters, because "all the same" is a real and
 * common state and neither extreme describes it.
 */
function percentileIn(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < sorted.length && sorted[end] === value) end += 1;
  return (lo + end) / 2 / sorted.length;
}

/**
 * A pen-percentile function for one sheet, from its own strokes.
 *
 * Built once before any pairing: the sheet's pens are known before its walls
 * are, and this is what makes "heavier than the furniture around it" sayable
 * without naming a weight.
 */
export function penPercentileFor(
  faces: readonly { width?: number }[],
): (width: number) => number {
  const widths = faces
    .map((f) => f.width ?? 0)
    .filter((w) => w > 0)
    .sort((a, b) => a - b);
  return (width) => percentileIn(widths, width);
}

/**
 * Replaces the sheet-relative columns with the standing of their raw value
 * among every candidate on the sheet.
 *
 * Done in place and after collection, because a percentile cannot be known
 * while the list is still being built. `rows` is every candidate's vector from
 * `featuresFor`, in any order.
 */
export function normaliseAcrossSheet(rows: number[][]): void {
  if (rows.length === 0) return;
  const thickAt = INDEX_OF.thicknessVsCommon;
  const thickPctAt = INDEX_OF.thicknessPercentile;
  const lengthAt = INDEX_OF.lengthPercentile;
  const denseAt = INDEX_OF.densityPercentile;

  const thicknesses = rows.map((r) => r[thickAt]).sort((a, b) => a - b);
  const lengths = rows.map((r) => r[lengthAt]).sort((a, b) => a - b);
  const densities = rows.map((r) => r[denseAt]).sort((a, b) => a - b);
  // The sheet's commonest wall thickness, as the median of what was proposed.
  // Not the mode: on a sheet with two partition types the mode picks one of
  // them arbitrarily, and the median sits between, which is the better
  // reference for "thicker or thinner than usual here".
  const common = thicknesses[Math.floor(thicknesses.length / 2)] || 1;

  for (const row of rows) {
    const rawThick = row[thickAt];
    row[thickPctAt] = percentileIn(thicknesses, rawThick);
    row[lengthAt] = percentileIn(lengths, row[lengthAt]);
    row[denseAt] = percentileIn(densities, row[denseAt]);
    row[thickAt] = rawThick / common;
  }
}

/** Named so a caller can assert it ran. Nothing else uses it. */
export const SHEET_RELATIVE_NAMES: readonly string[] = SHEET_RELATIVE;

/**
 * The feature vector for one candidate pairing.
 *
 * Pure, and deliberately so: the same pair gives the same numbers whether it
 * is being extracted for training or scored at run time, which is the one
 * thing that makes a model file portable between the two.
 */
export function featuresFor(
  a: StrokeSegment,
  b: StrokeSegment,
  wall: WallCandidate,
  context: FeatureContext,
): number[] {
  const { scheduledIn, faces, sheetSpan } = context;
  const aLen = lengthOf(a);
  const bLen = lengthOf(b);
  const shorter = Math.max(Math.min(aLen, bLen), 1e-9);
  const longer = Math.max(aLen, bLen, 1e-9);

  const thicknessIn = wall.thicknessFeet * 12;
  // How far this is from the nearest thickness the sheet's schedule names: a
  // wall type is a statement by the architect and a 5.37 in gap between two
  // lines is not.
  let nearest = Number.POSITIVE_INFINITY;
  for (const named of scheduledIn) nearest = Math.min(nearest, Math.abs(named - thicknessIn));
  const hasSchedule = scheduledIn.length > 0 && Number.isFinite(nearest);
  const nearestDelta = hasSchedule ? nearest : 0;

  const { ux, uy } = unitOf(a);
  // 0 for a wall on the grid, 45 for a diagonal. Stair nosings and break lines
  // live off the orthogonal; most walls do not.
  const deg = (Math.atan2(uy, ux) * 180) / Math.PI;
  const offOrthogonal = Math.min(
    Math.abs(((deg % 90) + 90) % 90),
    90 - Math.abs(((deg % 90) + 90) % 90),
  );

  const aw = a.width ?? 0;
  const bw = b.width ?? 0;
  const hasPens = aw > 0 && bw > 0;
  const penDelta = hasPens ? Math.abs(aw - bw) / Math.max(aw, bw) : 0;
  const penMean = hasPens ? (aw + bw) / 2 : 0;

  const verdict = (() => {
    const va = layerVerdict(a.layer);
    const vb = layerVerdict(b.layer);
    if (va === "wall" && vb === "wall") return "wall";
    if (va === "not-wall" || vb === "not-wall" || va === "out-of-scope" || vb === "out-of-scope") {
      return "not-wall";
    }
    return "unknown";
  })();

  // ── THE NEIGHBOURHOOD, WHICH IS WHERE HATCH AND GRID LIVE ──
  //
  // A wall has exactly one parallel line at its own thickness. Hatching has
  // many at a regular spacing; a grid line has one at an arbitrary one. The
  // count and the regularity of the spacings say which, and neither needs a
  // layer name — which matters, because four of five real plan sets carry no
  // layers at all.
  const reach = Math.max(lengthOf(a), 1e-9);
  const band = (Math.abs(offsetOf(a, b)) || 1e-9) * 3;
  const offsets: number[] = [];
  let dense = 0;
  for (const other of faces) {
    if (other === a || other === b) continue;
    const { ux: ox, uy: oy } = unitOf(other);
    if (Math.abs(ux * oy - uy * ox) > 0.05) continue;
    const off = offsetOf(a, other);
    if (Math.abs(off) > band) continue;
    if (overlapAlong(a, other) < 0.3 * Math.min(reach, lengthOf(other))) continue;
    offsets.push(off);
    dense += 1;
  }
  offsets.sort((x, y) => x - y);
  const gaps: number[] = [];
  for (let k = 1; k < offsets.length; k += 1) gaps.push(offsets[k] - offsets[k - 1]);
  const meanGap = gaps.length > 0 ? gaps.reduce((n, g) => n + g, 0) / gaps.length : 0;
  const variance =
    gaps.length > 0 ? gaps.reduce((n, g) => n + (g - meanGap) ** 2, 0) / gaps.length : 0;
  // Coefficient of variation: 0 is perfectly regular (hatching), high is not.
  const hasSpacing = gaps.length > 0 && meanGap !== 0;
  const spacingCv = hasSpacing ? Math.sqrt(variance) / Math.abs(meanGap) : 0;
  const nearestOther = offsets
    .filter((o) => Math.abs(o) > 1e-9)
    .sort((x, y) => Math.abs(x) - Math.abs(y))[0];
  const hasNearest = nearestOther !== undefined;
  const neighbourRatio = hasNearest
    ? Math.abs(nearestOther) / Math.max(Math.abs(offsetOf(a, b)), 1e-9)
    : 0;

  // The four sheet-relative columns carry RAW values here and are replaced by
  // `normaliseAcrossSheet` once every candidate on the sheet is known. A model
  // must never be scored on this vector as it stands.
  return [
    wall.thicknessFeet,
    wall.thicknessFeet,
    wall.lengthFeet,
    sheetSpan > 0 ? lengthOf(a) / sheetSpan : 0,
    // As a SHARE of the wall's own thickness: half an inch out on a 4 inch
    // partition is a different statement from half an inch on a 12 inch wall.
    hasSchedule && thicknessIn > 0 ? nearestDelta / thicknessIn : 0,
    hasSchedule ? 1 : 0,
    scheduledIn.some((named) => Math.abs(named - thicknessIn) <= 0.5) ? 1 : 0,
    longer / shorter,
    Math.min(1, overlapAlong(a, b) / shorter),
    wall.curved === true ? 1 : 0,
    offOrthogonal,
    penDelta,
    hasPens ? context.penPercentile(penMean) : 0,
    hasPens ? 1 : 0,
    verdict === "wall" ? 1 : 0,
    verdict === "not-wall" ? 1 : 0,
    verdict === "unknown" ? 1 : 0,
    offsets.length,
    spacingCv,
    hasSpacing ? 1 : 0,
    neighbourRatio,
    hasNearest ? 1 : 0,
    dense,
    context.inHatchSeries ? 1 : 0,
    wordsBetween(wall, context.words ?? []),
    dashedFaceCount(wall, context.strokes ?? []),
    runsMeeting(wall, faces, a, b),
    twinFaces(wall, a, faces),
    faceGray(a, b),
    a.gray !== undefined || b.gray !== undefined ? 1 : 0,
    crossingTicks(wall, context.strokes ?? []),
    centredNumbers(wall, context.words ?? []),
    extensionEnds(wall, context.strokes ?? []),
    facesTwoFeetOff(wall, faces, a, b),
  ];
}

const TWO_FEET_MIN = 20 / 12;
const TWO_FEET_MAX = 28 / 12;

export function facesTwoFeetOff(wall: WallCandidate, faces: readonly StrokeSegment[], a: StrokeSegment, b: StrokeSegment): number {
  const fpu = feetPerUnitOf(wall);
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const l = Math.hypot(dx, dy);
  if (l === 0) return 0;
  const half = wall.thicknessFeet / 2;
  let n = 0;
  for (const o of faces) {
    if (o === a || o === b) continue;
    const ol = lengthOf(o);
    if (ol === 0 || Math.abs(((o.x2 - o.x1) * dx + (o.y2 - o.y1) * dy) / (ol * l)) < 0.97) continue;
    const t1 = alongT(wall, o.x1, o.y1), t2 = alongT(wall, o.x2, o.y2);
    const along = Math.min(1, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
    if (along < 0.7) continue;
    const gap = offLineOf(wall, (o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2) * fpu - half;
    if (gap < TWO_FEET_MIN || gap > TWO_FEET_MAX) continue;
    n += 1;
    if (n >= 5) break;
  }
  return n;
}

// ── THE SECOND ROUND: COLOUR AND THE DIMENSION LINE'S OWN MARKS ──

export function faceGray(a: StrokeSegment, b: StrokeSegment): number {
  const g = [a.gray, b.gray].filter((v): v is number => v !== undefined);
  return g.length === 0 ? 0 : g.reduce((n, v) => n + v, 0) / g.length;
}

/** Signed distance from the run's centreline, in the run's units. */
function signedOff(wall: WallCandidate, x: number, y: number): number {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const l = Math.hypot(dx, dy);
  return l === 0 ? 0 : ((x - wall.x1) * -dy + (y - wall.y1) * dx) / l;
}

export function crossingTicks(wall: WallCandidate, strokes: readonly StrokeSegment[]): number {
  const fpu = feetPerUnitOf(wall);
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const l = Math.hypot(dx, dy);
  if (l === 0) return 0;
  const half = wall.thicknessFeet / 2 / fpu;
  let n = 0;
  for (const s of strokes) {
    const sl = lengthOf(s);
    if (sl === 0) continue;
    const lf = sl * fpu;
    if (lf < 0.25 || lf > 1.2) continue;
    const cosA = Math.abs(((s.x2 - s.x1) * dx + (s.y2 - s.y1) * dy) / (sl * l));
    if (cosA < 0.5 || cosA > 0.87) continue;
    const t = alongT(wall, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
    if (t < -0.05 || t > 1.05) continue;
    const o1 = signedOff(wall, s.x1, s.y1), o2 = signedOff(wall, s.x2, s.y2);
    const min = 0.08 / fpu;
    // The FACES only: a pair of dimension strings has its ticks on the lines
    // themselves, and hatching inside a wall crosses the centreline all day.
    for (const line of [half, -half]) {
      const d1 = o1 - line, d2 = o2 - line;
      if (d1 * d2 < 0 && Math.min(Math.abs(d1), Math.abs(d2)) >= min) { n += 1; break; }
    }
    if (n >= 20) break;
  }
  return n;
}

export function centredNumbers(wall: WallCandidate, words: readonly { str: string; x: number; y: number }[]): number {
  const fpu = feetPerUnitOf(wall);
  let n = 0;
  for (const w of words) {
    const str = w.str.trim();
    if (str === "" || !DIMENSION_WORD.test(str) || !/\d/.test(str)) continue;
    const t = alongT(wall, w.x, w.y);
    if (t < -0.02 || t > 1.02) continue;
    if (offLineOf(wall, w.x, w.y) * fpu > 0.6) continue;
    n += 1;
    if (n >= 10) break;
  }
  return n;
}

export function extensionEnds(wall: WallCandidate, strokes: readonly StrokeSegment[]): number {
  const fpu = feetPerUnitOf(wall);
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const l = Math.hypot(dx, dy);
  if (l === 0) return 0;
  const reach = 0.5 / fpu;
  const ends: [number, number][] = [[wall.x1, wall.y1], [wall.x2, wall.y2]];
  let n = 0;
  for (const [ex, ey] of ends) {
    for (const s of strokes) {
      const sl = lengthOf(s);
      if (sl === 0) continue;
      const lf = sl * fpu;
      if (lf < 1 || lf > 8) continue;
      if (Math.abs(((s.x2 - s.x1) * dx + (s.y2 - s.y1) * dy) / (sl * l)) > 0.26) continue;
      // the stroke passes the end: one point within reach of it, or it crosses the run's line near the end
      const near = Math.hypot(s.x1 - ex, s.y1 - ey) <= reach || Math.hypot(s.x2 - ex, s.y2 - ey) <= reach;
      const crossesNearEnd = (() => {
        const o1 = signedOff(wall, s.x1, s.y1), o2 = signedOff(wall, s.x2, s.y2);
        if (o1 * o2 > 0) return false;
        const t = alongT(wall, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
        const tEnd = ex === wall.x1 && ey === wall.y1 ? 0 : 1;
        return Math.abs(t - tEnd) * l <= reach;
      })();
      if (near || crossesNearEnd) { n += 1; break; }
    }
  }
  return n;
}

// ── THE FOUR SIGNALS FROM THE JUNK CENSUS ──
//
// All in FEET where a distance matters, from the wall's own feet-per-unit
// (`lengthFeet / length in units`), so none of them needs the sheet's scale
// handed in separately.

const DIMENSION_WORD = /^[\d'"\-\s./±+]+$/;

const feetPerUnitOf = (wall: WallCandidate) => wall.lengthFeet / Math.max(Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1), 1e-9);
const alongT = (w: { x1: number; y1: number; x2: number; y2: number }, x: number, y: number) => {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const l2 = dx * dx + dy * dy;
  return l2 === 0 ? 0 : ((x - w.x1) * dx + (y - w.y1) * dy) / l2;
};
const offLineOf = (w: { x1: number; y1: number; x2: number; y2: number }, x: number, y: number) => {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const l = Math.hypot(dx, dy);
  return l === 0 ? Math.hypot(x - w.x1, y - w.y1) : Math.abs(dx * (w.y1 - y) - (w.x1 - x) * dy) / l;
};

export function wordsBetween(wall: WallCandidate, words: readonly { str: string; x: number; y: number }[]): number {
  const fpu = feetPerUnitOf(wall);
  const reach = wall.thicknessFeet / 2 + 0.4;
  let n = 0;
  for (const w of words) {
    const str = w.str.trim();
    if (str === "" || (DIMENSION_WORD.test(str) && /\d/.test(str))) continue;
    const t = alongT(wall, w.x, w.y);
    if (t < -0.05 || t > 1.05) continue;
    if (offLineOf(wall, w.x, w.y) * fpu > reach) continue;
    n += 1;
    if (n >= 10) break;
  }
  return n;
}

/** The face on one side of the wall, as pieces of the run in feet, and whether they form a dash pattern. */
function faceIsDashed(wall: WallCandidate, side: 1 | -1, strokes: readonly StrokeSegment[]): boolean {
  const fpu = feetPerUnitOf(wall);
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const l = Math.hypot(dx, dy);
  if (l === 0) return false;
  const L = wall.lengthFeet;
  const ux = dx / l, uy = dy / l;
  const half = wall.thicknessFeet / 2;
  const reachU = (half + 0.25) / fpu;
  const minX = Math.min(wall.x1, wall.x2) - reachU, maxX = Math.max(wall.x1, wall.x2) + reachU;
  const minY = Math.min(wall.y1, wall.y2) - reachU, maxY = Math.max(wall.y1, wall.y2) + reachU;
  const pieces: [number, number][] = [];
  for (const s of strokes) {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    if (mx < minX || mx > maxX || my < minY || my > maxY) continue;
    const sdx = s.x2 - s.x1, sdy = s.y2 - s.y1;
    const sl = Math.hypot(sdx, sdy);
    if (sl === 0 || Math.abs((sdx * ux + sdy * uy) / sl) < 0.97) continue;
    const cross = dx * (my - wall.y1) - dy * (mx - wall.x1);
    if (wall.thicknessFeet > 0.05 && Math.sign(cross) !== side) continue;
    if (Math.abs((Math.abs(cross) / l) * fpu - half) > 0.25) continue;
    const t1 = ((s.x1 - wall.x1) * ux + (s.y1 - wall.y1) * uy) * fpu;
    const t2 = ((s.x2 - wall.x1) * ux + (s.y2 - wall.y1) * uy) * fpu;
    const p = Math.max(0, Math.min(t1, t2)), q = Math.min(L, Math.max(t1, t2));
    if (q > p) pieces.push([p, q]);
  }
  pieces.sort((p, q) => p[0] - q[0]);
  let covered = 0, cur = -1, longest = 0, n = 0;
  const gaps: number[] = [];
  for (const [p0, q0] of pieces) {
    const p1 = Math.max(p0, cur);
    if (q0 <= p1) continue;
    if (cur >= 0 && p1 - cur > 0.05) gaps.push(p1 - cur);
    covered += q0 - p1;
    cur = q0;
    n += 1;
    longest = Math.max(longest, q0 - p0);
  }
  if (n < 5 || longest > 2.5 || gaps.length === 0) return false;
  const medGap = [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)];
  const cover = covered / Math.max(L, 0.01);
  return medGap <= 2.5 && cover >= 0.25 && cover <= 0.9;
}

export function dashedFaceCount(wall: WallCandidate, strokes: readonly StrokeSegment[]): number {
  if (strokes.length === 0) return 0;
  return (faceIsDashed(wall, 1, strokes) ? 1 : 0) + (faceIsDashed(wall, -1, strokes) ? 1 : 0);
}

export function runsMeeting(wall: WallCandidate, faces: readonly StrokeSegment[], a: StrokeSegment, b: StrokeSegment): number {
  const fpu = feetPerUnitOf(wall);
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const l = Math.hypot(dx, dy);
  if (l === 0) return 0;
  let n = 0;
  for (const o of faces) {
    if (o === a || o === b) continue;
    const ox = o.x2 - o.x1, oy = o.y2 - o.y1;
    const ol = Math.hypot(ox, oy);
    if (ol * fpu < 2 || Math.abs((dx * ox + dy * oy) / (l * ol)) > 0.26) continue;
    for (const [x, y] of [[o.x1, o.y1], [o.x2, o.y2]] as const) {
      const t = alongT(wall, x, y);
      if (t >= -0.02 && t <= 1.02 && offLineOf(wall, x, y) * fpu <= 1.5) { n += 1; break; }
    }
    if (n >= 20) break;
  }
  return n;
}

export function twinFaces(wall: WallCandidate, a: StrokeSegment, faces: readonly StrokeSegment[]): number {
  const la = lengthOf(a);
  if (la === 0) return 0;
  const { ux, uy } = unitOf(a);
  const tol = la * 0.03;
  // The pair's own other face is not a twin: anything within three wall
  // thicknesses of this face is the same wall.
  const own = (wall.thicknessFeet * 3) / feetPerUnitOf(wall);
  let n = 0;
  for (const o of faces) {
    if (o === a) continue;
    const lo = lengthOf(o);
    if (Math.abs(lo - la) > Math.max(tol, 1e-9)) continue;
    const { ux: ox, uy: oy } = unitOf(o);
    if (Math.abs(ux * ox + uy * oy) < 0.97) continue;
    if (Math.hypot((o.x1 + o.x2) / 2 - (a.x1 + a.x2) / 2, (o.y1 + o.y2) / 2 - (a.y1 + a.y2) / 2) <= own) continue;
    n += 1;
    if (n >= 50) break;
  }
  return n;
}
