import type { StrokeSegment } from "./wallVectors";

/**
 * ── THE COLUMN GRID, AND WHY IT KEEPS BEING BILLED AS A WALL ──
 *
 * Measured against a 60-page answer key: after the pairer learned to take the
 * OUTERMOST of several parallel faces, 1,849 ft came back in a 12.4in band that
 * matches no assembly on the drawing. Looked at directly, the geometry says
 * what it is — within two feet of one building's west wall the faces sit at
 * +0.00, +1.56, +2.28, +8.28 and +8.88 inches, and then there is one more line
 * at **+12.48in which is 115 ft long and runs past the building at both ends**.
 * That is the column grid, and 12.48in is inside the thickness band.
 *
 * Two things were tried on it and both failed, which is why this exists:
 *
 *   - `MAX_FACE_LENGTH_RATIO` (3) catches it on one sheet, 115 against 28.3,
 *     and misses it on another where the partner is 40.1.
 *   - Preferring a partner of COMPARABLE length misses it everywhere the outer
 *     finish happens to be long: 94 ft against 115 is a ratio of 1.22, as
 *     balanced as a real pair.
 *
 * Length is not the discriminator because a grid line's length is whatever the
 * building is. What is always true of one is the thing an architect draws it
 * with: **it ends in a BUBBLE** — a small circle carrying the grid's letter or
 * number — and nothing else on a floor plan does.
 *
 * ── A BUBBLE IS A PHYSICAL SIZE, NOT A BUILDING SIZE ──
 *
 * Measured in PAPER inches rather than feet of building, for the same reason
 * the scale reader measures lettering that way: a grid bubble is drawn about
 * 3/8in to 5/8in across on the sheet whatever the drawing's scale, because it
 * has to hold a readable character. In feet of building the same bubble is 3 ft
 * at 1/8in scale and 1.5 ft at 1/4in, so a bound in feet would be a different
 * bound on every sheet.
 */

/** A circle found in the line work, in the segments' own units. */
export type GridBubble = { x: number; y: number; radius: number };

/** The smallest and largest a grid bubble is drawn, across the sheet, in PAPER
 *  inches of diameter. Below 1/4in nothing readable fits inside; above 3/4in it
 *  is a detail callout or a north arrow rather than a grid head. */
export const BUBBLE_INCHES_MIN = 0.1;
export const BUBBLE_INCHES_MAX = 0.75;

/*
 * THE MINIMUM IS MEASURED, AND IT IS SMALLER THAN A DRAWN BUBBLE SHOULD BE.
 *
 * It was 0.25in on the reasoning that nothing readable fits in less, and at
 * that bound the detector found ZERO bubbles on six of seven real pages while
 * passing thirteen fixtures of its own — the shape of every false result this
 * feature has produced.
 *
 * Measuring instead of reasoning: those pages carry 46 round closed chains
 * each, every one of them 0.164in across, and the half-size sheet carries 32 at
 * 0.082in — exactly half, which is the same symbol on a reduced sheet. So the
 * circles were there the whole time and the bound excluded all of them.
 *
 * 0.164in is about 12 points, which is small for a grid head that has to hold a
 * character; a hand-drafted sheet would use nearer 3/8in. This bound is
 * therefore fitted to ONE generator and is the first thing to re-measure on
 * another set. It is set at 0.1 rather than 0.15 so a slightly smaller symbol
 * is not missed the same way again.
 */

/** How far a flattened arc's points may stray from a common radius, as a
 *  fraction of it. A circle flattened into segments is regular to well inside
 *  this; a rounded rectangle or a door swing is not. */
const ROUNDNESS = 0.18;

/** The least of a full turn a run of segments must cover to be a closed bubble
 *  rather than an arc. A door swing is a quarter turn and must not qualify. */
const MIN_TURN = Math.PI * 1.5;

/**
 * Find the grid bubbles: small closed circles in the line work.
 *
 * `unitsPerPaperInch` converts the segments' own coordinates to inches ON THE
 * SHEET — for coordinates normalised to the page width, that is 1 divided by
 * the paper's width in inches.
 */
