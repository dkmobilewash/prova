/**
 * ── WHICH CANDIDATE A CLICK ON THE DRAWING MEANS ──
 *
 * The lines are drawn with `vectorEffect="non-scaling-stroke"`, so every one
 * is the same handful of SCREEN pixels wide however far out the sheet is
 * zoomed. A duplicate pair is offset by inches of building — nine, in the
 * E Street case — which at any sensible zoom is a fraction of a pixel. The two
 * lines are therefore the same pixels, and the one SVG draws last takes every
 * click.
 *
 * That is why a pre-rejected grey candidate could not be selected on the
 * drawing while its row in the panel worked: its accepted twin was on top of
 * it. Reported 2026-10-20.
 *
 * ── CYCLING, NOT NEAREST ──
 *
 * Nearest-wins does not help when two lines are equidistant to within a
 * rounding error, which is exactly the case. So a click takes the nearest
 * candidate under the pointer, and clicking the SAME PLACE again takes the
 * next one along, wrapping. Two overlapping candidates are two clicks apart;
 * an ordinary candidate with nothing near it is unaffected, because the list
 * under the pointer has one member and the next one along is itself.
 *
 * Pure. No DOM, no React.
 */

export type PickableCandidate = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/**
 * How close a line must pass to the click, in page-width units.
 *
 * The caller converts from pixels, because the right radius depends on the
 * zoom and on how wide the stroke is drawn — a fixed value here would be
 * generous at one zoom and unreachable at another.
 */
export const DEFAULT_PICK_RADIUS = 0.004;

/** Distance from a point to a SEGMENT, not to its infinite line. */
export function distanceToSegment(
  c: PickableCandidate,
  px: number,
  py: number,
): number {
  const dx = c.x2 - c.x1;
  const dy = c.y2 - c.y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - c.x1, py - c.y1);
  // Clamped, so a click a long way past the end of a short wall does not
  // claim it — the infinite line would stretch across the whole sheet.
  let t = ((px - c.x1) * dx + (py - c.y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (c.x1 + t * dx), py - (c.y1 + t * dy));
}

/**
 * The candidate a click means, given what is already focused.
 *
 * `clicked` is the id SVG delivered the event on — used only as a fallback
 * when nothing is within the radius, which happens when the stroke is drawn
 * wider than the radius allows for.
 */
export function pickOnClick(input: {
  candidates: readonly PickableCandidate[];
  x: number;
  y: number;
  focusedId: string | null;
  clicked?: string | null;
  radius?: number;
}): string | null {
  const radius = input.radius ?? DEFAULT_PICK_RADIUS;
  const under = input.candidates
    .map((c) => ({ id: c.id, distance: distanceToSegment(c, input.x, input.y) }))
    .filter((c) => c.distance <= radius)
    // Distance first, then id — a stable order, so "the next one along" means
    // the same thing on every click rather than following paint order.
    .sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (under.length === 0) return input.clicked ?? null;
  if (input.focusedId === null) return under[0].id;
  const at = under.findIndex((c) => c.id === input.focusedId);
  if (at === -1) return under[0].id;
  return under[(at + 1) % under.length].id;
}
