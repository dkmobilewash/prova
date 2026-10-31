import { CAP_SLACK_FEET, MAX_OPENING_FEET } from "./mergeWalls";
import { NARROWEST_DOOR_FEET, WIDEST_DOOR_FEET } from "./openings";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── THE DOORS AND WINDOWS ON A FOUND WALL, READ OFF THE DRAWING ──
 *
 * Openings were typed by hand — width and height, one row at a time — while the
 * drawing already shows every one of them. This reads them back from the line
 * work and PROPOSES them: a person confirms each one and types its height, the
 * same posture every detected wall group already has.
 *
 * Geometry only, no model call, and nothing here is a guess about a size the
 * drawing does not print:
 *
 *   - the WIDTH is measured, between the two jambs, from the wall's own faces;
 *   - the HEIGHT is never produced. A floor plan does not carry one — it is in
 *     a schedule, an elevation or nobody's head — and no wall type or opening
 *     type in this codebase carries a default either (checked 2026-10-25:
 *     nothing reads a door height anywhere). Inventing 7'-0" would be a number
 *     that reaches a bid without anybody choosing it.
 *
 * ── WHAT IS PROPOSED, AND WHAT IS DELIBERATELY NOT ──
 *
 * Only an opening with EVIDENCE drawn in it: a door's swing, or a window's
 * glazing. A gap in a wall with nothing in it is just as often a column, a
 * break where two engines' runs met, or a drafting break as it is a cased
 * opening — and a proposal list padded with those would teach an estimator to
 * tick everything, which is the habit that makes the list worthless. So an
 * unmarked gap is left alone. That costs every cased opening and every
 * storefront, and it is the conservative direction: a missed proposal is a row
 * the estimator types, exactly as today.
 *
 * ── WHY THIS DOES NOT BRIDGE ANYTHING, AND WHY THAT MATTERS ──
 *
 * NOTES.md records two attempts to use door and window evidence to JOIN wall
 * runs (2026-10-17, 2026-10-18), and both were reverted: a joined run falls
 * foul of filters its pieces passed, and "an arc at about the right distance"
 * is satisfied by the crowd of unrelated swings every plan has. This module
 * runs AFTER the finder, on the runs it already returned, and only labels gaps
 * those runs contain. It cannot add, remove, lengthen or move a wall, so the
 * wall footage is byte-identical with it or without it — the bench says so,
 * and `findWallsOnSheet.test.ts` pins it on a sheet drawn with and without the door.
 *
 * The second lesson is kept as a requirement rather than a warning: a swing is
 * ONE arc, hinged at THIS jamb, of THIS opening's width, sweeping a door's
 * quarter-turn down to the far jamb. See `swingAt`.
 */

export type ProposedOpeningKind = "door" | "window";

export type ProposedOpening = {
  kind: ProposedOpeningKind;
  /** A pair of doors (two leaves, one at each jamb) or a single leaf. Doors only. */
  leaves?: 1 | 2;
  /** Jamb to jamb, in feet — measured, never rounded to a catalogue size. */
  widthFt: number;
  /** The opening's centre as a fraction of the run, from (x1, y1). */
  at: number;
  /** What was drawn there, in words a reviewer can check against the sheet. */
  evidence: string;
};

/** Parallel within ~3°, the tolerance every same-line test in this directory uses. */
const PARALLEL_SINE = Math.sin((3 * Math.PI) / 180);

/** A jamb line is square across the wall within ~10°. */
const SQUARE_COSINE = Math.sin((10 * Math.PI) / 180);

/**
 * How far a line may sit from where a face should be and still be that face,
 * as a share of the wall's thickness — with a floor, because a thin wall's
 * share is smaller than a renderer's rounding.
 *
 * A fifth of the thickness is under the quarter `mergeWalls` allows two pieces
 * of one centreline to disagree by, so a run that `mergeWalls` built is never
 * held to a tighter standard here than it was built to.
 */