export function gridBubbles(
  segments: readonly StrokeSegment[],
  unitsPerPaperInch: number,
): GridBubble[] {
  if (!(unitsPerPaperInch > 0) || segments.length === 0) return [];
  const minR = (BUBBLE_INCHES_MIN / 2) * unitsPerPaperInch;
  const maxR = (BUBBLE_INCHES_MAX / 2) * unitsPerPaperInch;
  // A flattened circle's pieces are short. Anything longer than the biggest
  // bubble's diameter cannot be one of its arcs.
  const longest = maxR * 2;

  // Chain short segments end to end. pdf.js emits a flattened curve as a run of
  // pieces that share endpoints exactly, so this is an index lookup rather than
  // a search.
  const key = (x: number, y: number) => `${Math.round(x / (minR * 0.05))},${Math.round(y / (minR * 0.05))}`;
  const startsAt = new Map<string, number[]>();
  const short: { i: number; s: StrokeSegment }[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (len === 0 || len > longest) continue;
    short.push({ i, s });
    const k = key(s.x1, s.y1);
    const list = startsAt.get(k) ?? [];
    list.push(short.length - 1);
    startsAt.set(k, list);
  }

  const walked = new Set<number>();
  const bubbles: GridBubble[] = [];
  for (let n = 0; n < short.length; n += 1) {
    if (walked.has(n)) continue;
    const points: { x: number; y: number }[] = [];
    let at = n;
    // Bounded: a chain cannot be longer than the pool it is drawn from.
    for (let step = 0; step < short.length + 1; step += 1) {
      if (walked.has(at)) break;
      walked.add(at);
      const s = short[at].s;
      points.push({ x: s.x1, y: s.y1 });
      const next = (startsAt.get(key(s.x2, s.y2)) ?? []).find((c) => !walked.has(c));
      if (next === undefined) {
        points.push({ x: s.x2, y: s.y2 });
        break;
      }
      at = next;
    }
    if (points.length < 6) continue;

    const cx = points.reduce((t, p) => t + p.x, 0) / points.length;
    const cy = points.reduce((t, p) => t + p.y, 0) / points.length;
    const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const radius = radii.reduce((t, r) => t + r, 0) / radii.length;
    if (radius < minR || radius > maxR) continue;
    // Every point the same distance from the centre — that is what a circle is,
    // and what separates one from a rounded corner or a stretch of door swing.
    if (radii.some((r) => Math.abs(r - radius) > radius * ROUNDNESS)) continue;
    // And it must go most of the way round. A door swing is a quarter turn at a
    // plausible radius and would otherwise pass everything above.
    let turn = 0;
    for (let k = 1; k < points.length; k += 1) {
      const a = Math.atan2(points[k - 1].y - cy, points[k - 1].x - cx);
      const b = Math.atan2(points[k].y - cy, points[k].x - cx);
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      turn += d;
    }
    if (Math.abs(turn) < MIN_TURN) continue;
    bubbles.push({ x: cx, y: cy, radius });
  }
  return bubbles;
}

/** How close a line's end must come to a bubble's centre to be its grid line,
 *  as a multiple of that bubble's radius. A grid line runs INTO the bubble, so
 *  its end sits at or inside the circle; one radius of slack covers a line that
 *  stops at the edge. */
const REACHES_INTO = 2;

/**
 * The segments that terminate at a grid bubble — the column grid itself.
 *
 * Returned as a SET OF INDICES into the array given, so a caller can drop them
 * before pairing without disturbing anything else's view of the sheet.
 *
 * Only an END counts, never the middle: a grid line passes THROUGH the building
 * and real walls cross it everywhere, so a wall that happens to pass near a
 * bubble must not be caught by this.
 */
export function linesIntoBubbles(
  segments: readonly StrokeSegment[],
  bubbles: readonly GridBubble[],
): Set<number> {
  const out = new Set<number>();
  if (bubbles.length === 0) return out;
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    for (const b of bubbles) {
      const reach = b.radius * REACHES_INTO;
      const endsHere =
        Math.hypot(s.x1 - b.x, s.y1 - b.y) <= reach || Math.hypot(s.x2 - b.x, s.y2 - b.y) <= reach;
      if (endsHere) {
        out.add(i);
        break;
      }
    }
  }
  return out;
}
