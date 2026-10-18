import type { WallCandidate } from "./wallVectors";

/**
 * ── TWO WALLS CANNOT OCCUPY THE SAME FOOTAGE ──
 *
 * A dimension string drawn parallel to the wall it measures pairs with that
 * wall's own face, and the result passes every test in `wallFromPair`: it is
 * parallel, it overlaps completely, it ends with the wall, and the spacing
 * between string and face is a plausible partition thickness. S08 reported
 * 87 ft along a 56 ft hall partition that way — the partition found correctly
 * at 4.50 in, and 31.2 ft of 8.40 in beside it, a thickness no wall on that
 * sheet has.
 *
 * THREE THINGS THAT CANNOT SEPARATE IT, each tried and recorded:
 *
 *   - geometry between the two lines. See the note at rule 6 in
 *     `wallVectors.ts`: every one of those rules is a near miss, because a
 *     dimension string IS parallel to its wall for the whole length of it.
 *   - distance from the printed figures. Built, measured, reverted. S08's
 *     string sits 0.68 ft from a wall face and S13's sits 0.06 ft from one,
 *     so the quantity a threshold would have to split is the same on both
 *     sheets, and every band from 0.20 to 0.35 ft deletes 40 ft of real wall
 *     on S13.
 *   - an orphan THICKNESS. S08's phantom is 8.40 in where the sheet's walls
 *     are 4.5 and 6.5, which looks decisive until S14: its orphan clusters
 *     are 3.38 in holding 112 ft and 16.88 in holding 27 ft, and 160 + 112 is
 *     exactly the 272 ft of 4.5 in wall its key declares. Those orphans are
 *     real wall measured at the wrong thickness, and dropping them costs 19%.
 *
 * WHAT DOES SEPARATE THEM IS THAT THE PHANTOM IS A SECOND CLAIM ON FOOTAGE
 * ALREADY CLAIMED. S08's 8.40 in runs lie on top of the partition that is
 * already counted at 4.50 in; S14's 3.38 in runs are the only coverage those
 * walls have. Measured as the distance between centrelines in units of the
 * two candidates' mean thickness, over seven sheets:
 *
 *     S08   0.37   1.01   1.01  |  then 10.67     three phantoms
 *     S15   0.41                |  then 19.64     one phantom
 *     S09                       |      10.67      nothing to drop
 *     S12                       |      10.67      nothing to drop
 *     S05                       |      10.67      nothing to drop
 *     S14                       |      11.66      its orphans are real
 *     S13                       |      15.48      the sheet distance broke
 *
 * Every phantom is at or under 1.01 and every real wall is at or over 10.67 —
 * on THESE sheets. The 60-page bench disagrees about the upper half of that
 * gap and it is the one with real drawings in it; see
 * `SAME_FOOTAGE_THICKNESSES` below, where the bound is set from both and the
 * window turns out to be 1.01 to 1.3 rather than 1.01 to 10.67.
 *
 * The bound is stated in THICKNESSES so it means the same thing at 1/4" and at
 * 1/8"; `scaleInvariance.eval.ts` exists because this repo has already shipped
 * one gate that did not.
 */

/**
 * How much of the shorter candidate the longer one must cover before this is a
 * second claim rather than two walls that happen to touch.
 *
 * A wall meeting another at a T overlaps it by a few inches at the junction;
 * a dimension string runs the whole length of what it measures. 80% is between
 * those by a wide margin and the data has nothing between 0% and 100%.
 *
 * Of the SHORTER candidate's own span, not of the longer one's — so a 2 ft
 * fragment lying inside a 40 ft wall is fully covered and goes, which is
 * right: it is a piece of that wall, already counted. What survives is a
 * candidate that sticks OUT of its neighbour, because the part hanging over
 * is footage nobody else has claimed.
 */
const COVERED = 0.8;

/** Parallel within two degrees, the same tolerance `wallFromPair` uses. */
const PARALLEL = 0.035;