const FACE_SHARE_OF_THICKNESS = 0.2;
const FACE_FLOOR_FEET = 0.75 / 12;

/**
 * The shortest stretch of face that counts as wall standing beside a gap, in
 * feet. A door leaf drawn as a thin rectangle puts a 1-3/4in edge exactly on
 * the face line at its hinge; that is not wall, and counting it would split
 * every doorway into a 1-3/4in stub and a slightly narrower gap.
 */
const SHORTEST_FACE_PIECE_FEET = 0.3;

/**
 * How much plain wall must stand each side of a window, in feet — wall with
 * its faces drawn and NOTHING inside its body.
 *
 * This is the whole discriminator between a window and a wall TYPE drawn as
 * three or four parallel lines (a shaft wall, a rated assembly). Both put lines
 * inside the wall's body. Only the window puts them in ONE place: a multi-line
 * type has them along every solid stretch, so a "window" whose neighbours also
 * carry interior lines is the wall's own drawing. Half a foot is less than any
 * window's own frame and more than any jamb return a renderer draws.
 */
const PLAIN_WALL_EACH_SIDE_FEET = 0.5;

/**
 * Two interior lines are the same line across the wall within this, in feet,
 * or as a share of the thickness where that is larger. A quarter of an inch is
 * under any gap between a glazing line and a wall's own interior line in a real
 * assembly (5/8in board is the thinnest layer anyone draws) and above renderer
 * rounding.
 */
const OFFSET_FLOOR_FEET = 0.25 / 12;
const OFFSET_SHARE_OF_THICKNESS = 0.04;

/** A line inside the wall covering this share of the run is the wall's own. */
const OWN_LANE_SHARE = 0.5;

/** How much of a window's width its sill lines must cover, on each face. */
const SILL_SHARE = 0.8;

/** Within this of a jamb, along the run, a jamb line counts as closing it. */
const JAMB_REACH_FEET = 0.25;

/**
 * A swing must sweep at least this much, in degrees.
 *
 * A door's swing is drawn as a quarter turn. Sixty leaves room for a door
 * drawn opening less than fully and for flattening losing a piece at either
 * end, while still refusing the short arc a column, a fixture or a stair
 * nosing contributes.
 */
const LEAST_SWEEP_DEGREES = 60;

/** Pieces of one arc may leave a hole this wide in the sweep, in degrees. */
const SWEEP_HOLE_DEGREES = 6;

/**
 * The swing reaches the FAR jamb: the closed leaf lies along the wall, so the
 * arc ends pointing along it, toward the other side of the opening. Within
 * this, in degrees.
 */
const CLOSED_LEAF_DEGREES = 15;

/** A single leaf is the width of its opening; drafting slack either way. */
const SINGLE_LEAF_SHARE = [0.85, 1.1] as const;
/** Each leaf of a pair is half. */
const PAIR_LEAF_SHARE = [0.4, 0.6] as const;

/** Every piece of one arc lies this close to one radius, as a share of it. */
const RADIUS_SHARE = 0.06;

type Interval = { from: number; to: number };

function unionOf(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.from - b.from);
  const out: Interval[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else out.push({ from: span.from, to: span.to });
  }
  return out;
}

/** The stretches of [0, length] that `covered` leaves bare. */
function bare(covered: Interval[], length: number): Interval[] {
  const out: Interval[] = [];
  let reach = 0;
  for (const span of covered) {
    if (span.from > reach) out.push({ from: reach, to: Math.min(span.from, length) });
    reach = Math.max(reach, span.to);
    if (reach >= length) break;
  }
  if (reach < length) out.push({ from: reach, to: length });
  return out.filter((span) => span.to > span.from);
}

function coveredLength(covered: Interval[], from: number, to: number): number {
  let total = 0;
  for (const span of covered) total += Math.max(0, Math.min(span.to, to) - Math.max(span.from, from));
  return total;
}

