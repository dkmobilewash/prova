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
  ];
}
