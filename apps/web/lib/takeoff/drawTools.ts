/**
 * ── THE MATHS BEHIND THE DRAWING TOOLS ──
 *
 * Snapping, axis lock, rectangles and typed lengths. Pure functions in the
 * page-width box (`x` runs 0..1, `y` runs 0..H/W — see `takeoff.prisma`), so
 * every rule here can be argued with in a test rather than by clicking.
 *
 * None of this knows about React, pdf.js or a pointer. The viewer decides WHEN
 * to snap; this decides WHERE.
 */

export type Point = { x: number; y: number };

/**
 * How close a click must be to something before it snaps to it, in page-width
 * units.
 *
 * ── IT IS A SCREEN DISTANCE, NOT A DRAWING ONE, AND THE VIEWER SCALES IT ──
 *
 * 0.004 of the page width is about 3px on a sheet drawn at 800px across. At
 * 400% zoom the same drawing distance is 24px on screen, which would snap a
 * click that was nowhere near — so the caller divides by the zoom. A snap
 * radius that grows as you zoom in is a snap that fights you exactly when you
 * are being careful.
 */
export const SNAP_RADIUS = 0.004;

/** Candidate things a click can snap to, in page-width units. */
export type SnapTarget =
  | { kind: "vertex"; x: number; y: number }
  | { kind: "segment"; x1: number; y1: number; x2: number; y2: number };

export type Snapped = { x: number; y: number; to: "vertex" | "segment" | null };

const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** The nearest point on a segment to `p`, clamped to the segment's ends. */
export function nearestOnSegment(p: Point, x1: number, y1: number, x2: number, y2: number): Point {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { x: x1, y: y1 };
  // Clamped, so a click beyond the end of a wall snaps to its corner rather
  // than to a point on the line it would reach if the wall carried on.
  const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / lengthSquared));
  return { x: x1 + t * dx, y: y1 + t * dy };
}

/**
 * Pull a click onto the drawing's own geometry.
 *
 * ── A VERTEX BEATS A SEGMENT, EVEN WHEN THE SEGMENT IS NEARER ──
 *
 * Corners are what people aim at. A wall's end is a vertex and the wall itself
 * is a segment, and within the radius they are almost always both in range —
 * so taking whichever is closer would snap to a point an eighth of an inch
 * along the wall instead of to the corner, which is the one place the
 * estimator actually meant. Vertices are tested first and win outright.
 */
export function snapToGeometry(
  point: Point,
  targets: readonly SnapTarget[],
  radius = SNAP_RADIUS,
): Snapped {
  let bestVertex: Point | null = null;
  let bestVertexDistance = radius;
  let bestSegment: Point | null = null;
  let bestSegmentDistance = radius;

  for (const target of targets) {
    if (target.kind === "vertex") {
      const d = distance(point.x, point.y, target.x, target.y);
      if (d < bestVertexDistance) {
        bestVertexDistance = d;
        bestVertex = { x: target.x, y: target.y };
      }
    } else {
      const near = nearestOnSegment(point, target.x1, target.y1, target.x2, target.y2);
      const d = distance(point.x, point.y, near.x, near.y);
      if (d < bestSegmentDistance) {
        bestSegmentDistance = d;
        bestSegment = near;
      }
    }
  }

  if (bestVertex) return { ...bestVertex, to: "vertex" };
  if (bestSegment) return { ...bestSegment, to: "segment" };
  return { x: point.x, y: point.y, to: null };
}

/**
 * Hold shift and the next point locks to an axis.
 *
 * ── EVERY 45°, NOT JUST HORIZONTAL AND VERTICAL ──
 *
 * A building is mostly square and sometimes has a diagonal corridor or a
 * chamfered corner. Locking to four directions would make those unmeasurable
 * with shift held, so somebody would stop using it entirely — and a lock
 * people switch off is worse than no lock, because the walls they trace
 * freehand are no straighter than before.
 *
 * The length is PRESERVED along the locked direction, not projected onto it:
 * projecting shortens the run as the pointer drifts off axis, so the number
 * changes while the line looks the same. Somebody dragging 10 ft at 2° off
 * horizontal means 10 ft.
 */
