import { CAP_SLACK_FEET, MAX_OPENING_FEET } from "./mergeWalls";
import { canonicalStrokeOrder, type StrokeSegment, type WallCandidate } from "./wallVectors";

/**
 * ── A CURVED WALL IS MEASURED ALONG ITS CENTRELINE, NOT ACROSS ITS CHORD ──
 *
 * S07 is a four-sided building with a curved bay: an arc of radius 7.21 ft
 * from (12,0) to (24,0), whose chord is 12.0 ft and whose centreline arc is
 * 14.17 ft. The sheet reported 182 ft against a key of 200, and the arc was
 * contributing NOTHING — not a short version of itself, nothing at all. The
 * runs jumped from x = 11.9 straight to x = 24.1 along y = 0.
 *
 * WHY, measured rather than assumed. `sheetStrokes.ts` flattens the arc into
 * 71 line segments, chords of about 0.67 ft each, and marks every one
 * `curved: true`. `StrokeSegment.curved`'s own note explains who gets them:
 * the room engine skips them and THE PAIRER OWNS THEM, because the pairer
 * measures face to face and that is what gives an arc its true thickness.
 *
 * The pairer does pair them. It pairs each 0.67 ft chord of the inner face
 * with the facing 0.67 ft chord of the outer face, producing dozens of
 * candidates 8 inches long, every one of which dies on `minLengthFeet`. What
 * cannot happen is the step after: `mergeWalls` joins two runs only if they
 * are parallel within `SAME_ANGLE`, which is 0.05 rad — 2.9 degrees — and
 * 113 degrees of arc over 35 chords per face turns 3.2 degrees at each joint.
 * The pieces miss the tolerance by a third of a degree and nothing assembles.
 *
 * Widening that tolerance is the wrong fix twice over. It would let genuinely
 * different straight walls merge, and the run it produced would still be
 * measured end to end — 12.0 ft of chord for 14.17 ft of wall, which is a
 * 15% under-measure on a bid for the one shape that is expensive to build.
 *
 * So curves are assembled HERE, as chains, and a chain's length is the sum of
 * its pieces. For two concentric faces the mean of the two path lengths is
 * exactly the centreline arc length — the inner face is short and the outer
 * long by the same amount — so no arc fitting, no radius and no centre angle
 * is needed to get the number the key asks for.
 */

/** How far apart two pieces' ends may be and still be one chain, in feet. */
const JOINT_FEET = 0.05;

/**
 * How sharply a chain may turn at one joint, in radians.
 *
 * 0.35 is 20 degrees, against the 3.2 of this arc and the 5.0 the coarsest
 * flattening in `sheetStrokes.ts` can produce. A real corner turns 90, so
 * this separates a curve from a corner with an order of magnitude to spare
 * and does not need to be a judged number.
 *
 * ── ITS MUTATION SURVIVES, AND SAYING SO IS BETTER THAN A CONTRIVED CASE ──
 *
 * Removing this test changes no test in this file and no figure on either
 * fixture set. Every attempt at a case ran into `FACE_LENGTH_RATIO` refusing
 * the pair first, and that is geometry rather than luck: offsetting an L
 * lengthens both of the outer legs and shortens both inner ones, so two
 * corner-shaped chains 6-1/2in apart are never within a quarter of each
 * other's length. The ratio catches corners before this does.
 *
 * It is kept because the two guards answer different questions — this one
 * stops a chain being ASSEMBLED through a corner, the ratio stops two
 * corner-shaped chains being PAIRED — and because a straight wall only stays
 * out of this file by being one long segment, which is a property of the
 * drawing rather than of this code. If a future export emits straight walls
 * in short pieces, this is the test that keeps their corners apart, and
 * nothing here will have told you.
 */
const TURN_RAD = 0.35;

/** A chain shorter than this is a fillet or a door swing, not a wall. */
const MIN_CHAIN_FEET = 2;

