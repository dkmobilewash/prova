import type { WallCandidate } from "@/lib/takeoff/wallVectors";

/**
 * ── A SHORT RUN THAT TOUCHES NOTHING IS FURNITURE, NOT A WALL ──
 *
 * Reported by eye on two real sets: a lobby bench traced as wall on ELEVEN03,
 * and detail linework traced as wall on Camp Bow Wow. Both are the same shape
 * to the geometry — two parallel lines a plausible wall-thickness apart, which
 * is all `wallFromPair` can ask.
 *
 * What separates them is what they are ATTACHED to. A building is a connected
 * thing: a wall ends on another wall, at a corner or a tee. Furniture,
 * casework, fixtures, a detail bubble's leader and a dimension string's ticks
 * stand on their own.
 *
 * ── MEASURED, BECAUSE "ISOLATED" ALONE IS NOT ENOUGH ──
 *
 * Real walls are not all connected either: a doorway is a three-foot gap, and
 * at a tight tolerance a plan breaks into dozens of islands. On Camp Bow Wow
 * A102 the biggest island at one foot holds 51 of 163 runs — so "keep the
 * biggest island" would throw away two thirds of a real building, and
 * `wallsInTheBuilding` deliberately joins at twenty feet to avoid exactly that.
 *
 * The discriminator is isolation AND LENGTH together:
 *
 *   | A102      | n   | median length | longest |
 *   | alone     | 41  | 3.3 ft        | 8 ft    |
 *   | joined    | 122 | 7.7 ft        | 121 ft  |
 *
 *   | A4.B.1    | n   | median length | longest |
 *   | alone     | 47  | 4.4 ft        | 21 ft   |
 *   | joined    | 224 | 7.0 ft        | 128 ft  |
 *
 * Every isolated run on A102 is under eight feet. Thickness does not separate
 * them at all — 5.9in against 5.8in — which is worth saying because thickness
 * is the obvious thing to reach for and it carries no signal here.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──
 *
 * It does not drop a LONG isolated run. A screen wall, a site wall or a
 * free-standing partition is a real thing somebody prices, and the evidence
 * above says nothing about them: A4.B.1's isolated runs reach 21 ft, and
 * whether those are real is not a question the geometry answers.
 */

/** How close two runs must come to count as touching, in feet. */
export const TOUCHING_FEET = 1;

/**
 * How long an isolated run must be to survive, in feet.
 *
 * Eight is where the measured populations separate on A102 — every isolated
 * run there is under it, and the joined median is just below it. It is a floor
 * on ISOLATED runs only; a connected run of any length is untouched.
 */
export const ALONE_MIN_FEET = 8;

/** Nearest distance between two runs — end to end or end to body — in feet. */
export function gapFeet(a: WallCandidate, b: WallCandidate, feetPerUnit: number): number {
  const near = (px: number, py: number, s: WallCandidate): number => {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
    return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
  };
  // ── FOUR ENDPOINT PROBES, AND WHAT THAT MISSES ──
  //
  // For two runs that nearly touch, the nearest point is at an END of one of
  // them — a corner, a tee — so probing the four ends against the other's body
  // finds every join a plan actually makes.
  //
  // It does NOT find a true CROSSING. Two runs that intersect in their middles
  // with no endpoint nearby read as far apart: a 40ft run crossing another at
  // its centre measures 11.2 ft here, not zero. The first version of this
  // comment claimed otherwise and the test caught it.
  //
  // Left as it is, because the case it mis-reads cannot arise for the thing
  // this file drops. A run is only dropped when it is SHORT, and a short run
  // crossing a wall mid-span without touching it at either end is a door
  // swing, a leader or a detail mark — not a wall. A true segment-to-segment
  // distance would be more code and would change no outcome measured here.
  return (
    Math.min(near(a.x1, a.y1, b), near(a.x2, a.y2, b), near(b.x1, b.y1, a), near(b.x2, b.y2, a)) *
    feetPerUnit
  );
}

export type IsolatedStubOptions = {
  touchingFeet?: number;
  aloneMinFeet?: number;
};

/**
 * Drops short runs that touch nothing else.
 *
 * Returns the survivors in their original order — downstream filters and the
 * overlay both read the array positionally.
 */
export function wallsNotIsolatedStubs(
  walls: readonly WallCandidate[],
  feetPerUnit: number,
  options: IsolatedStubOptions = {},
): WallCandidate[] {
  const touching = options.touchingFeet ?? TOUCHING_FEET;
  const aloneMin = options.aloneMinFeet ?? ALONE_MIN_FEET;
  // Nothing to be isolated FROM. A sheet with one run on it is not evidence
  // that the run is furniture.
  if (walls.length < 2) return [...walls];

  // Only the short ones can be dropped, so only they need a neighbour test —
  // and a long run is still a valid NEIGHBOUR for a short one, which is the
  // common case of a stub tee-ing into a wall.
  const out: WallCandidate[] = [];
  for (let i = 0; i < walls.length; i += 1) {
    if (walls[i].lengthFeet >= aloneMin) {
      out.push(walls[i]);
      continue;
    }
    let touches = false;
    for (let j = 0; j < walls.length && !touches; j += 1) {
      if (j === i) continue;
      if (gapFeet(walls[i], walls[j], feetPerUnit) <= touching) touches = true;
    }
    if (touches) out.push(walls[i]);
  }
  return out;
}