/**
 * How close the two centrelines must be, in mean thicknesses, to be the same
 * footage.
 *
 * ── THE FIXTURES SAID THIS NUMBER HAD TENFOLD MARGIN. THE BENCH SAYS IT HAS
 *    ABOUT 30%, AND THE BENCH IS THE ONE WITH REAL DRAWINGS IN IT ──
 *
 * The table above is from the twenty synthetic sheets and it is accurate: every
 * phantom is at or under 1.01 and every real wall at or over 10.67, so any
 * bound from 2 to 10 scores them identically. That reading would have shipped a
 * bound of 2.
 *
 * Measured on the 60-page bench instead, against its own answer key:
 *
 *     | bound | holdout found | holdout  | the twenty |
 *     | 1.1   | 32,505 ft     | -0.5%    | 12 of 17   |
 *     | 1.3   | 32,100 ft     | -1.7%    | 12 of 17   |
 *     | 1.6   | 32,054 ft     | -1.8%    | 12 of 17   |
 *     | 2.0   | 32,054 ft     | -1.8%    | 12 of 17   |
 *
 * A bound of 2 deletes 451 ft of REAL wall and buys nothing: the twenty score
 * the same at every value, because their phantoms are all under 1.01 anyway.
 *
 * The reason the synthetic sheets could not see this is worth more than the
 * number. They contain no LAYERED ASSEMBLIES — no furring on block, no shaft
 * wall drawn as its parts, no finish line inboard of a structural face. Real
 * drawings have them, they are genuinely two walls, and their centrelines sit
 * between 1.1 and 1.3 mean thicknesses apart. A fixture set that lacks a
 * feature cannot price a rule that cuts near it, which is the same lesson the
 * removed rule 5 taught from the other direction — there, a one-scale key
 * could not price a scale-dependent gate.
 *
 * So 1.1: above every measured phantom with 9% to spare, below every real wall
 * the bench knows about. That is a TUNED number with a narrow window, not a
 * self-evident one, and it is the kind this file would normally refuse. It
 * earns its place by being bounded on both sides by measurements rather than
 * by one of them and an argument.
 */
const SAME_FOOTAGE_THICKNESSES = 1.1;

/**
 * How near a scheduled thickness counts as a match, in inches.
 *
 * `CLUSTER_INCHES` is 0.5 and this is deliberately the same order: a schedule
 * names an assembly's nominal thickness and a drawing draws it to the line
 * weight it has.
 */
const SCHEDULE_INCHES = 0.5;

export function wallsNotDuplicateCoverage(
  candidates: readonly WallCandidate[],
  /** The sheet's wall-type schedule in inches — `scheduleIn` in the caller. */
  scheduled: readonly number[] = [],
): { kept: WallCandidate[]; dropped: number } {

  const kept = candidates.filter((candidate, index) => {
    // ── A SCHEDULED THICKNESS IS THE INDEPENDENT EVIDENCE THAT OVERRIDES THIS
    //
    // Furring on block is the case this protects, and it is a real assembly:
    // 1-1/2in hat channel and board against an 8in wall, two walls whose
    // centrelines sit one mean thickness apart and which cover each other
    // completely. Nothing about their geometry distinguishes that from the
    // phantom above — what distinguishes it is that a drawing which HAS
    // furring says so in its wall-type schedule.
    //
    // So a candidate whose thickness matches a scheduled assembly is never
    // dropped here. On the twenty fixtures no schedule is supplied, so this
    // exemption is inert there and the measurements above are unaffected; in
    // the app a sheet with a legend keeps its furring.
    const inches = candidate.thicknessFeet * 12;
    if (scheduled.some((named) => Math.abs(named - inches) <= SCHEDULE_INCHES)) return true;

    return !candidates.some(
      (other, otherIndex) =>
        other !== candidate && claimsTheSameFootage(candidate, other, otherIndex < index),
    );
  });
  return { kept, dropped: candidates.length - kept.length };
}

/**
 * How far off a curved run's own circle a point may sit and still be read as
 * on that wall, as a share of the wall's thickness.
 *
 * The same 1.1 the straight test uses for its perpendicular gap, for the same
 * reason: two runs whose centrelines are within about a thickness of each
 * other are measuring one wall, not two. Kept as its own name because it is
 * measured from a circle rather than from a line, and the next person to sweep
 * one should not silently move the other.
 */