/**
 * How unequal two faces' path lengths may be, as a ratio.
 *
 * The two faces of a curved wall are NOT the same length — that is the whole
 * geometry of it. A 14.17 ft centreline at radius 7.21 with a 6-1/2in wall
 * gives 13.64 and 14.70, a ratio of 1.08. This allows a quarter, which covers
 * a tighter radius than any wall is built to.
 */
const FACE_LENGTH_RATIO = 1.25;

type Chain = { points: { x: number; y: number }[]; lengthUnits: number };

/**
 * The most short pieces this engine will try to assemble.
 *
 * See the refusal in `curvedWalls` for the measurement behind it. Not a
 * guess at a safe number: it is the point where a quadratic over `pieces`
 * costs more than the whole rest of detection.
 */
export const MAX_CURVE_PIECES = 8_000;

export type CurvedOptions = {
  /** Units per foot, as everywhere else in this module. */
  feetPerUnit: number;
  minThicknessFeet: number;
  maxThicknessFeet: number;
  /**
   * Called instead of assembling, when the sheet carries more short pieces
   * than `MAX_CURVE_PIECES`. The caller turns it into a caution — a pass that
   * silently did not run is the vacuous green this repo keeps paying for.
   */
  onRefused?: (pieces: number) => void;
  /** How many short pieces the engine was handed, reported whether or not the
   *  cap fires. It is what says whether the cap is a live guard or dead code. */
  onCount?: (pieces: number) => void;
};

export function curvedWalls(
  segments: readonly StrokeSegment[],
  options: CurvedOptions,
): WallCandidate[] {
  // ── `curved` IS ABOUT PROVENANCE, NOT SHAPE, AND THIS IS WHERE THAT BITES ──
  //
  // The flag marks a piece that `sheetStrokes.ts` produced by flattening a
  // Bézier. It says nothing about a drawing that polygonised its own arcs
  // before exporting, which is what S07 does: its bay is 202 straight
  // segments of 0.15 ft at pen 0.8, tracing a radius of 7.21 ft, with the
  // flag on none of them.
  //
  // The first version of this file filtered on `curved === true` and found
  // the sheet's four door swings and one fixture circle — every arc on the
  // page EXCEPT the wall. So the test is the shape: short pieces, joined end
  // to end, turning consistently.
  const pieces = segments.filter((one) => {
    if (one.curved === true) return true;
    const feet = Math.hypot(one.x2 - one.x1, one.y2 - one.y1) * options.feetPerUnit;
    return feet > 0 && feet <= MAX_PIECE_FEET;
  });
  if (pieces.length < 3) return [];

  // ── A SHEET THIS HATCHED CANNOT BE ASKED ABOUT CURVES ──
  //
  // `assemble` scans every piece on every growth step, so its cost is
  // quadratic in `pieces.length`. That was fine while "short piece" meant a
  // handful of arc segments, and it is not fine on a real architectural
  // sheet: Camp Bow Wow's A102 has 143,438 segments and **126,943 of them —
  // 88% — are under 1.5 ft**, because hatching is drawn in tiny strokes.
  //
  // Measured, after a profile said so and after two attempts to index the
  // scan made it WORSE rather than better:
  //
  //   | A102                      | time       |
  //   | the whole of findWallsOnSheet | 61,330 ms |
  //   | …of which curvedWalls     | 58,901 ms (96%) |
  //   | …of which the pair engine | 479 ms |
  //
  // So the pair test everybody suspected — this repo's own `MAX_PAIR_TESTS`
  // scar included — was innocent, and the curve assembly was the whole cost.
  //
  // ── REFUSING THE PASS, NOT THE SHEET ──
  //
  // `MAX_PAIR_TESTS` refuses a whole sheet when it is too dense to pair, and
  // A101 gets nothing at all as a result. This refuses only the CURVE pass:
  // the straight-wall engines still run and the sheet still gets a number.
  // A curved wall on a sheet like this goes unfound, which is a real loss and
  // is why the caller is told rather than left to wonder — but it is a
  // smaller loss than a minute of nothing, and far smaller than a refusal.
  //
  // The cap is where the quadratic stops being affordable rather than a round
  // number: 8,000 pieces is about 1.5 seconds of assembly, and no fixture in
  // this repo's twenty-plan set comes near it — the densest is under 900.
  options.onCount?.(pieces.length);
  if (pieces.length > MAX_CURVE_PIECES) {
    options.onRefused?.(pieces.length);
    return [];
  }

  const chains = joinAcrossOpenings(
    assemble(pieces, JOINT_FEET / options.feetPerUnit),
    options.feetPerUnit,
  );
  const arcs = chains.filter(
    (chain) =>
      chain.lengthUnits * options.feetPerUnit >= MIN_CHAIN_FEET &&
      totalTurn(chain) >= MIN_TOTAL_TURN &&
      opensOut(chain),
  );
  return pairChains(arcs, options);
}

