import type { Candidate } from "./answerKeyReview";

/**
 * ── ONE WALL OFFERED TWICE ──
 *
 * The finder pairs faces, and a wall drawn with more than two lines — a
 * layered partition, a wall with its finish drawn, a wall redrawn on a second
 * layer — yields more than one pairing along the same line. Both survive to
 * the reviewer as separate candidates, and accepting both bills the wall
 * twice.
 *
 * Camp Bow Wow A101, the first sheet anybody labelled, had two: a 57.7 ft and
 * a 57.0 ft run ten inches apart down the same west wall, and a 4.2 ft run
 * entirely inside a 34.6 ft one. The reviewer spotted the first pair and
 * asked for the check; nothing in the panel had offered it.
 *
 * ── WHY 1.5 FT AND NOT A WALL THICKNESS ──
 *
 * The first attempt at this used one wall thickness as the band, which is
 * what the scorer uses for "is this run on that wall". It missed the A101
 * pair: ten inches is more than a 6-inch partition's thickness and is plainly
 * the same wall. A duplicate is not offset by a thickness, it is offset by
 * however far apart the two pairings' centrelines happen to land, which
 * depends on which faces got paired. 1.5 ft is wider than any drafting jitter
 * and narrower than a real corridor, a real cavity or the 5.2 ft gap between
 * A101's east wall and the line outside it — which is NOT a duplicate and
 * must not be called one.
 *
 * Pure. No DOM, no React.
 */

/** How far apart two centrelines may be and still be one wall, in feet. */
export const SAME_WALL_FEET = 1.5;

/** How much of the shorter one must lie along the longer, as a share. */
export const MOSTLY_OVERLAPPING = 0.7;

/**
 * A cheap pre-filter on direction — about 11 degrees.
 *
 * ── DIRECTION IS THE WRONG TEST FOR A SHORT RUN, AND THIS IS WHY IT IS LOOSE ──
 *
 * The first version used 2 degrees as the whole angular test and missed the
 * case the reviewer asked about: a 4.2 ft fragment lying exactly on a 34.6 ft
 * wall, 0.00 ft from its centreline, 99.9% overlapping — and 3.2 degrees off,
 * because its two endpoints differ by a couple of inches and over four feet
 * that is three degrees. Short runs have noisy directions; it is a property
 * of the length, not of the wall.
 *
 * So the binding test is where the ENDPOINTS lie, below. This only keeps the
 * loop from measuring every crossing wall on the sheet.
 */
const ROUGHLY_PARALLEL = 0.98;

export type DuplicatePair = {
  /** The one to keep: the longer, or the thicker when lengths tie. */
  keep: string;
  /** The one to drop. */
  drop: string;
  /** How much of the shorter lies along the longer, 0 to 1. */
  share: number;
  /** How far apart their centrelines are, in feet. */
  apartFeet: number;
};

type Line = { x1: number; y1: number; x2: number; y2: number };
const lengthOf = (l: Line) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);

const offLine = (a: Line, px: number, py: number) => {
  const len = lengthOf(a) || 1;
  return Math.abs(-(px - a.x1) * ((a.y2 - a.y1) / len) + (py - a.y1) * ((a.x2 - a.x1) / len));
};

const overlapOf = (a: Line, b: Line) => {
  const len = lengthOf(a) || 1;
  const ux = (a.x2 - a.x1) / len;
  const uy = (a.y2 - a.y1) / len;
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const lo = Math.max(0, Math.min(at(b.x1, b.y1), at(b.x2, b.y2)));
  const hi = Math.min(len, Math.max(at(b.x1, b.y1), at(b.x2, b.y2)));
  return Math.max(0, hi - lo);
};

/**
 * Finds the candidates that are one wall offered twice.
 *
 * `feetPerUnit` converts the page-width units the candidates live in. At most
 * one pair per candidate is returned, so a wall offered three times yields
 * two pairs rather than three and the chain still resolves to one keeper.
 */
export function duplicatePairs(
  candidates: readonly Candidate[],
  feetPerUnit: number,
): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  const paired = new Set<string>();

  // Longest first, so the keeper is decided before anything is consumed and a
  // chain of three collapses onto the longest rather than onto whichever the
  // loop reached first.
  const order = [...candidates].sort((a, b) => b.lengthFeet - a.lengthFeet);

  for (let i = 0; i < order.length; i += 1) {
    const a = order[i];
    if (paired.has(a.id)) continue;
    const la = lengthOf(a);
    if (!(la > 0)) continue;

    for (let j = i + 1; j < order.length; j += 1) {
      const b = order[j];
      if (paired.has(b.id)) continue;
      const lb = lengthOf(b);
      if (!(lb > 0)) continue;

      const dot = ((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb);
      if (Math.abs(dot) < ROUGHLY_PARALLEL) continue;

      // ── BOTH ENDS ON THE LONGER'S LINE, NOT JUST THE MIDPOINT ──
      //
      // The midpoint alone would admit a wall crossing at a shallow angle,
      // which touches the line in the middle and leaves at both ends. Both
      // endpoints inside the band is the same claim a reviewer makes by eye:
      // this whole thing lies along that wall.
      const ends = [
        offLine(a, b.x1, b.y1) * feetPerUnit,
        offLine(a, b.x2, b.y2) * feetPerUnit,
      ];
      if (Math.max(...ends) > SAME_WALL_FEET) continue;
      const apart = offLine(a, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2) * feetPerUnit;

      const share = overlapOf(a, b) / Math.min(la, lb);
      if (share < MOSTLY_OVERLAPPING) continue;

      // `a` is the longer by the sort; keep it unless they tie, in which case
      // the thicker one is the better reading of the wall.
      const tie = Math.abs(a.lengthFeet - b.lengthFeet) < 0.01;
      const keepA = !tie || (a.thicknessIn ?? 0) >= (b.thicknessIn ?? 0);
      out.push({
        keep: keepA ? a.id : b.id,
        drop: keepA ? b.id : a.id,
        share,
        apartFeet: apart,
      });
      // ── ONLY THE DROPPED ONE IS CONSUMED, AND THE SCAN CONTINUES ──
      //
      // The first version consumed BOTH and broke out, so a candidate could
      // belong to at most one pair. A wall offered three times then kept two
      // of them: on Camp Bow Wow A101 the 34.6 ft run matched an 11.7 ft
      // fragment, was consumed, and the 4.2 ft fragment lying inside the
      // SAME wall was left over — it went on to become the keeper of its own
      // little pair with a 2.9 ft piece. The reviewer asked why that one was
      // missed; this is why.
      //
      // A long wall can legitimately absorb several short offers of itself,
      // so the keeper stays available and the inner loop keeps looking.
      paired.add(keepA ? b.id : a.id);
      if (!keepA) break;
    }
  }
  return out;
}

/** The pair a candidate belongs to, if any — for the panel's note. */
export function duplicateOf(
  pairs: readonly DuplicatePair[],
  id: string,
): { other: string; keeping: boolean; pair: DuplicatePair } | null {
  for (const pair of pairs) {
    if (pair.keep === id) return { other: pair.drop, keeping: true, pair };
    if (pair.drop === id) return { other: pair.keep, keeping: false, pair };
  }
  return null;
}
