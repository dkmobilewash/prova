import type { Candidate, ReviewState, Verdict } from "./answerKeyReview";

/**
 * ── A WALL THAT STOPS BEING A WALL PART WAY ALONG ──
 *
 * Camp Bow Wow A101's north and south walls each run 160 ft and 151 ft, and
 * the last 30 ft of each crosses OUTDOOR PLAY YARD 1-4 and OUTDOOR RUN — the
 * drawing's own labels, beside a property line, a concrete curb and four
 * "SL 2% MAX" slope notes. Paved yard, not enclosed building.
 *
 * Before this the reviewer had three bad answers and no good one:
 *
 *   accept whole    teaches the model that a run crossing into a yard is
 *                   wall, which is the over-reach the scope rules exist to
 *                   stop, and bills 61 ft nobody builds
 *   reject whole    teaches that 249 ft of real building wall is NOT wall,
 *                   on the two longest walls on the sheet
 *   not sure        honest, excludes both, and loses all 249 ft
 *
 * So: cut the candidate, and judge each half on its own.
 *
 * ── THE FEATURE VECTORS LOOK AFTER THEMSELVES, AND THAT IS THE DESIGN ──
 *
 * A candidate is a RUN; the feature vectors belong to the PAIRINGS underneath
 * it, and `labelRows` assigns each pairing to whichever run covers at least
 * half of it. So two halves of a run collect the pairings that lie under
 * them, each with the vector the finder computed, and nothing is recomputed
 * or invented. A split is purely a geometric operation on the candidate list;
 * the training data follows.
 *
 * That is worth stating because the obvious alternative — synthesising a
 * feature vector for each half — would be wrong in a way nothing would catch:
 * the numbers would look plausible and would describe a wall the finder never
 * considered.
 *
 * Pure. No DOM, no React.
 */

/** How short a half may be, in feet. Below this the cut is a mis-click: a
 *  two-foot stub is not a wall anybody bills separately, and splitting one
 *  off leaves two candidates where one was wanted. */
export const SHORTEST_HALF_FEET = 1;

type Point = { x: number; y: number };

const lengthOf = (c: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(c.x2 - c.x1, c.y2 - c.y1);

/**
 * Where along `c` the point `at` falls, as a fraction from 0 to 1, or null
 * when it is off the end.
 */
export function fractionAlong(
  c: { x1: number; y1: number; x2: number; y2: number },
  at: Point,
): number | null {
  const len = lengthOf(c);
  if (!(len > 0)) return null;
  const t = ((at.x - c.x1) * (c.x2 - c.x1) + (at.y - c.y1) * (c.y2 - c.y1)) / (len * len);
  return t > 0 && t < 1 ? t : null;
}

/**
 * The point where an ACCEPTED run crosses this candidate, if one does.
 *
 * This is the common case and the one that needs no aiming: the yard begins
 * where the building's east wall is, and the reviewer has already accepted
 * that wall. Nearest-to-the-middle wins, so a wall crossed by several picks
 * the one that divides it rather than one clipping an end.
 */
export function crossingPoint(state: ReviewState, id: string): Point | null {
  const target = state.candidates.find((c) => c.id === id);
  if (target === undefined) return null;
  const len = lengthOf(target);
  if (!(len > 0)) return null;
  const ux = (target.x2 - target.x1) / len;
  const uy = (target.y2 - target.y1) / len;

  let best: { at: Point; fromMiddle: number } | null = null;
  for (const other of state.candidates) {
    if (other.id === id) continue;
    if ((state.verdicts[other.id] ?? "unreviewed") !== "wall") continue;
    const ol = lengthOf(other);
    if (!(ol > 0)) continue;
    const vx = (other.x2 - other.x1) / ol;
    const vy = (other.y2 - other.y1) / ol;
    // Crossing, not running alongside: within about 20 degrees of square.
    if (Math.abs(ux * vx + uy * vy) > 0.94) continue;

    // Where the two infinite lines meet.
    const denominator = ux * vy - uy * vx;
    if (Math.abs(denominator) < 1e-9) continue;
    const t =
      ((other.x1 - target.x1) * vy - (other.y1 - target.y1) * vx) / denominator;
    const at = { x: target.x1 + ux * t, y: target.y1 + uy * t };

    // It has to cross INSIDE both of them, or it is two walls near each other.
    const onTarget = t / len;
    if (onTarget <= 0 || onTarget >= 1) continue;
    const s = ((at.x - other.x1) * vx + (at.y - other.y1) * vy) / ol;
    if (s < -0.02 || s > 1.02) continue;

    const fromMiddle = Math.abs(onTarget - 0.5);
    if (best === null || fromMiddle < best.fromMiddle) best = { at, fromMiddle };
  }
  return best?.at ?? null;
}

/**
 * Cuts one candidate in two at `at`, leaving both unreviewed.
 *
 * Returns the state unchanged when the cut would leave a stub shorter than
 * `SHORTEST_HALF_FEET` or when the point is off the end — a refusal rather
 * than a surprise, since the reviewer is aiming with a mouse.
 */
export function splitCandidate(
  state: ReviewState,
  id: string,
  at: Point,
  feetPerUnit: number,
): { state: ReviewState; halves: [string, string] | null } {
  const target = state.candidates.find((c) => c.id === id);
  if (target === undefined) return { state, halves: null };

  const t = fractionAlong(target, at);
  if (t === null) return { state, halves: null };

  const total = target.lengthFeet;
  const first = total * t;
  const second = total - first;
  if (first < SHORTEST_HALF_FEET || second < SHORTEST_HALF_FEET) {
    return { state, halves: null };
  }

  const cut = {
    x: target.x1 + (target.x2 - target.x1) * t,
    y: target.y1 + (target.y2 - target.y1) * t,
  };
  // Suffixed rather than renumbered: a split half keeps its parent's
  // identity in the id, so a saved file can still be read against the run
  // list the finder produced.
  const a: Candidate = {
    ...target,
    id: `${id}+a`,
    x2: cut.x,
    y2: cut.y,
    lengthFeet: first,
    note: target.note === "" ? "split" : `${target.note}, split`,
  };
  const b: Candidate = {
    ...target,
    id: `${id}+b`,
    x1: cut.x,
    y1: cut.y,
    lengthFeet: second,
    note: target.note === "" ? "split" : `${target.note}, split`,
  };
  void feetPerUnit;

  const candidates = state.candidates.flatMap((c) => (c.id === id ? [a, b] : [c]));
  const verdicts: Record<string, Verdict> = {};
  for (const c of candidates) {
    verdicts[c.id] = c.id === a.id || c.id === b.id ? "unreviewed" : (state.verdicts[c.id] ?? "unreviewed");
  }

  return {
    state: {
      ...state,
      candidates,
      verdicts,
      // A duplicate pair naming the candidate that no longer exists would
      // leave the panel offering a decision about nothing.
      //
      // Worth knowing when a duplicate COUNT changes unexpectedly: this is
      // why. A spurious split on MHK A1.01 took the box from five pairs to
      // one, and the cause was here rather than in the finder.
      duplicates: state.duplicates.filter((p) => p.keep !== id && p.drop !== id),
      // ── RECORDED, SO REOPENING NEED NOT GUESS ──
      splits: [
        ...(state.splits ?? []),
        {
          x1: target.x1,
          y1: target.y1,
          x2: target.x2,
          y2: target.y2,
          lengthFeet: target.lengthFeet,
          thicknessIn: target.thicknessIn,
          cutX: cut.x,
          cutY: cut.y,
        },
      ],
    },
    halves: [a.id, b.id],
  };
}