const ON_THE_SAME_ARC_THICKNESSES = 1.1;

/**
 * True when one run lies along the other's drawn arc.
 *
 * Both ends are tested, not the middle: a run spanning most of an arc is
 * stored as that arc's chord, and the middle of a long chord is inside the
 * circle by the sagitta — testing it would throw away the real wall and keep
 * the impostor. The ends sit on the circle either way.
 *
 * The ANGULAR span is tested too, so a wall on the far side of the same circle
 * — a round room's opposite wall — is not read as a duplicate of this one.
 */
function ownerFeetPerUnit(owner: WallCandidate, arc: { r: number }): number {
  // A curved run's chord is shorter than its arc, so the chord cannot give the
  // scale. The radius can: the arc subtends `lengthFeet / (r * feetPerUnit)`
  // radians, and the chord subtends the same angle, so solving the chord
  // relation gives the scale without a second source.
  //
  // chord = 2 r sin(sweep/2), and sweep = lengthFeet / (r * feetPerUnit).
  // One bisection on feetPerUnit; the relation is monotonic over any arc under
  // a full turn, which every drawn wall is.
  const chord = Math.hypot(owner.x2 - owner.x1, owner.y2 - owner.y1);
  if (!(chord > 0) || !(owner.lengthFeet > 0) || !(arc.r > 0)) return 0;
  let lo = 1e-9;
  let hi = owner.lengthFeet / chord; // the straight-line case, an upper bound
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const sweep = owner.lengthFeet / (arc.r * mid);
    const predicted = 2 * arc.r * Math.sin(Math.min(Math.PI, sweep) / 2);
    if (predicted > chord) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function coversTheSameArc(candidate: WallCandidate, other: WallCandidate): boolean {
  // The arc belongs to whichever run is curved; when both are, the longer
  // one's is used, which is the one `claimsTheSameFootage` is asking about.
  const arc = other.arc;
  if (arc === undefined || !(arc.r > 0)) return false;

  const meanThickness = (candidate.thicknessFeet + other.thicknessFeet) / 2;
  if (meanThickness <= 0) return false;
  // Units per foot, from the run that owns the arc. On a curved run
  // `lengthFeet` is the ARC and the chord is shorter, so the chord cannot be
  // used for this — the radius and the arc length can, and they are both in
  // the right spaces already.
  const owner = other;
  // The sweep in radians, from the owner's own arc length and radius — the
  // two numbers that are each already in their own space, so no feet-per-unit
  // is needed and none is guessed.
  const sweep = owner.lengthFeet > 0 ? owner.lengthFeet / (arc.r * ownerFeetPerUnit(owner, arc)) : 0;
  if (!(sweep > 0)) return false;
  const band = (meanThickness * ON_THE_SAME_ARC_THICKNESSES) / ownerFeetPerUnit(owner, arc);

  const offCircle = (x: number, y: number) => Math.abs(Math.hypot(x - arc.cx, y - arc.cy) - arc.r);
  if (offCircle(candidate.x1, candidate.y1) > band) return false;
  if (offCircle(candidate.x2, candidate.y2) > band) return false;

  // ── AND ON THE SAME PART OF IT ──
  //
  // Without this, a circular room's far wall is on the same circle and would
  // be swallowed. The owner's own ends give the span that is actually drawn.
  const angleAt = (x: number, y: number) => Math.atan2(y - arc.cy, x - arc.cx);
  const within = (a: number, lo: number, hi: number) => {
    const norm = (v: number) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const span = norm(hi - lo);
    const at = norm(a - lo);
    return at <= span;
  };
  const o1 = angleAt(owner.x1, owner.y1);
  const o2 = angleAt(owner.x2, owner.y2);
  // The owner sweeps one way or the other; take the direction that matches the
  // sweep its arc length implies rather than guessing.
  const forward = ((o2 - o1 + 4 * Math.PI) % (2 * Math.PI)) <= sweep + 0.2;
  const lo = forward ? o1 : o2;
  const hi = forward ? o2 : o1;
  const ends = [
    angleAt(candidate.x1, candidate.y1),
    angleAt(candidate.x2, candidate.y2),
  ];
  return ends.every((a) => within(a, lo, hi));
}

/**
 * True when `other` is at least as long and already covers `candidate`.
 *
 * `otherIsEarlier` breaks an exact tie. Without it two identical candidates
 * each see the other as a duplicate and BOTH are dropped, which counts the
 * footage zero times instead of once — the one outcome worse than counting it
 * twice, and the reason this takes an index at all. Measured on a tie of
 * equal length and equal thickness, where thickness cannot break it either.
 */
function claimsTheSameFootage(
  candidate: WallCandidate,
  other: WallCandidate,
  otherIsEarlier: boolean,
): boolean {
  if (other.lengthFeet < candidate.lengthFeet) return false;
  if (other.lengthFeet === candidate.lengthFeet) {
    if (other.thicknessFeet < candidate.thicknessFeet) return false;
    // Equal on both: the one that arrived first is the keeper.
    if (other.thicknessFeet === candidate.thicknessFeet && !otherIsEarlier) return false;
  }

  // ── A CURVED RUN IS NOT ITS CHORD, AND EVERYTHING BELOW ASSUMES IT IS ──
  //
  // The test that follows projects `candidate` into `other`'s chord direction
  // and refuses anything more than two degrees off it. That is right for two
  // straight walls and meaningless for an arc: a 55 ft wall sweeping 117
  // degrees has a chord that cuts through the building, and a 7.80 ft piece
  // lying ON that wall reads as **53 degrees** off it. So it was not a
  // duplicate, and 7.8 ft of one wall was reported twice on a GC-facing
  // number.
  //
  // `WallCandidate.arc` carries the circle the run was drawn on, because the
  // chord cannot answer this and `curved`'s own note says so. When either run
  // has one, the question becomes the right one: does the shorter run lie
  // along the longer one's path?
  // ONLY when the longer run — the one doing the covering — owns the arc.
  //
  // Asking this the other way round answers nothing: if `candidate` is the
  // curved wall, testing its own ends against its own circle is true by
  // construction, and every longer run on the sheet becomes its duplicate.
  // That is not hypothetical — it was the first version of this branch, and
  // it removed EVERY curved wall from Cedar Hollow, taking the sheet from
  // -0.6% to -17.7%. A straight run also cannot cover a curved wall in any
  // case worth catching: the arc is longer than the chord, so the arc is
  // never the shorter of the two.
  if (other.arc !== undefined) {
    return coversTheSameArc(candidate, other);
  }

  const dx = other.x2 - other.x1;
  const dy = other.y2 - other.y1;
  const len = Math.hypot(dx, dy);
  const cdx = candidate.x2 - candidate.x1;
  const cdy = candidate.y2 - candidate.y1;
  const clen = Math.hypot(cdx, cdy);
  if (len <= 0 || clen <= 0) return false;

  const ux = dx / len;
  const uy = dy / len;
  if (Math.abs(ux * (cdy / clen) - uy * (cdx / clen)) > PARALLEL) return false;

  const at = (x: number, y: number) => ({
    along: (x - other.x1) * ux + (y - other.y1) * uy,
    perp: Math.abs(-(x - other.x1) * uy + (y - other.y1) * ux),
  });
  const head = at(candidate.x1, candidate.y1);
  const tail = at(candidate.x2, candidate.y2);
  const lo = Math.max(0, Math.min(head.along, tail.along));
  const hi = Math.min(len, Math.max(head.along, tail.along));
  const span = Math.abs(head.along - tail.along);
  if (span <= 0 || hi <= lo || (hi - lo) / span < COVERED) return false;

  // Both candidates measure the same drawing, so either one's feet-per-unit
  // converts the gap. `other`'s is used because it is the longer and therefore
  // the better conditioned of the two.
  const perpFeet = ((head.perp + tail.perp) / 2) * (other.lengthFeet / len);
  const meanThickness = (candidate.thicknessFeet + other.thicknessFeet) / 2;
  if (meanThickness <= 0) return false;
  return perpFeet / meanThickness <= SAME_FOOTAGE_THICKNESSES;
}
