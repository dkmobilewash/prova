import { wallSupport } from "./offsetCandidates";
import type { StrokeSegment } from "./wallVectors";
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
  /** The one to keep: the better supported, else the longer, else the thicker. */
  keep: string;
  /** The one to drop. */
  drop: string;
  /**
   * How well each twin's own faces are drawn, when the sheet's lines were
   * given. Null where they were not — so a reader can tell "they were equal"
   * from "nobody looked".
   */
  support?: { keep: number; drop: number } | null;
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
/**
 * How much better supported a twin must be before support overrides length.
 *
 * A fifth of the run. Below that the two readings are the same quality and
 * the longer one is still the better bet; above it, one of them is sitting on
 * a wall and the other is not.
 */
export const SUPPORT_MARGIN = 0.2;

/**
 * How different in length two candidates may be before support stops deciding.
 *
 * ── SUPPORT PICKS BETWEEN TWINS, NOT BETWEEN A WALL AND A FRAGMENT ──
 *
 * `share` is measured against the SHORTER run, so a 3 ft candidate lying
 * inside a 160 ft wall is a duplicate pair by this file's own definition. For
 * a pair like that the long one is the wall and the short one is a piece of
 * it, and length is exactly the right rule.
 *
 * Measured before this guard existed: the support rule alone swapped 16
 * pre-marks across eight labelled sheets, and among them Camp Bow Wow A101
 * would have kept a 3.5 ft candidate and REJECTED a 160 ft run — 156 ft of
 * wall thrown away to fix a nine-inch offset. The defect reported was two
 * twins of near-equal length, one on the wall and one beside it, which is the
 * case this bound keeps.
 *
 * ── 2.5, CHOSEN BY MEASURING WHAT EACH VALUE ADMITS ──
 *
 * Swept over the eight labelled sheets, counting the pre-marks that swap and
 * looking at what each swap would DROP:
 *
 *   | bound | swaps | the worst thing it drops |
 *   | --- | --- | --- |
 *   | 2 | 3 | a run with support 0.00 |
 *   | **2.5** | **4** | **a run with support 0.00** |
 *   | 3 | 5 | a run with support 0.65 — a wall that IS drawn |
 *
 * So 2.5 is the widest bound at which every swap rejects a candidate whose
 * second face is not drawn at all. It is also the value that catches both of
 * the two twins reported wrong on E Street 421 A2.1; 2 catches one of them.
 * The number is the edge of the evidence rather than the count somebody
 * wanted, which is why the sweep is written down.
 */
export const SIMILAR_LENGTH = 2.5;

/**
 * ── WHAT THIS RULE CANNOT SEE ──
 *
 * Support separates two twins when the WRONG one is paired with something
 * short — a shelf, a shelf end, a run of glass — which is every twin the
 * sweep over the eight labelled sheets swapped: each dropped candidate scored
 * 0.00, meaning one of its faces was not drawn for its length at all.
 *
 * It does NOT separate them when the wrong partner is itself a long,
 * full-length line. A twin pairing a wall face with a glass wall drawn the
 * whole length of the room has two fully-drawn faces and scores as well as
 * the real wall does. Found by writing the fixture that way first and
 * watching the test fail.
 *
 * The remaining signal for that case is the one Diego named second: whether
 * the THICKNESS matches the wall as drawn. It needs a notion of the sheet's
 * own thicknesses, which this file does not have, and it is not built — so
 * the bound is written here rather than left for somebody to discover.
 */

export function duplicatePairs(
  candidates: readonly Candidate[],
  feetPerUnit: number,
  /**
   * The sheet's own lines. Given them, the keeper is the twin whose two faces
   * are actually DRAWN for its length; without them the rule is length, as it
   * was. Optional because the review state is built before the geometry is
   * always to hand, and a missing argument must not silently change which
   * candidate is rejected.
   */
  segments?: readonly StrokeSegment[],
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

      // ── WHICH TWIN IS ACTUALLY ON THE WALL ──
      //
      // `a` is the longer by the sort, and length alone picked the wrong one
      // twice on E Street 421 A2.1: the candidate offset nine inches beside
      // the wall — pairing a wall face with the glass line next to it — was
      // longer than the one sitting on the wall, so the right answer was
      // auto-rejected. `wallSupport` asks whether a run's own two faces are
      // drawn for its whole length, which is what separates them.
      //
      // Length still decides when support cannot be measured or when the two
      // are close: an unreadable sheet must not invert the rule, and two
      // equally supported readings are a question about length again.
      const support =
        segments === undefined
          ? null
          : {
              a: wallSupport({ run: asRun(a), segments, feetPerUnit }).support,
              b: wallSupport({ run: asRun(b), segments, feetPerUnit }).support,
            };
      const tie = Math.abs(a.lengthFeet - b.lengthFeet) < 0.01;
      const longer = Math.max(a.lengthFeet, b.lengthFeet);
      const shorter = Math.min(a.lengthFeet, b.lengthFeet);
      const comparable = shorter > 0 && longer / shorter <= SIMILAR_LENGTH;
      const keepA =
        support !== null &&
        comparable &&
        Math.abs(support.a - support.b) >= SUPPORT_MARGIN
          ? support.a > support.b
          : !tie || (a.thicknessIn ?? 0) >= (b.thicknessIn ?? 0);
      out.push({
        keep: keepA ? a.id : b.id,
        drop: keepA ? b.id : a.id,
        share,
        apartFeet: apart,
        support:
          support === null
            ? null
            : { keep: keepA ? support.a : support.b, drop: keepA ? support.b : support.a },
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

/** A candidate as `wallSupport` wants it — thickness in FEET, not inches. */
function asRun(candidate: Candidate) {
  return {
    x1: candidate.x1,
    y1: candidate.y1,
    x2: candidate.x2,
    y2: candidate.y2,
    lengthFeet: candidate.lengthFeet,
    thicknessFeet: (candidate.thicknessIn ?? 0) / 12,
  };
}
