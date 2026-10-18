import type { StrokeSegment } from "./wallVectors";

/**
 * ── THE DOORWAYS THAT MERGE EVERY ROOM INTO ONE ──
 *
 * The region engine calls a thin space a wall when it has a DIFFERENT room on
 * each side. On a closed-plan sheet that works. On West Herr it found almost
 * nothing, and counting said why: of 49,162 sq ft of room on that sheet,
 * **32,256 of it is ONE region** — two thirds of the building as a single
 * undivided space.
 *
 * It is not one space. It is dozens of rooms, and they merged because EVERY
 * DOORWAY CONNECTS THEM. A door is a gap in a wall, a gap means the rooms either
 * side are one region, and the walls inside that region then separate it from
 * itself. They were found — that sheet yields 1,062 wall-width regions, so the
 * walls are drawn with real thickness — and then thrown away.
 *
 * So this is not another rule. A rule can only reject a candidate that already
 * exists, and the problem is that the candidates are being destroyed upstream.
 * Closing the openings puts them back.
 *
 * ── HOW AN OPENING IS RECOGNISED ──
 *
 * A wall face is a straight line that STOPS at the door and RESUMES after it. So
 * a door-sized gap inside a family of collinear segments is an opening, and that
 * is pure geometry over data already in hand — no arc fitting, no door blocks,
 * nothing that depends on how a particular CAD program draws furniture.
 *
 * A swing arc would be the other signal, and is deliberately not used: an arc
 * reaches us as dozens of flattened bezier segments, recognising it is its own
 * problem, and a plan's openings do not all have doors in them. A cased opening,
 * a borrowed light and a demolition gap have no arc and are all still openings.
 *
 * ── WHY THIS IS SAFE TO GET WRONG, AND WHERE IT IS NOT ──
 *
 * Closing a gap only ADDS ink, and adding ink can only split a region, never
 * merge one. So a missed opening costs recall exactly as today, and nothing
 * regresses.
 *
 * A WRONG closure is the real risk and it is not symmetric: a line drawn across
 * something that was never a door splits one room into two, and the engine then
 * reports the thing between them as a wall that does not exist. A wall that is
 * not there is worse than a wall that is missing, because the estimator cannot
 * see it is wrong. Hence the bounds below are narrow rather than generous, and
 * every one of them is a door's own dimensions rather than a tuned number.
 */

export type Opening = {
  /** The line that closes the gap, in the same units as the segments given. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** How wide the opening is, in feet — a door, for a reviewer to sanity-check. */
  widthFeet: number;
};

/**
 * The narrowest opening worth closing, in feet.
 *
 * A 2ft door is a closet. Below that a gap in a line is far more likely to be
 * the draughting itself — a break for a dimension witness, a line type, a corner
 * that does not quite meet — than a way through a wall.
 */
export const NARROWEST_DOOR_FEET = 2;

/**
 * The widest, in feet.
 *
 * A pair of double doors is 6ft and a cased opening to a corridor runs to about
 * 12. Past that it stops being an opening in a wall and becomes the absence of a
 * wall, which is a thing this must not invent one across — an open-plan edge
 * closed by a 30ft line would fabricate a room boundary and the walls around it.
 */
export const WIDEST_DOOR_FEET = 12;

/**
 * How much wall must stand on EACH side of the gap, in feet.
 *
 * A door is cut INTO a wall, so there is wall either side of it. Without this a
 * pair of unrelated short ticks that happen to line up — a furniture edge, a
 * leader, a hatch stroke — would be read as a jamb pair and closed.
 */
export const WALL_EACH_SIDE_FEET = 1;

/** Two segments count as the same line within this angle, in radians (~1°). */
const SAME_LINE_ANGLE = 0.0175;

/**
 * And within this distance across it, in feet.
 *
 * Tight on purpose: a wall's two FACES are typically 4-7/8in apart, so a loose
 * value here would treat both faces of one wall as a single line and close a gap
 * between a point on one face and a point on the other — a diagonal across the
 * wall rather than a line across the door.
 */
const SAME_LINE_OFFSET_FEET = 0.08;

type Along = { from: number; to: number };

/**
 * Find the openings in a sheet's line work.
 *
 * `feetPerUnit` converts the segments' own units to feet, the same contract the
 * rest of this directory takes.
 */