/**
 * How long a piece may be and still be read as part of an arc, in feet.
 *
 * A polygonised arc is drawn in pieces far shorter than any wall: 0.15 ft on
 * S07's bay, 0.67 ft on a flattened door swing. A straight wall arrives as ONE
 * segment running its whole length, so a bound here is what keeps straight
 * walls out of this file entirely rather than a second rule saying so.
 *
 * 1.5 ft is ten times S07's pieces and twice the coarsest flattening
 * `sheetStrokes.ts` produces, and under the 2 ft `WALL_MIN_LENGTH_FEET` that
 * the pairer applies to a wall of its own.
 */
const MAX_PIECE_FEET = 1.5;

/**
 * How far a chain must turn in total, in radians, before it is an arc.
 *
 * Without this the assembler reads a DASHED STRAIGHT LINE as a curved wall,
 * and a row of jamb ticks or hatch strokes as one too — all of them are short
 * pieces joined end to end. An arc turns; none of those do.
 *
 * 0.26 is 15 degrees. S07's bay turns 113. A dashed line turns 0, and the
 * flattening error that makes a straight line turn at all is bounded by
 * `CURVE_FLATNESS_POINTS`, which is half a point.
 */
const MIN_TOTAL_TURN = 0.26;

/**
 * How far apart a chain's two ends must be, as a fraction of the path between
 * them, for it to be a WALL rather than a loop.
 *
 * ── A CLOSED CHAIN IS NOT A WALL, AND IT HAS NO LENGTH LIMIT ──
 *
 * Found on a real drawing, and it is the worst defect this module has had.
 * `FLOOR PLAN LEVEL 1` of a real permit set reported **2,324,222 ft** of wall —
 * 440 miles — and the run responsible was this:
 *
 *     2.321e+6 ft   8.01in   (0.25,0.37) -> (0.25,0.37)   CURVED
 *
 * Its two endpoints are the SAME POINT. The chain closed on itself, so its
 * chord is zero while its path wanders without bound, and `lengthFeet` is the
 * path. Two more runs on the same sheet did the same thing at 552 and 436 ft.
 * The thickness came out at 8.01in, which is a plausible wall, so nothing
 * downstream had any reason to doubt it.
 *
 * NEITHER FIXTURE SET CAN PRODUCE THIS. The twenty draw one bay arc and a few
 * door swings; the bench's arcs are flattened coarsely enough to be excluded by
 * `MAX_PIECE_FEET`. A real sheet has thousands of short pieces — hatching,
 * poché, stipple, insulation batting — and a greedy chain walks straight
 * through them and comes back where it started.
 *
 * The bound is on the CHORD against the PATH, which is scale-free and says
 * exactly what a wall is: a semicircle scores 0.64, a 270-degree arc 0.30, a
 * 350-degree arc 0.028, and a closed loop 0. A quarter admits any arc up to
 * about 280 degrees — more than any wall is built to — and refuses everything
 * that curls back on itself.
 *
 * It is NOT a cap on length, deliberately. A cap would have to guess how long
 * a wall may be; this asks whether the thing is a wall at all.
 */
const OPENS_OUT = 0.25;

