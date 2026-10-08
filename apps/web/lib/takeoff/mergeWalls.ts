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
export function mergeWalls(walls: readonly WallCandidate[], feetPerUnit: number): WallCandidate[] {
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
      if (overlap <= 0) continue;
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
      merged.push({
        x1: from * ux - offset * uy,
        y1: from * uy + offset * ux,
        x2: to * ux - offset * uy,
        y2: to * uy + offset * ux,
        thicknessFeet: thickness,
        lengthFeet: (to - from) * feetPerUnit,
      });
      run = [];
    };
    for (const span of spans) {
      const last = run[run.length - 1];
      if (last && span.from <= Math.max(...run.map((p) => p.to))) {
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
