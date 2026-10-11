import type { WallCandidate } from "./wallVectors";

/**
 * ── TWO ENGINES, ONE ANSWER ──
 *
 * The line pairer and the room engine fail in provably opposite ways. Pairing
 * needs a wall drawn as two parallel faces and does not care whether anything
 * encloses; the room engine needs rooms that CLOSE and does not care how the
 * wall is drawn. Measured through the same filters on three real sheets, neither
 * wins:
 *
 *                 pairer    rooms
 *   augusta        608ft    472ft
 *   naples         657ft    789ft
 *   west-herr    1,495ft  1,093ft
 *
 * So the answer is both — and the moment both run, the SAME WALL ARRIVES TWICE.
 * Reporting it twice is not a cosmetic problem: these feet become a bid, and a
 * double-counted partition is money. Simply concatenating the two was measured
 * and produced augusta 1,080ft and naples 2,108ft, the latter larger than the
 * sum of its parts because the building-cluster filter admits more once the
 * cluster grows. Those numbers are arithmetic, not walls.
 *
 * ── WHAT MAKES TWO FINDINGS THE SAME WALL ──
 *
 * They lie on the same line and cover the same stretch of it. Both engines
 * report a CENTRELINE — the pairer's is midway between two faces, the room
 * engine's is the medial line of the cavity between them — so for a real wall
 * the two agree to within an inch or two, and the tolerances here are tight
 * enough to say so.
 *
 * Grouping is pairwise rather than by rounding a key into buckets, because a
 * bucket boundary falling between two findings of one wall would leave it
 * counted twice, and that is the failure this file exists to prevent. At a few
 * hundred walls a sheet the quadratic cost is nothing.
 *
 * ── AND IT MERGES EACH ENGINE WITH ITSELF ──
 *
 * Not a side effect; it is half the value. Both engines fragment a long wall at
 * junctions and openings, so one partition arrives as three or four runs that
 * overlap at their ends. Merging spans gives one run of the right length, which
 * is also what an estimator would have traced.
 */

/** Two findings are on the same line if their directions agree within ~3°. */
const SAME_ANGLE = 0.05;

/**
 * And if their centrelines are within this, in feet.
 *
 * Half a foot: the two engines measure the same wall's centre by different
 * routes and land within an inch or two, while the nearest DIFFERENT wall worth
 * worrying about is across a chase or a cavity and further off than this. Going
 * wider starts merging the two skins of a shaft wall into one.
 */
const SAME_LINE_FEET = 0.5;

/**
 * THE WIDEST GAP ON ONE LINE THAT IS STILL THE SAME WALL.
 *
 * ── THIS REVERSES A DECISION THIS FILE USED TO STATE OUTRIGHT, SO HERE IS THE
 *    ARGUMENT ──
 *
 * The overlap test below carried the note: *"Without this, two walls far apart
 * on one line — either side of a doorway, say — would merge into a single run
 * straight through the opening."* That caution was right about large gaps and
 * wrong about doors, and it was underbidding.
 *
 * Measured on School-01 A-101, 2026-10-10, five exam rooms counted off the
 * drawing by hand: 233 feet of real wall, 197 feet found — 84%. **Every missing
 * stretch was a door opening or a column.** The acoustic walls between the
 * rooms, which have neither, came back at 92-100%.
 *
 * And a door SHOULD NOT be deducted. `takeoff.ts` sets
 * `DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT` at 32 sq ft — "roughly a single
 * door" — and says why: *"a door or a window still costs labour to cut and
 * finish around, and deducting it underbids the work."* A 3'-0" × 7'-0" door is
 * 21 sq ft, under the threshold, NOT deducted. The studs and track run through
 * it too, as a header and cripples. So the correct take-off across a door is
 * the GROSS length, and reporting two fragments either side of it is the exact
 * underbid that threshold exists to prevent.
 *
 * ── WHY IT IS BOUNDED, WHICH IS THE HALF THE OLD NOTE GOT RIGHT ──
 *
 * Past a certain width a gap is not an opening, it is somewhere the wall stops:
 * a corridor crossing, another room, the far side of the building. Joining
 * across that invents wall nobody can build, and it invents it in the direction
 * that overbids.
 *
 * 8 feet covers a single door (3'), a double door (6') and a wide cased opening.
 * Beyond it this does nothing, and two findings stay two runs — the
 * conservative direction, and the same one the old note chose for everything.
 *
 * ── AND A WIDTH ALONE IS NOT ENOUGH, WHICH THE FIRST VERSION LEARNED THE
 *    EXPENSIVE WAY ──
 *
 * Shipped with this bound and nothing else, it drew wall straight through a
 * CORRIDOR. School-01 A-101, counted on the drawing: seven runs crossed the
 * 5'-7" corridor in front of exam rooms 110-114, joining each north partition
 * to its matching south partition across open floor — about 39 feet of wall
 * nobody can build, in one region, and the same again on the south side. The
 * grid B wall became one 91-foot run from exterior to exterior.
 *
 * **A corridor is NARROWER than a double door**, so no width can separate
 * them: egress corridors run to 3'-8" and a double door is 6'-0". Narrowing the
 * bound would refuse real doors and still admit tight corridors. The
 * discriminator is not the width of the gap, it is WHAT IS AT ITS ENDS — see
 * `gapIsCrossing`.
 */