/** True when the chain's ends are far enough apart to be a wall's two ends. */
function opensOut(chain: Chain): boolean {
  const head = chain.points[0];
  const tail = chain.points[chain.points.length - 1];
  if (chain.lengthUnits <= 0) return false;
  return Math.hypot(tail.x - head.x, tail.y - head.y) / chain.lengthUnits >= OPENS_OUT;
}

/** The sum of the absolute turns at every interior vertex of a chain. */
/**
 * ── HOW FAR THE CHAIN TURNS, NET — NOT HOW MUCH IT WOBBLES ──
 *
 * This summed the ABSOLUTE turn at every vertex, and that was safe only while
 * chains were short. Once `joinAcrossOpenings` let a chain run the length of a
 * wall, a straight line drawn in many small pieces accumulated enough jitter
 * to pass: ELEVEN03's forming plan reported **113 curved runs and 974 ft**,
 * among them a 56.7 ft "arc" whose two endpoints have the same y to a tenth of
 * a foot. A straight line, called a curve, because it had enough vertices.
 *
 * `MIN_TOTAL_TURN`'s own note says what the test is for — "S07's bay turns
 * 113. A dashed line turns 0" — and a dashed line turns 0 NET, while its
 * summed wobble grows without bound in the number of pieces. So the
 * implementation is brought to what the constant already claimed.
 *
 * Signed, then absolute at the end: an arc turns the same way throughout and
 * accumulates, including past 180 degrees where a start-to-end angle
 * comparison would wrap and read small. Jitter cancels.
 */
function totalTurn(chain: Chain): number {
  let signed = 0;
  for (let k = 1; k < chain.points.length - 1; k += 1) {
    signed += signedTurnAt(chain.points[k - 1], chain.points[k], chain.points[k + 1]);
  }
  return Math.abs(signed);
}