export function openingsInWalls(
  segments: readonly StrokeSegment[],
  feetPerUnit: number,
  options: {
    narrowestFeet?: number;
    widestFeet?: number;
    wallEachSideFeet?: number;
  } = {},
): Opening[] {
  const narrowest = (options.narrowestFeet ?? NARROWEST_DOOR_FEET) / feetPerUnit;
  const widest = (options.widestFeet ?? WIDEST_DOOR_FEET) / feetPerUnit;
  const eachSide = (options.wallEachSideFeet ?? WALL_EACH_SIDE_FEET) / feetPerUnit;
  if (!(feetPerUnit > 0) || segments.length === 0) return [];

  const offsetTolerance = SAME_LINE_OFFSET_FEET / feetPerUnit;

  /**
   * Group the segments into families that lie on the SAME INFINITE LINE.
   *
   * Keyed by the line itself — direction and perpendicular distance from the
   * origin — rather than by endpoint proximity, so two halves of one wall face
   * forty feet apart still land together, which is exactly the case a doorway
   * creates and the one that matters.
   */
  /**
   * Group the segments into families that lie on the SAME INFINITE LINE.
   *
   * Keyed by the line itself — orientation and perpendicular distance from the
   * origin — rather than by endpoint proximity, so two halves of one wall face
   * forty feet apart still land together. That is exactly what a doorway makes,
   * and it is the only case that matters here.
   *
   * `offset` is the signed distance from the origin to the line, so a point on
   * it at distance `t` along is `t*(ux,uy) + offset*(-uy,ux)` — which is how the
   * closing line's two ends are rebuilt once a gap is found.
   */
  const families = new Map<string, { ux: number; uy: number; offset: number; spans: Along[] }>();
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    let ux = dx / length;
    let uy = dy / length;
    // A line has no direction, only an orientation: flip into a half-plane so a
    // segment drawn right-to-left joins the family of one drawn left-to-right
    // instead of forming a second, parallel family of its own.
    if (ux < 0 || (ux === 0 && uy < 0)) {
      ux = -ux;
      uy = -uy;
    }
    const angle = Math.atan2(uy, ux);
    const offset = -uy * s.x1 + ux * s.y1;
    const key = `${Math.round(angle / SAME_LINE_ANGLE)}:${Math.round(offset / offsetTolerance)}`;
    const family = families.get(key) ?? { ux, uy, offset, spans: [] };
    const a = s.x1 * ux + s.y1 * uy;
    const b = s.x2 * ux + s.y2 * uy;
    family.spans.push({ from: Math.min(a, b), to: Math.max(a, b) });
    families.set(key, family);
  }

  /**
   * ── ONLY GAPS IN A WALL FACE ──
   *
   * The first version closed a gap in ANY family of collinear segments, and
   * measured, that helped one sheet and hurt another: West Herr's walls went
   * 377ft to 1,093ft, and Augusta's went 472ft DOWN to 323ft. Augusta's largest
   * room did not move by a single square foot, which says its rooms were already
   * closed — so every closure drawn on it was noise, and noise that adds ink
   * cuts wall cavities into pieces too short to report.
   *
   * A sheet is full of collinear lines that are not walls: furniture, grid
   * lines, hatching, leaders, the drawing's own borders. What distinguishes a
   * wall face is the thing the line pairer was always right about — A WALL FACE
   * HAS ANOTHER FACE PARALLEL TO IT, a wall's thickness away. That test is cheap
   * here because the families are already keyed by orientation and offset, so it
   * is a lookup rather than another pass over the geometry.
   *
   * This is the pairer's rule used for what it is genuinely good at — telling a
   * wall's line from a furniture line — rather than for finding whole walls,
   * which is the job it cannot finish.
   */
  const minThickness = 0.2 / feetPerUnit;
  const maxThickness = 1.5 / feetPerUnit;
  const byAngle = new Map<string, number[]>();
  for (const [key, family] of families) {
    const angleKey = key.slice(0, key.indexOf(":"));
    const list = byAngle.get(angleKey) ?? [];
    list.push(family.offset);
    byAngle.set(angleKey, list);
  }
  const hasAPartnerFace = (key: string, offset: number): boolean => {
    const siblings = byAngle.get(key.slice(0, key.indexOf(":")));
    if (!siblings) return false;
    for (const other of siblings) {
      const apart = Math.abs(other - offset);
      if (apart >= minThickness && apart <= maxThickness) return true;
    }
    return false;
  };

  const openings: Opening[] = [];
  for (const [key, { ux, uy, offset, spans }] of families) {
    if (spans.length < 2) continue;
    if (!hasAPartnerFace(key, offset)) continue;
    spans.sort((a, b) => a.from - b.from);
    // Merge what overlaps or touches, so a face drawn as twenty collinear pieces
    // is ONE run and only a real break between runs survives as a gap.
    const runs: Along[] = [];
    for (const span of spans) {
      const last = runs[runs.length - 1];
      if (last && span.from <= last.to) {
        if (span.to > last.to) last.to = span.to;
      } else {
        runs.push({ from: span.from, to: span.to });
      }
    }
    const pointAt = (t: number): [number, number] => [t * ux - offset * uy, t * uy + offset * ux];
    for (let i = 1; i < runs.length; i += 1) {
      const before = runs[i - 1];
      const after = runs[i];
      const gap = after.from - before.to;
      if (gap < narrowest || gap > widest) continue;
      // A door is cut INTO a wall, so wall stands either side of it.
      if (before.to - before.from < eachSide) continue;
      if (after.to - after.from < eachSide) continue;
      const [x1, y1] = pointAt(before.to);
      const [x2, y2] = pointAt(after.from);
      // ── A CORRIDOR IS NOT A DOORWAY, AND IT LOOKS EXACTLY LIKE ONE HERE ──
      //
      // Everything above is satisfied by a corridor crossing: wall on each
      // side, a gap between `narrowest` and `widest`, on one line. A 5'-7"
      // corridor is well inside those bounds, so this sealed it — and sealing
      // it makes the corridor an enclosed thin region, which the region engine
      // then reports as WALL.
      //
      // Measured on the exam-rooms fixture: the pairer puts nothing in the
      // corridor and the region engine puts nothing there either, UNTIL this
      // seals it — at which point six candidates appear inside it and the merge
      // strings them into six forty-foot runs through open floor. 40 ft is a
      // room, the corridor, and the room opposite.
      //
      // #726 tried to fix that downstream, in `mergeWalls`, and could not:
      // union-find is transitive, so refusing the pair either side of a
      // corridor does nothing once something bridges them. **The bridge is made
      // here.** This is the root of it.
      //
      // The discriminator is the same one `mergeWalls` uses and it belongs in
      // both places: a corridor has its own two walls running ACROSS the ends
      // of the gap, and a doorway has nothing there.
      if (crossesPerpendicularWalls(segments, ux, uy, x1, y1, x2, y2, feetPerUnit)) continue;
      openings.push({ x1, y1, x2, y2, widthFeet: gap * feetPerUnit });
    }
  }
  return openings;
}