export const MAX_OPENING_FEET = 8;

/** How far from a gap's end a perpendicular wall counts as bounding it, in
 *  feet. About a wall's own thickness plus drafting slack: the partition's
 *  centreline ends at the corridor wall's centreline, not at its face. */
const BOUNDS_THE_GAP_FEET = 1.5;

/** Directions this far from perpendicular still count as crossing, as a dot
 *  product of unit vectors. 0.25 is about 15° of slack, which covers a
 *  not-quite-square building without admitting a wall running alongside. */
const ROUGHLY_PERPENDICULAR = 0.25;

/**
 * IS THIS GAP A CORRIDOR RATHER THAN A DOORWAY?
 *
 * A door is a hole in one wall: nothing crosses it, and the wall resumes on the
 * far side. A corridor crossing is different in a way that is on the drawing —
 * **the corridor's own two walls run perpendicular across the ends of the
 * gap**, because that is what makes it a corridor rather than a hole.
 *
 * So the test is one perpendicular wall near EACH end, and they must be two
 * different walls. That ordering matters:
 *
 *   a DOOR          no perpendicular wall at either jamb        -> join
 *   a COLUMN        no perpendicular wall                       -> join
 *   a T-JUNCTION    one perpendicular wall, the run continues   -> join
 *   a CORRIDOR      a perpendicular wall at BOTH ends           -> refuse
 *
 * The T-junction case is why "any perpendicular wall nearby" would be wrong:
 * a wall meeting this one side-on does not stop it, and refusing there would
 * reintroduce the fragmentation this whole change exists to remove.
 *
 * Degrades the safe way. If the corridor's walls were not detected, nothing
 * bounds the gap and the join goes ahead — the same answer as before this
 * existed, rather than a refusal of everything.
 */
function gapIsCrossing(
  walls: readonly WallCandidate[],
  unit: readonly { ux: number; uy: number }[],
  i: number,
  j: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  feetPerUnit: number,
): boolean {
  const near = BOUNDS_THE_GAP_FEET / feetPerUnit;
  const u = unit[i];
  let atFrom = -1;
  let atTo = -1;
  for (let k = 0; k < walls.length; k += 1) {
    // `k === j` is REDUNDANT against the perpendicularity test below — j is
    // collinear with i by the time this runs, so it can never be perpendicular
    // to it — and mutation confirms removing it changes no answer. Kept because
    // "the two walls being joined do not get to bound their own gap" is the
    // intent, and reading it here is cheaper than deducing it from a filter
    // three lines down.
    if (k === i || k === j) continue;
    const v = unit[k];
    // Perpendicular to the run being joined, within slack.
    if (Math.abs(v.ux * u.ux + v.uy * u.uy) > ROUGHLY_PERPENDICULAR) continue;
    if (atFrom < 0 && distanceToSegment(fromX, fromY, walls[k]) <= near) atFrom = k;
    if (atTo < 0 && distanceToSegment(toX, toY, walls[k]) <= near) atTo = k;
    // TWO DIFFERENT WALLS. One long wall running past both ends is a wall
    // alongside the gap, not the two sides of a corridor.
    if (atFrom >= 0 && atTo >= 0 && atFrom !== atTo) return true;
  }
  return false;
}