/** A segment in the run's own frame: `a` along it from (x1, y1), `o` across it. */
type Local = { a1: number; o1: number; a2: number; o2: number; curved: boolean };

/**
 * Is a door's swing drawn hinged at (ha, ho), toward the far jamb at `toward`
 * along the run (+1 or -1), with a radius in `[lo, hi]`?
 *
 * ONE ARC, which is the requirement the reverted door-evidence rule lacked.
 * Every piece must be curved, must hold both its ends at ONE radius about this
 * hinge, and the pieces together must sweep a contiguous quarter-turn that
 * finishes lying along the wall toward the other jamb. A crowd of pieces from
 * neighbouring swings sits at assorted radii about this point, and does not
 * chain into a contiguous sweep that closes on this opening.
 *
 * Returns the radius found, or null.
 */
function swingAt(
  curved: readonly Local[],
  ha: number,
  ho: number,
  side: 1 | -1,
  toward: 1 | -1,
  lo: number,
  hi: number,
): number | null {
  type Piece = { r: number; t1: number; t2: number };
  const pieces: Piece[] = [];
  for (const s of curved) {
    // On the side the door opens into: beyond the face, not inside the wall or
    // behind it. NOT redundant with the angle test below, and that was learned
    // by removing it: every unit case stayed green, and the bench lost 15
    // doors. A piece behind the face — the swing of a door on the wall's other
    // side, a tag circle — reads as a negative angle, sorts FIRST, and the
    // sweep search then refuses the whole seed for starting behind the wall.
    if ((s.o1 - ho) * side < -1e-9 || (s.o2 - ho) * side < -1e-9) continue;
    const r1 = Math.hypot(s.a1 - ha, s.o1 - ho);
    const r2 = Math.hypot(s.a2 - ha, s.o2 - ho);
    if (r1 < lo * 0.95 || r1 > hi * 1.05) continue;
    if (Math.abs(r1 - r2) > RADIUS_SHARE * Math.max(r1, r2)) continue;
    // Angle measured from the closed position (along the wall toward the far
    // jamb) round to the open one (square off the wall, into the room). In the
    // run's frame that is (toward, 0) rotating to (0, side).
    const angle = (a: number, o: number) => {
      const along = (a - ha) * toward;
      const across = (o - ho) * side;
      return (Math.atan2(across, along) * 180) / Math.PI;
    };
    const t1 = angle(s.a1, s.o1);
    const t2 = angle(s.a2, s.o2);
    pieces.push({ r: (r1 + r2) / 2, t1: Math.min(t1, t2), t2: Math.max(t1, t2) });
  }
  if (pieces.length === 0) return null;

  // One radius: the pieces of the largest sweep at a consistent radius. Each
  // piece is tried as the seed so the answer does not depend on input order.
  let best: number | null = null;
  let bestSweep = 0;
  for (const seed of pieces) {
    const same = pieces.filter((p) => Math.abs(p.r - seed.r) <= RADIUS_SHARE * seed.r);
    const sorted = same.sort((p, q) => p.t1 - q.t1);
    // The contiguous block that starts at the closed position.
    let reach = -Infinity;
    let start = Infinity;
    for (const p of sorted) {
      if (reach === -Infinity) {
        if (p.t1 > CLOSED_LEAF_DEGREES) break;
        start = p.t1;
        reach = p.t2;
        continue;
      }
      if (p.t1 > reach + SWEEP_HOLE_DEGREES) break;
      reach = Math.max(reach, p.t2);
    }
    if (reach === -Infinity) continue;
    if (start < -CLOSED_LEAF_DEGREES) continue;
    const sweep = reach - Math.max(start, 0);
    if (sweep >= LEAST_SWEEP_DEGREES && sweep > bestSweep && reach <= 90 + CLOSED_LEAF_DEGREES) {
      bestSweep = sweep;
      best = same.reduce((t, p) => t + p.r, 0) / same.length;
    }
  }
  return best;
}