/** How close to a gap's end a perpendicular face counts as bounding it. */
const BOUNDS_THE_GAP_FEET = 1.5;

/** Within this of perpendicular, as a dot product of unit vectors — about 15°
 *  of slack for a building that is not quite square. */
const ROUGHLY_PERPENDICULAR = 0.25;

/**
 * Is this gap a corridor rather than a doorway?
 *
 * A door is a hole in one wall: nothing crosses it. A corridor has its own two
 * walls running across the ends of the gap, which is what makes it a corridor.
 * So: a perpendicular face near EACH end, and they must be on two different
 * lines — one long face passing both ends is a wall running alongside.
 *
 *   a DOOR       nothing perpendicular at either jamb   -> seal it
 *   a CORRIDOR   a perpendicular face at BOTH ends      -> leave it open
 *
 * Works on raw FACES rather than detected walls, because that is what this
 * module has and because a face is the earlier, more reliable evidence.
 *
 * Degrades the safe way: if the corridor's walls were not drawn, nothing bounds
 * the gap and it is sealed exactly as before.
 */
function crossesPerpendicularWalls(
  segments: readonly StrokeSegment[],
  ux: number,
  uy: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  feetPerUnit: number,
): boolean {
  const near = BOUNDS_THE_GAP_FEET / feetPerUnit;
  let atFrom: number | null = null;
  let atTo: number | null = null;
  for (const face of segments) {
    const dx = face.x2 - face.x1;
    const dy = face.y2 - face.y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    if (Math.abs((dx / len) * ux + (dy / len) * uy) > ROUGHLY_PERPENDICULAR) continue;
    // Which LINE it is on, so the two ends cannot be bounded by one wall's own
    // two faces — those are the same wall and bound nothing.
    const line = Math.round((-(dy / len) * face.x1 + (dx / len) * face.y1) / near);
    if (atFrom === null && pointToSegment(fromX, fromY, face) <= near) atFrom = line;
    if (atTo === null && pointToSegment(toX, toY, face) <= near) atTo = line;
    if (atFrom !== null && atTo !== null && atFrom !== atTo) return true;
  }
  return false;
}

/** Distance from a point to a segment. */
function pointToSegment(px: number, py: number, s: StrokeSegment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - s.x1, py - s.y1);
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}