/** Distance from a point to a wall's centreline segment. */
function distanceToSegment(px: number, py: number, wall: WallCandidate): number {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - wall.x1, py - wall.y1);
  let t = ((px - wall.x1) * dx + (py - wall.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (wall.x1 + t * dx), py - (wall.y1 + t * dy));
}

type Projected = { from: number; to: number; thickness: number; weight: number };

function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

/**
 * Collapse findings that describe the same wall into one run each.
 *
 * `feetPerUnit` converts the candidates' own units to feet, as everywhere else
 * in this directory. Input order does not affect the result.
 */
export function mergeWalls(
  walls: readonly WallCandidate[],
  feetPerUnit: number,
  maxOpeningFeet = MAX_OPENING_FEET,
): WallCandidate[] {
  if (!(feetPerUnit > 0) || walls.length === 0) return [];
  const nearEnough = SAME_LINE_FEET / feetPerUnit;

  const unit = walls.map((w) => {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const length = Math.hypot(dx, dy) || 1;
    // No orientation flip here. A wall reported end-to-start by one engine and
    // start-to-end by the other needs none: the parallel test below is a CROSS
    // PRODUCT, zero for two directions 180 degrees apart exactly as for two
    // identical ones, and every span is reduced with a min and a max, so which
    // end is called the start never reaches an answer. A flip was written, and
    // deleting it left all seventeen tests green -- unreachable code shaped like
    // a safeguard, which the next reader would have trusted.
    return { ux: dx / length, uy: dy / length, length };
  });

  // Union-find over "same line", pairwise. Rounding into buckets would leave a
  // wall counted twice whenever a boundary fell between its two findings, and a
  // double-counted wall is money.
  const parent = walls.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      const a = unit[i];
      const b = unit[j];
      // Parallel? The cross product of two unit vectors is the sine of the
      // angle between them, and both are in the same half-plane already.
      if (Math.abs(a.ux * b.uy - a.uy * b.ux) > SAME_ANGLE) continue;
      // On the same line? Measure j's start across i's direction.
      const across = Math.abs(
        -a.uy * (walls[j].x1 - walls[i].x1) + a.ux * (walls[j].y1 - walls[i].y1),
      );
      if (across > nearEnough) continue;
      // Covering the same stretch of it? Without this, two walls far apart on
      // one line — either side of a doorway, say — would merge into a single
      // run straight through the opening.
      const ai = dot(walls[i].x1, walls[i].y1, a.ux, a.uy);
      const ae = dot(walls[i].x2, walls[i].y2, a.ux, a.uy);
      const bi = dot(walls[j].x1, walls[j].y1, a.ux, a.uy);
      const be = dot(walls[j].x2, walls[j].y2, a.ux, a.uy);
      const overlap = Math.min(Math.max(ai, ae), Math.max(bi, be)) - Math.max(Math.min(ai, ae), Math.min(bi, be));
      // A NEGATIVE OVERLAP IS A GAP, and a gap narrower than an opening is
      // still the same wall — see `MAX_OPENING_FEET`. Wider than that and these
      // are two walls, exactly as this test used to insist for every gap.
      if (overlap <= 0) {
        // REDUNDANT AGAINST THE SPANS LOOP, and kept. Mutation says so: read
        // this bound in page units instead of feet and nothing changes, because
        // the loop at the end applies the same bound again in feet and is the
        // binding one. This is a pre-filter — it keeps far-apart runs out of a
        // group rather than grouping them and splitting them again — and the
        // grouping is not free of consequence, since a group is rebuilt on its
        // leader's line. Noted so the next reader does not spend a mutation on
        // it, as I did.
        if (-overlap > maxOpeningFeet / feetPerUnit) continue;
        // ── A GAP-JOIN NEEDS TIGHTER COLLINEARITY THAN AN OVERLAP-MERGE ──
        //
        // Kept because the test that used to forbid all gap-joins was right
        // about a second thing, and only the first was wrong. Two OVERLAPPING
        // findings of one wall legitimately sit a third of a foot apart — that
        // is two engines estimating a centreline differently, and merging them
        // onto one line is correct. Two runs with a GAP between them making the
        // same claim is weaker: if they really are one wall either side of a
        // door, their faces are the same lines and the offset is a hair.
        //
        // At `nearEnough` a jog in a wall would be joined and then rebuilt on
        // one line, sliding part of it across the drawing — "two runs of the
        // right length in the wrong places, which no total catches", in the
        // words of the test that caught this.
        if (across > nearEnough / 4) continue;
        // ── AND IS THERE A CORRIDOR IN THE GAP? ──
        //
        // The width bound cannot answer this: a corridor is NARROWER than a
        // double door. What separates them is on the drawing — a corridor has
        // its own two walls running across the ends of the gap, and a doorway
        // has nothing. See `gapIsCrossing`.
        // The gap's ends are the two REAL endpoints facing each other — taken
        // from the walls rather than rebuilt from projections, which needs no
        // offset and cannot drift from the geometry on screen.
        const endsI = [
          [walls[i].x1, walls[i].y1],
          [walls[i].x2, walls[i].y2],
        ];
        const endsJ = [
          [walls[j].x1, walls[j].y1],
          [walls[j].x2, walls[j].y2],
        ];
        let best = Infinity;
        let from = endsI[0];
        let to = endsJ[0];
        for (const p of endsI) {
          for (const q of endsJ) {
            const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
            if (d < best) {
              best = d;
              from = p;
              to = q;
            }
          }
        }
        if (gapIsCrossing(walls, unit, i, j, from[0], from[1], to[0], to[1], feetPerUnit)) continue;
      }
      join(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < walls.length; i += 1) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  }

  const merged: WallCandidate[] = [];
  for (const members of groups.values()) {
    // The longest member sets the direction: it has the best angle estimate,
    // and a short fragment's angle is the noisiest thing in the group.
    const lead = members.reduce((best, i) => (unit[i].length > unit[best].length ? i : best), members[0]);
    const { ux, uy } = unit[lead];
    const offset = -uy * walls[lead].x1 + ux * walls[lead].y1;

    const spans: Projected[] = [];
    for (const i of members) {
      const a = dot(walls[i].x1, walls[i].y1, ux, uy);
      const b = dot(walls[i].x2, walls[i].y2, ux, uy);
      spans.push({
        from: Math.min(a, b),
        to: Math.max(a, b),
        thickness: walls[i].thicknessFeet,
        weight: unit[i].length,
      });
    }
    spans.sort((p, q) => p.from - q.from);

    // Merge what overlaps. A group can still hold two separate stretches when a
    // third finding bridged them transitively, and those stay two walls.
    let run: Projected[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const from = Math.min(...run.map((p) => p.from));
      const to = Math.max(...run.map((p) => p.to));
      // Thickness by the LONGEST contributor rather than an average: a short
      // fragment at a junction reads thick, where the walls widen into each
      // other, and averaging that in would push a 4-7/8" partition into the
      // next wall type and price it wrong.
      const thickness = run.reduce((best, p) => (p.weight > best.weight ? p : best), run[0]).thickness;
      // ── THE GAPS INSIDE THE JOINED RUN ARE THE OPENINGS ──
      //
      // Reported rather than deducted. `takeoff.ts` only deducts an opening
      // over 32 sq ft and this cannot know a height — a floor plan does not
      // carry one — so inventing one to deduct with would be a guess that
      // reaches a bid. The WIDTH is measured, and that is what is handed over.
      const ordered = [...run].sort((a, b) => a.from - b.from);
      const openings: { widthFt: number }[] = [];
      let reach = ordered[0].to;
      for (const span of ordered.slice(1)) {
        if (span.from > reach) openings.push({ widthFt: (span.from - reach) * feetPerUnit });
        reach = Math.max(reach, span.to);
      }
      merged.push({
        x1: from * ux - offset * uy,
        y1: from * uy + offset * ux,
        x2: to * ux - offset * uy,
        y2: to * uy + offset * ux,
        thicknessFeet: thickness,
        lengthFeet: (to - from) * feetPerUnit,
        ...(openings.length > 0 ? { openings } : {}),
      });
      run = [];
    };
    const gapAllowance = maxOpeningFeet / feetPerUnit;
    for (const span of spans) {
      const last = run[run.length - 1];
      // `+ gapAllowance` is the whole change: a doorway-sized gap keeps the
      // span in the same run, and `flush` records it as an opening. Anything
      // wider starts a new run, which is what this did for every gap before.
      if (last && span.from <= Math.max(...run.map((p) => p.to)) + gapAllowance) {
        run.push(span);
      } else {
        flush();
        run.push(span);
      }
    }
    flush();
  }
  return merged;
}