export function lockToAxis(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { ...to };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/**
 * The four corners of a rectangle from two opposite ones.
 *
 * Clockwise from `a`, so the ring has a consistent winding — `ringArea` takes
 * the absolute value and does not care, but a consistent order means the
 * rendered outline never crosses itself however the two corners were dragged.
 */
export function rectanglePoints(a: Point, b: Point): { xs: number[]; ys: number[] } {
  return { xs: [a.x, b.x, b.x, a.x], ys: [a.y, a.y, b.y, b.y] };
}

/**
 * Extend a run by a TYPED length rather than a click.
 *
 * ── THE DIRECTION COMES FROM THE POINTER, THE DISTANCE FROM THE KEYBOARD ──
 *
 * Which is how every CAD package does it, and the reason is that a plan often
 * prints a dimension the drawing is not drawn to — a corridor marked 42'-6"
 * that scales at 42'-2". The estimator trusts the printed figure. So they aim
 * the direction and type the number.
 *
 * `feetPerPageWidth` converts: a sheet 144 ft across means 1 ft is 1/144 of
 * the page width. Returns null when the sheet has no scale, because a typed
 * length against no scale is a number with no length.
 */
export function extendByLength(
  from: Point,
  toward: Point,
  feet: number,
  feetPerPageWidth: number | null,
): Point | null {
  if (feetPerPageWidth === null || !Number.isFinite(feetPerPageWidth) || feetPerPageWidth <= 0) return null;
  if (!Number.isFinite(feet) || feet <= 0) return null;
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy);
  // No direction to go in. NOT defaulted to east: a run that appears pointing
  // right because somebody typed a length before aiming is a wall in the
  // wrong place, and a refusal is a sentence they can act on.
  if (length === 0) return null;
  const units = feet / feetPerPageWidth;
  return { x: from.x + (dx / length) * units, y: from.y + (dy / length) * units };
}

/**
 * Should this click CLOSE the shape rather than add a point?
 *
 * True when it lands on the first vertex of a ring that already has enough
 * points to be one. Closing by clicking the start is the gesture every
 * drawing tool uses, and discovering it costs nothing.
 *
 * AREAS ONLY — a linear run that ends where it started is a legitimate loop
 * of wall, and treating that click as "close" would refuse to measure the
 * last few feet of a room's perimeter.
 */
export function closesRing(
  point: Point,
  xs: readonly number[],
  ys: readonly number[],
  radius = SNAP_RADIUS,
): boolean {
  if (xs.length < 3) return false;
  return distance(point.x, point.y, xs[0], ys[0]) <= radius;
}

/**
 * Is this cutout inside its outline?
 *
 * ── CHECKED BEFORE IT IS STORED, because the alternative is silent ──
 *
 * A hole drawn partly outside the shape it belongs to deducts area the
 * outline never had, and `netArea` clamps the result at zero rather than going
 * negative — so the symptom is a room that measures NOTHING, which reads as a
 * broken tool rather than as a badly drawn opening. Refusing it at the point
 * of drawing is the only moment the person still knows what they meant.
 *
 * Every vertex must be inside, by ray casting. A hole whose corners are all
 * inside a non-convex outline can still cross it, which this does not catch —
 * and that is a deliberate bound rather than an oversight: the check that
 * would is a full polygon intersection, and the failure it adds cover for is
 * rarer than the ones it would refuse by mistake.
 */
export function cutoutInside(
  hole: { xs: readonly number[]; ys: readonly number[] },
  outline: { xs: readonly number[]; ys: readonly number[] },
): boolean {
  if (hole.xs.length < 3 || outline.xs.length < 3) return false;
  for (let i = 0; i < hole.xs.length; i += 1) {
    if (!pointInRing(hole.xs[i], hole.ys[i], outline.xs, outline.ys)) return false;
  }
  return true;
}

/** Ray casting, counting crossings to the right of the point. */
export function pointInRing(x: number, y: number, xs: readonly number[], ys: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i, i += 1) {
    const intersects =
      ys[i] > y !== ys[j] > y && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i];
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Move one vertex of a shape, leaving the rest alone. */
export function moveVertex(
  xs: readonly number[],
  ys: readonly number[],
  index: number,
  to: Point,
): { xs: number[]; ys: number[] } {
  const nextXs = [...xs];
  const nextYs = [...ys];
  if (index >= 0 && index < nextXs.length) {
    nextXs[index] = to.x;
    nextYs[index] = to.y;
  }
  return { xs: nextXs, ys: nextYs };
}

/**
 * Which vertex of a shape a click is on, or null.
 *
 * NEAREST WINS HERE, unlike `snapToGeometry` — every candidate is the same
 * kind of thing, so there is no "a corner is what people aim at" to prefer.
 */
export function vertexAt(
  point: Point,
  xs: readonly number[],
  ys: readonly number[],
  radius = SNAP_RADIUS,
): number | null {
  let best: number | null = null;
  let bestDistance = radius;
  for (let i = 0; i < xs.length; i += 1) {
    const d = distance(point.x, point.y, xs[i], ys[i]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}