/**
 * The openings drawn in each run, keyed by the run's index.
 *
 * `segments` are the sheet's strokes in the SAME units as the runs (page-width
 * units throughout the finder), and `feetPerUnit` converts them, as everywhere
 * in this directory. Curved runs are skipped: an opening in an arc has no
 * straight jamb-to-jamb width to measure.
 */
export function proposedOpenings(
  runs: readonly WallCandidate[],
  segments: readonly StrokeSegment[],
  feetPerUnit: number,
): Map<number, ProposedOpening[]> {
  const out = new Map<number, ProposedOpening[]>();
  if (!(feetPerUnit > 0)) return out;
  const feet = (units: number) => units * feetPerUnit;
  const units = (ft: number) => ft / feetPerUnit;
  const widestDoor = units(MAX_OPENING_FEET + CAP_SLACK_FEET);
  const widestWindow = units(WIDEST_DOOR_FEET);
  const narrowest = units(NARROWEST_DOOR_FEET);

  // A uniform grid over the strokes, so each run reads only the strokes near
  // it. A real sheet carries 10^5 pieces and a few hundred runs; the plain
  // product of the two is the cost this avoids. The cell is the reach of the
  // widest door, which is the furthest anything this reads can be from a run.
  const cell = Math.max(widestDoor * 1.5, 1e-6);
  const grid = new Map<string, number[]>();
  segments.forEach((s, i) => {
    const x0 = Math.floor(Math.min(s.x1, s.x2) / cell);
    const x1 = Math.floor(Math.max(s.x1, s.x2) / cell);
    const y0 = Math.floor(Math.min(s.y1, s.y2) / cell);
    const y1 = Math.floor(Math.max(s.y1, s.y2) / cell);
    // A stroke spanning a great many cells is a border or a long grid line;
    // it is still indexed, along its own bounding box.
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gy = y0; gy <= y1; gy += 1) {
        const k = `${gx}:${gy}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  });
  const near = (run: WallCandidate, pad: number): StrokeSegment[] => {
    const x0 = Math.floor((Math.min(run.x1, run.x2) - pad) / cell);
    const x1 = Math.floor((Math.max(run.x1, run.x2) + pad) / cell);
    const y0 = Math.floor((Math.min(run.y1, run.y2) - pad) / cell);
    const y1 = Math.floor((Math.max(run.y1, run.y2) + pad) / cell);
    const seen = new Set<number>();
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gy = y0; gy <= y1; gy += 1) {
        for (const i of grid.get(`${gx}:${gy}`) ?? []) seen.add(i);
      }
    }
    return [...seen].sort((a, b) => a - b).map((i) => segments[i]);
  };

  runs.forEach((run, index) => {
    if (run.curved) return;
    const dx = run.x2 - run.x1;
    const dy = run.y2 - run.y1;
    const length = Math.hypot(dx, dy);
    if (!(length > 0) || !(run.thicknessFeet > 0)) return;
    const ux = dx / length;
    const uy = dy / length;
    const half = units(run.thicknessFeet) / 2;
    const faceTol = Math.max(FACE_SHARE_OF_THICKNESS * 2 * half, units(FACE_FLOOR_FEET));
    const reach = half + widestDoor * 1.15;

    const faces: [Interval[], Interval[]] = [[], []];
    const interior: (Interval & { o: number })[] = [];
    const jambs: number[] = [];
    const curved: Local[] = [];

    for (const s of near(run, reach)) {
      const a1 = (s.x1 - run.x1) * ux + (s.y1 - run.y1) * uy;
      const a2 = (s.x2 - run.x1) * ux + (s.y2 - run.y1) * uy;
      const o1 = -(s.x1 - run.x1) * uy + (s.y1 - run.y1) * ux;
      const o2 = -(s.x2 - run.x1) * uy + (s.y2 - run.y1) * ux;
      // Cheap reject: nowhere near this run.
      if (Math.max(a1, a2) < -reach || Math.min(a1, a2) > length + reach) continue;
      if (Math.min(Math.abs(o1), Math.abs(o2)) > reach && o1 * o2 > 0) continue;
      const sl = Math.hypot(a2 - a1, o2 - o1);
      if (sl === 0) continue;

      if (s.curved) {
        curved.push({ a1, o1, a2, o2, curved: true });
        continue;
      }
      const sine = Math.abs(o2 - o1) / sl;
      if (sine <= PARALLEL_SINE) {
        const from = Math.max(0, Math.min(a1, a2));
        const to = Math.min(length, Math.max(a1, a2));
        if (to <= from) continue;
        const o = (o1 + o2) / 2;
        if (Math.abs(Math.abs(o) - half) <= faceTol) {
          if (to - from >= units(SHORTEST_FACE_PIECE_FEET)) faces[o > 0 ? 0 : 1].push({ from, to });
        } else if (Math.abs(o) < half - faceTol) {
          interior.push({ from, to, o });
        }
        continue;
      }
      const cosine = Math.abs(a2 - a1) / sl;
      if (cosine <= SQUARE_COSINE) {
        // A jamb line: square across the wall and spanning its body, no
        // further than a face's tolerance beyond either face.
        const lo = Math.min(o1, o2);
        const hi = Math.max(o1, o2);
        if (lo <= -half + faceTol && hi >= half - faceTol && lo >= -half - 2 * faceTol && hi <= half + 2 * faceTol) {
          jambs.push((a1 + a2) / 2);
        }
      }
    }

    const found: ProposedOpening[] = [];
    const facesA = unionOf(faces[0]);
    const facesB = unionOf(faces[1]);
    const anyFace = unionOf([...faces[0], ...faces[1]]);

    // ── LINES INSIDE THE WALL, GROUPED BY WHERE ACROSS IT THEY SIT ──
    //
    // A wall type drawn in several lines (a rated assembly, an exterior wall
    // with its sheathing and veneer shown) has interior lines of its OWN, at
    // the same offsets along every solid stretch; so does any wall with a grid
    // or reference line drawn down its centre. Glazing is the opposite: it sits
    // at an offset the solid wall does not have, and only where the window is.
    //
    // So a lane covering most of the run is the wall's own drawing and is never
    // read as glazing. Half the run, because no wall this reads is mostly
    // window AND drawn in several lines — and where one is, a window missed
    // here is a row the estimator types, which is the safe direction.
    const offsetTol = Math.max(units(OFFSET_FLOOR_FEET), OFFSET_SHARE_OF_THICKNESS * 2 * half);
    const lanes: { o: number; spans: Interval[] }[] = [];
    for (const piece of [...interior].sort((p, q) => p.o - q.o)) {
      const lane = lanes.find((l) => Math.abs(l.o - piece.o) <= offsetTol);
      if (lane) lane.spans.push(piece);
      else lanes.push({ o: piece.o, spans: [piece] });
    }
    const glassLanes = lanes
      .map((lane) => unionOf(lane.spans))
      .filter((cover) => coveredLength(cover, 0, length) < OWN_LANE_SHARE * length);
    const inside = unionOf(glassLanes.flat());
    const nearJamb = (at: number) => jambs.some((j) => Math.abs(j - at) <= units(JAMB_REACH_FEET));

    // ── DOORS: both faces stop, and a swing is hinged at a jamb ──
    for (const gap of bare(anyFace, length)) {
      // Cut INTO the wall: face stands before and after it. A gap touching
      // the run's end is where the wall stops, not a hole in it.
      if (gap.from <= 1e-9 || gap.to >= length - 1e-9) continue;
      const width = gap.to - gap.from;
      if (width < narrowest || width > widestDoor) continue;
      // A gap with glazing in it is a window, and the window pass reads it.
      if (coveredLength(inside, gap.from, gap.to) > 0.5 * width) continue;
      let leaves: 1 | 2 | null = null;
      let hinge = "";
      for (const side of [1, -1] as const) {
        if (leaves !== null) break;
        const ho = side * half;
        const atStart = swingAt(curved, gap.from, ho, side, 1, width * SINGLE_LEAF_SHARE[0], width * SINGLE_LEAF_SHARE[1]);
        const atEnd = swingAt(curved, gap.to, ho, side, -1, width * SINGLE_LEAF_SHARE[0], width * SINGLE_LEAF_SHARE[1]);
        if (atStart !== null || atEnd !== null) {
          leaves = 1;
          hinge = `a swing of ${feet(atStart ?? atEnd ?? 0).toFixed(1)} ft hinged at one jamb`;
          break;
        }
        const pairA = swingAt(curved, gap.from, ho, side, 1, width * PAIR_LEAF_SHARE[0], width * PAIR_LEAF_SHARE[1]);
        const pairB = swingAt(curved, gap.to, ho, side, -1, width * PAIR_LEAF_SHARE[0], width * PAIR_LEAF_SHARE[1]);
        if (pairA !== null && pairB !== null) {
          leaves = 2;
          hinge = "two swings, one hinged at each jamb";
        }
      }
      if (leaves === null) continue;
      found.push({
        kind: "door",
        leaves,
        widthFt: feet(width),
        at: (gap.from + gap.to) / 2 / length,
        evidence: `the wall's faces stop for ${feet(width).toFixed(2)} ft and ${hinge}`,
      });
    }

    // ── WINDOWS: a glazing lane that starts and stops at a pair of jambs ──
    //
    // The lane must NOT continue into the wall either side of it — glazing
    // stops where the window does. A grid line down a wall's centre fails that
    // and so does a multi-line wall type's own drawing, which the lane filter
    // above has usually removed already.
    const glassAt: Interval[] = [];
    const plain = units(PLAIN_WALL_EACH_SIDE_FEET);
    for (const cover of glassLanes) {
      for (const glass of cover) {
        // Glazing running out to the run's end fails here too: the plain
        // stretch beside it would lie off the run.
        const width = glass.to - glass.from;
        if (width < narrowest || width > widestWindow) continue;
        const before = { from: glass.from - plain, to: glass.from };
        const after = { from: glass.to, to: glass.to + plain };
        // Wall stands either side — both faces drawn — and THIS line does not
        // continue into it. See `PLAIN_WALL_EACH_SIDE_FEET`.
        const stands = (span: Interval) =>
          coveredLength(facesA, span.from, span.to) >= 0.9 * plain &&
          coveredLength(facesB, span.from, span.to) >= 0.9 * plain &&
          coveredLength(cover, span.from, span.to) <= 0.1 * plain;
        if (!stands(before) || !stands(after)) continue;
        if (!nearJamb(glass.from) || !nearJamb(glass.to)) continue;
        // AND THE SILLS RUN ACROSS IT. A window is drawn with the wall's face
        // lines continuing over it as the sill and head; a sliding or pocket
        // door drawn closed is the same single line between two jambs with the
        // faces STOPPED, and is not glazing.
        const sills = (cover: Interval[]) => coveredLength(cover, glass.from, glass.to) >= SILL_SHARE * width;
        if (!sills(facesA) || !sills(facesB)) continue;
        glassAt.push(glass);
      }
    }
    // Several glazing lines across one window are one window.
    for (const glass of unionOf(glassAt)) {
      const width = glass.to - glass.from;
      found.push({
        kind: "window",
        widthFt: feet(width),
        at: (glass.from + glass.to) / 2 / length,
        evidence: `${feet(width).toFixed(2)} ft of glazing drawn inside the wall, closed by a jamb line at each end`,
      });
    }

    if (found.length > 0) out.set(index, found.sort((p, q) => p.at - q.at));
  });
  return out;
}