/** The turn at a vertex, positive to the left and negative to the right. */
function signedTurnAt(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const in1 = Math.atan2(b.y - a.y, b.x - a.x);
  const in2 = Math.atan2(c.y - b.y, c.x - b.x);
  let delta = in2 - in1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/**
 * Links pieces end to end into chains.
 *
 * Greedy and deliberately so: a flattened arc arrives as a run of pieces that
 * already share endpoints exactly, so there is nothing to optimise. The joint
 * tolerance exists for the case where two separate path operators draw the
 * same arc in two halves.
 */
function assemble(piecesAsGiven: readonly StrokeSegment[], jointUnits: number): Chain[] {
  // ── ASSEMBLED BY GEOMETRY, NOT BY THE ORDER THE FILE STORES ──
  //
  // Seeds ran in file order and a chain grew by the FIRST unused piece that
  // touched its tip inside the turn limit, so the same strokes reversed made
  // different chains. Seeds now run in reading order and the chain takes the
  // piece that turns LEAST at the joint, nearest joint first among equals.
  const pieces = canonicalStrokeOrder(piecesAsGiven);
  const used = new Array(pieces.length).fill(false);
  const chains: Chain[] = [];

  for (let i = 0; i < pieces.length; i += 1) {
    if (used[i]) continue;
    used[i] = true;
    const first = pieces[i];
    const points = [
      { x: first.x1, y: first.y1 },
      { x: first.x2, y: first.y2 },
    ];
    // Grow from both ends, so a chain found from its middle still completes.
    for (const atEnd of [true, false]) {
      let growing = true;
      while (growing) {
        growing = false;
        const tip = atEnd ? points[points.length - 1] : points[0];
        const before = atEnd ? points[points.length - 2] : points[1];
        let bestJ = -1;
        let bestNext: { x: number; y: number } | null = null;
        let bestTurn = Number.POSITIVE_INFINITY;
        let bestJoint = Number.POSITIVE_INFINITY;
        for (let j = 0; j < pieces.length; j += 1) {
          if (used[j]) continue;
          const piece = pieces[j];
          const headGap = Math.hypot(piece.x1 - tip.x, piece.y1 - tip.y);
          const tailGap = Math.hypot(piece.x2 - tip.x, piece.y2 - tip.y);
          const heads = headGap <= jointUnits;
          const tails = tailGap <= jointUnits;
          if (!heads && !tails) continue;
          const next = heads ? { x: piece.x2, y: piece.y2 } : { x: piece.x1, y: piece.y1 };
          const turn = turnAt(before, tip, next);
          if (turn > TURN_RAD) continue;
          const joint = heads ? headGap : tailGap;
          if (turn < bestTurn || (turn === bestTurn && joint < bestJoint)) {
            bestJ = j;
            bestNext = next;
            bestTurn = turn;
            bestJoint = joint;
          }
        }
        if (bestJ !== -1 && bestNext !== null) {
          used[bestJ] = true;
          if (atEnd) points.push(bestNext);
          else points.unshift(bestNext);
          growing = true;
        }
      }
    }
    let lengthUnits = 0;
    for (let k = 1; k < points.length; k += 1) {
      lengthUnits += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
    }
    chains.push({ points, lengthUnits });
  }
  return chains;
}

/**
 * How much a chain must bend, on its own, before an opening may extend it.
 *
 * ── WHAT THIS STOPS, MEASURED ──
 *
 * Joining across openings shipped without this and put 19 curved runs — 176 ft
 * — onto a real forming plan that had none before. Looking at them on the
 * drawing: they sit on HATCHED fill, where the short parallel strokes line up
 * end to end and chain into something that looks like a long wall, and on a
 * stair's diagonal break line.
 *
 * That is the corridor failure `mergeWalls` records, arriving in the curve
 * path. Its answer is `gapIsCrossing` — bridge only when something bounds the
 * gap — and this file's own note said to borrow it if a phantom ever appeared.
 * This is the cheaper discriminator that the evidence actually points at: a
 * hatch stroke and a break line are STRAIGHT, and an opening in a curved wall
 * joins two pieces of an ARC. So the test is not what is at the gap's ends, it
 * is whether the things being joined were ever arcs.
 *
 * ── WHY IT IS THIS LOW, AND NOT `MIN_TOTAL_TURN` ──
 *
 * It cannot be 15 degrees. The whole reason joining happens BEFORE the arc
 * filter is that a fragment of a gentle arc does not reach that bar: 7 ft of a
 * 26.9 ft-radius wall turns 14.9. But it does not turn ZERO, and a straight
 * stroke does. Three degrees is comfortably under every real fragment measured
 * here and above the drafting jitter of a line that is meant to be straight.
 *
 * Paired with a point count, because a two-point chain has no interior vertex
 * and therefore no turn to measure at all — which is exactly what a hatch
 * stroke is.
 */
const ARC_EVIDENCE = (3 * Math.PI) / 180;

/**
 * How far two pieces may disagree about where their centre is, as a share of
 * the radius, and still be read as one arc interrupted by an opening.
 *
 * ── THE TEST IS THE DEFINITION, WHICH IS WHY IT IS THIS ONE ──
 *
 * "A window in a curved wall" means the wall continues on the same CIRCLE on
 * the other side of the hole. So the question is not how long the pieces are,
 * how far apart, how much they bend or which way — all of which were tried and
 * each of which admitted hatching, because a dense enough field of short
 * strokes satisfies any one of them somewhere.
 *
 * Each piece is given the circle through its first, middle and last point.
 * Two pieces of one drawn arc agree on that circle closely; a chain of hatch
 * strokes and the next chain along do not, because nothing was ever drawn
 * round a common centre.
 *
 * Loose on purpose. A flattened arc's end chord is slightly off the true
 * circle, drafting is not exact, and a piece between two openings can be short
 * enough that its circumcircle is poorly conditioned. The gap between a real
 * pair and a hatch pair is far wider than this, so the tolerance buys safety
 * without buying phantoms.
 */
const SAME_CIRCLE_CENTRE = 0.25;

/** The same, for the radii: two pieces of one wall are the same distance out. */
const SAME_CIRCLE_RADIUS = 0.3;

/**
 * ── A CURVED WALL WITH A WINDOW IN IT IS STILL ONE WALL ──
 *
 * `assemble` chains pieces that touch, within a joint's slack. An opening does
 * not touch: the drawing simply stops and starts again on the other side of
 * the window, so a curved wall carrying three windows assembles as four
 * separate chains.
 *
 * Measured on a held-out library plan whose reading room is a 55 ft arc with
 * three 4 ft windows in it. The gaps between the fragments came back at
 * **4.00 ft and 2.99 ft** — the window and door widths from that plan's own
 * key, to the inch. Nothing was wrong with the assembly; the wall is drawn in
 * pieces because it has holes in it.
 *
 * ── AND THE FRAGMENTS WERE NOT MERELY SHORT, THEY WERE DISCARDED ──
 *
 * This is why the join belongs HERE and not after the filters. `MIN_TOTAL_TURN`
 * asks whether a chain turns enough to be an arc, and how much a piece turns
 * depends on its radius: a 7 ft fragment of a 26.9 ft-radius wall turns 14.9
 * degrees, just under the 15 the test wants, so it was thrown away as "not an
 * arc" — while the whole wall it belongs to turns 117. Joining first means the
 * test is asked of the WALL, which is the thing it is actually about.
 *
 * A dashed straight line still fails it, which is what that constant is for: a
 * joined dashed line turns zero.
 *
 * ── THE WIDTH IS THE PRODUCT'S OWN, NOT A SECOND ONE ──
 *
 * `MAX_OPENING_FEET` and `CAP_SLACK_FEET` are `mergeWalls`'s, where the same
 * question is answered for straight walls, and the slack is there because a
 * standard opening lands exactly ON the cap far more often than just inside
 * it. Two copies of "how wide is a door" would drift.
 *
 * ── WHAT THIS DOES NOT COPY FROM `mergeWalls`, AND THE RISK THAT CARRIES ──
 *
 * That file bridges a gap only when something bounds it, because bridging on
 * width alone once drew wall straight across a 5'-7" corridor — 39 ft of wall
 * nobody can build. The same check is not applied here, deliberately and with
 * the reason stated: joining two chains requires the direction to CONTINUE
 * through the gap within `TURN_RAD` at both ends, and two arcs that face each
 * other across a corridor do not continue each other's curvature. A corridor
 * is bounded by walls that meet it at a right angle, which is four times that
 * tolerance.
 *
 * It is a weaker argument than a measurement, so the guards are the check: if
 * a fixture or the bench grows a curved phantom, this is the first thing to
 * suspect and `gapIsCrossing` is the thing to borrow.
 */
function joinAcrossOpenings(chains: readonly Chain[], feetPerUnit: number): Chain[] {
  if (chains.length < 2 || !(feetPerUnit > 0)) return [...chains];
  const widest = (MAX_OPENING_FEET + CAP_SLACK_FEET) / feetPerUnit;
  // Anything this close `assemble` has already joined; re-joining it here
  // would walk the same chain twice.
  const touching = JOINT_FEET / feetPerUnit;

  // ── GROWN FROM BOTH ENDS, THE WAY `assemble` DOES, AND NOT RESTARTED ──
  //
  // The first version re-ran the whole pairwise scan after every join, which
  // is the number of joins times the square of the chain count. On the bench's
  // densest sheets that is minutes rather than the two seconds the whole
  // suite takes, and `curvedWalls` has been the slow part of this pipeline
  // before: it was 96% of a 61-second run on a real sheet until
  // `MAX_CURVE_PIECES` was added.
  //
  // This walks each chain once and extends it from both ends, so the work is
  // quadratic in the chain count and nothing is scanned twice. It is the same
  // shape as `assemble` immediately above, deliberately — one idiom for
  // "grow a chain", in one file.
  const used = new Array(chains.length).fill(false);
  const out: Chain[] = [];

  for (let i = 0; i < chains.length; i += 1) {
    if (used[i]) continue;
    used[i] = true;
    let points = [...chains[i].points];
    let lengthUnits = chains[i].lengthUnits;

    for (const atEnd of [true, false]) {
      let growing = true;
      while (growing) {
        growing = false;
        if (!looksLikeArc(points)) break;
        const tip = atEnd ? points[points.length - 1] : points[0];
        const before = atEnd ? points[points.length - 2] : points[1];
        if (before === undefined) break;

        // The NEAREST chain across the opening, not the first in the list.
        let bestJ = -1;
        let bestGap = Number.POSITIVE_INFINITY;
        let bestFromHead = true;
        for (let j = 0; j < chains.length; j += 1) {
          if (used[j]) continue;
          const other = chains[j];
          if (other.points.length < 2) continue;
          // A STRAIGHT PIECE IS NOT PART OF AN ARC, so an opening cannot
          // extend it. Checked on both chains: joining is symmetric, and a real
          // arc fragment bends at both ends of the gap.
          if (!looksLikeArc(other.points)) continue;
          if (!sameCircle(points, other.points)) continue;
          for (const fromHead of [true, false]) {
            const otherTip = fromHead ? other.points[0] : other.points[other.points.length - 1];
            const otherNext = fromHead ? other.points[1] : other.points[other.points.length - 2];
            const gap = Math.hypot(otherTip.x - tip.x, otherTip.y - tip.y);
            if (gap <= touching || gap > widest) continue;
            if (turnAt(before, tip, otherTip) > TURN_RAD) continue;
            if (turnAt(tip, otherTip, otherNext) > TURN_RAD) continue;
            if (gap < bestGap) {
              bestGap = gap;
              bestJ = j;
              bestFromHead = fromHead;
            }
          }
        }
        if (bestJ !== -1) {
          const other = chains[bestJ];
          const add = bestFromHead ? other.points : [...other.points].reverse();
          points = atEnd ? [...points, ...add] : [...[...add].reverse(), ...points];
          lengthUnits += bestGap + other.lengthUnits;
          used[bestJ] = true;
          growing = true;
        }
      }
    }
    out.push({ points, lengthUnits });
  }
  return out;
}

/**
 * Whether a chain bends enough, by itself, to be part of a drawn arc.
 *
 * Two points cannot: there is no interior vertex, so there is no turn to
 * measure. That is the shape of a hatch stroke and of a stair's break line,
 * and both were being joined into long phantom walls.
 */
function looksLikeArc(points: readonly { x: number; y: number }[]): boolean {
  if (points.length < 3) return false;
  let signed = 0;
  let total = 0;
  for (let k = 1; k < points.length - 1; k += 1) {
    const turn = signedTurnAt(points[k - 1], points[k], points[k + 1]);
    signed += turn;
    total += Math.abs(turn);
  }
  void total;
  return Math.abs(signed) >= ARC_EVIDENCE;
}

/** The circle a chain was drawn on, in the shape `WallCandidate.arc` wants. */
function arcOf(
  points: readonly { x: number; y: number }[],
): { cx: number; cy: number; r: number } | undefined {
  const c = circleOf(points);
  return c === null ? undefined : { cx: c.x, cy: c.y, r: c.r };
}

/** The circle through a chain's first, middle and last point, or null when
 *  those three are too nearly collinear for one to be meaningful. */
function circleOf(
  points: readonly { x: number; y: number }[],
): { x: number; y: number; r: number } | null {
  if (points.length < 3) return null;
  const a = points[0];
  const b = points[Math.floor(points.length / 2)];
  const c = points[points.length - 1];
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - x, a.y - y);
  return r > 0 && Number.isFinite(r) ? { x, y, r } : null;
}

