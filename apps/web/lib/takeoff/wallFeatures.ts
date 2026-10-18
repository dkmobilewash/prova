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
 * ── THE ORDER OF THIS LIST IS A FILE FORMAT ──
 *
 * `wall-model.json` is trained against these columns in this order. Inserting
 * one in the middle silently reinterprets every number in the model, which
 * would not throw and would not be visibly wrong. `wallFeatures.test.ts`
 * pins the names and the length; add at the END and retrain.
 */
export const FEATURE_NAMES = [
  "thicknessFt",
  "lengthFt",
  "thicknessInches",
  "nearestScheduledDeltaIn",
  "isScheduled",
  "faceRatio",
  "overlapShare",
  "isCurved",
  "offOrthogonalDeg",
  "penDelta",
  "penMean",
  "layerSaysWall",
  "layerSaysNotWall",
  "layerUnknown",
  "parallelNeighbours",
  "neighbourSpacingCv",
  "nearestNeighbourThicknessRatio",
  "localDensity",
  "inHatchSeries",
  "lengthToSheetSpan",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/** Everything the extractor needs that is not the pair itself. */
export type FeatureContext = {
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
  const nearestDelta = Number.isFinite(nearest) ? nearest : -1;

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
  const penDelta = aw > 0 && bw > 0 ? Math.abs(aw - bw) / Math.max(aw, bw) : -1;
  const penMean = aw > 0 && bw > 0 ? (aw + bw) / 2 : -1;

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
  const spacingCv = meanGap !== 0 ? Math.sqrt(variance) / Math.abs(meanGap) : -1;
  const nearestOther = offsets
    .filter((o) => Math.abs(o) > 1e-9)
    .sort((x, y) => Math.abs(x) - Math.abs(y))[0];
  const neighbourRatio =
    nearestOther === undefined
      ? -1
      : Math.abs(nearestOther) / Math.max(Math.abs(offsetOf(a, b)), 1e-9);

  return [
    wall.thicknessFeet,
    wall.lengthFeet,
    thicknessIn,
    nearestDelta,
    scheduledIn.some((named) => Math.abs(named - thicknessIn) <= 0.5) ? 1 : 0,
    longer / shorter,
    Math.min(1, overlapAlong(a, b) / shorter),
    wall.curved === true ? 1 : 0,
    offOrthogonal,
    penDelta,
    penMean,
    verdict === "wall" ? 1 : 0,
    verdict === "not-wall" ? 1 : 0,
    verdict === "unknown" ? 1 : 0,
    offsets.length,
    spacingCv,
    neighbourRatio,
    dense,
    context.inHatchSeries ? 1 : 0,
    sheetSpan > 0 ? lengthOf(a) / sheetSpan : -1,
  ];
}