/** Whether two chains were drawn around the same centre, at the same radius. */
function sameCircle(
  one: readonly { x: number; y: number }[],
  two: readonly { x: number; y: number }[],
): boolean {
  const p = circleOf(one);
  const q = circleOf(two);
  if (p === null || q === null) return false;
  const scale = Math.min(p.r, q.r);
  if (!(scale > 0)) return false;
  if (Math.hypot(p.x - q.x, p.y - q.y) / scale > SAME_CIRCLE_CENTRE) return false;
  return Math.abs(p.r - q.r) / scale <= SAME_CIRCLE_RADIUS;
}

function turnAt(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const in1 = Math.atan2(b.y - a.y, b.x - a.x);
  const in2 = Math.atan2(c.y - b.y, c.x - b.x);
  let delta = Math.abs(in2 - in1);
  if (delta > Math.PI) delta = 2 * Math.PI - delta;
  return delta;
}

/**
 * Pairs two chains that face each other across a plausible wall thickness.
 *
 * The thickness is the MEDIAN distance from one chain's vertices to the
 * other's path, not the mean: a chain that overshoots its partner at one end
 * — which a drawn arc does wherever it meets a straight wall — would drag a
 * mean out of the thickness window, and the median ignores it.
 */
function pairChains(chains: readonly Chain[], options: CurvedOptions): WallCandidate[] {
  const out: WallCandidate[] = [];
  const taken = new Array(chains.length).fill(false);

  for (let i = 0; i < chains.length; i += 1) {
    if (taken[i]) continue;
    let best: { j: number; thicknessUnits: number } | null = null;
    for (let j = 0; j < chains.length; j += 1) {
      if (i === j || taken[j]) continue;
      const a = chains[i];
      const b = chains[j];
      const ratio =
        Math.max(a.lengthUnits, b.lengthUnits) / Math.max(Math.min(a.lengthUnits, b.lengthUnits), 1e-9);
      if (ratio > FACE_LENGTH_RATIO) continue;
      const gap = medianGap(a, b);
      if (gap === null) continue;
      const feet = gap * options.feetPerUnit;
      if (feet < options.minThicknessFeet || feet > options.maxThicknessFeet) continue;
      if (best === null || gap < best.thicknessUnits) best = { j, thicknessUnits: gap };
    }
    if (best === null) continue;
    taken[i] = true;
    taken[best.j] = true;
    const a = chains[i];
    const b = chains[best.j];
    // The mean of the two faces' path lengths IS the centreline arc length for
    // concentric faces, which is why no arc is fitted here.
    const lengthFeet = ((a.lengthUnits + b.lengthUnits) / 2) * options.feetPerUnit;
    // The endpoints are the midpoints of the two chains' ends, so a reviewer
    // and `joinAtCorners` both see a line that starts and ends where the wall
    // does. `lengthFeet` carries the truth; this chord does not.
    const aHead = a.points[0];
    const aTail = a.points[a.points.length - 1];
    const bHead = b.points[0];
    const bTail = b.points[b.points.length - 1];
    const sameWay =
      Math.hypot(aHead.x - bHead.x, aHead.y - bHead.y) <=
      Math.hypot(aHead.x - bTail.x, aHead.y - bTail.y);
    const head = sameWay ? bHead : bTail;
    const tail = sameWay ? bTail : bHead;
    out.push({
      x1: (aHead.x + head.x) / 2,
      y1: (aHead.y + head.y) / 2,
      x2: (aTail.x + tail.x) / 2,
      y2: (aTail.y + tail.y) / 2,
      thicknessFeet: best.thicknessUnits * options.feetPerUnit,
      lengthFeet,
      curved: true,
      // The path, not the chord — see `WallCandidate.arc`. Taken from the
      // longer face, which is the better-conditioned of the two, and from the
      // same `circleOf` the join uses so there is one notion of "the circle
      // this was drawn on" in this file rather than two.
      arc: arcOf(a.points.length >= b.points.length ? a.points : b.points),
    });
  }
  return out;
}

/** Median distance from `a`'s vertices to `b`'s path, or null if they barely meet. */
function medianGap(a: Chain, b: Chain): number | null {
  const gaps: number[] = [];
  for (const point of a.points) {
    let nearest = Infinity;
    for (let k = 1; k < b.points.length; k += 1) {
      nearest = Math.min(nearest, toSegment(point, b.points[k - 1], b.points[k]));
    }
    if (Number.isFinite(nearest)) gaps.push(nearest);
  }
  if (gaps.length < 3) return null;
  gaps.sort((x, y) => x - y);
  return gaps[Math.floor(gaps.length / 2)];
}

function toSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
