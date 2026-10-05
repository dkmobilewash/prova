/**
 * THE PAGE-WIDTH BOX — the one contract every coordinate on a sheet is in.
 *
 * Extracted from `takeoff-plan.ts` 2026-10-04 when plan PINS became a second
 * consumer. The convention is unchanged and the functions are moved verbatim;
 * `takeoff-plan.ts` re-exports them so every existing import still resolves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `page.getViewport({ scale: 1 })`, with pdf.js having already applied the
 * page's own `/Rotate`, gives a width and height in PDF points. Every stored
 * coordinate is the pointer offset divided by the RENDERED WIDTH — on BOTH
 * axes. So `x` runs 0..1 and `y` runs 0..H/W. **`y` is not a fraction of the
 * height.**
 *
 * That asymmetry is deliberate. Normalising each axis by its own extent — which
 * is what `JobMediaAnnotation` does for photo marks — distorts Euclidean
 * distance by the aspect ratio, so every length would need the page's
 * dimensions stored beside it to be meaningful. Issue #256 is what it cost when
 * the comment naming the box was wrong: a GC was shown an arrow pointing at the
 * wrong part of a photo "while every comment in the codebase said the geometry
 * was handled."
 *
 * **THERE ARE THEREFORE TWO CONVENTIONS IN THIS REPO AND THEY ARE BOTH RIGHT.**
 * A photo mark is a point on one image and nothing is ever measured between two
 * of them, so per-axis is fine there. A SHEET carries measurements, markup
 * lengths and pins that get compared, so distance has to be computable from the
 * stored numbers alone. Anything on a sheet uses this file; anything on a photo
 * uses `media-annotations.prisma`'s. Do not "unify" them — that is the drift,
 * not the fix.
 *
 * Pure. No database, no React, no pdfjs. Every number below can be checked on a
 * laptop with no drawing in front of you.
 */

/** The most vertices one traced shape may carry. A cap rather than a guess: a
 * runaway pointer can otherwise write thousands of points into a row nothing
 * downstream can render. */
export const MAX_VERTICES = 500;

/** Length of an open polyline, in page-width units. */
export function polylineLength(xs: number[], ys: number[]): number {
  let total = 0;
  for (let i = 1; i < xs.length; i += 1) {
    total += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  return total;
}

/** Do segments `a`-`b` and `c`-`d` properly cross? Shared endpoints do not
 * count: consecutive edges of a ring always touch. */
function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => {
    const value = (qx - px) * (ry - py) - (qy - py) * (rx - px);
    if (Math.abs(value) < 1e-12) return 0;
    return value > 0 ? 1 : -1;
  };
  const d1 = side(ax, ay, bx, by, cx, cy);
  const d2 = side(ax, ay, bx, by, dx, dy);
  const d3 = side(cx, cy, dx, dy, ax, ay);
  const d4 = side(cx, cy, dx, dy, bx, by);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

/** Does the closed ring cross itself? */
export function ringSelfIntersects(xs: number[], ys: number[]): boolean {
  const n = xs.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    const i2 = (i + 1) % n;
    for (let j = i + 1; j < n; j += 1) {
      const j2 = (j + 1) % n;
      if (i === j || i2 === j || j2 === i) continue;
      if (segmentsCross(xs[i], ys[i], xs[i2], ys[i2], xs[j], ys[j], xs[j2], ys[j2])) return true;
    }
  }
  return false;
}

/**
 * Area of a closed ring in page-width units squared, or null if the ring
 * crosses itself.
 *
 * THE REFUSAL IS THE POINT. The shoelace formula happily returns a number for
 * a bowtie — the two lobes partly cancel — and that number is plausible,
 * smaller than either lobe, and wrong. A figure that looks reasonable and is
 * wrong is the failure mode this whole module is built against, so a ring that
 * crosses itself gets no area at all and the screen says to redraw it.
 */
export function ringArea(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  if (ringSelfIntersects(xs, ys)) return null;
  let twice = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const j = (i + 1) % xs.length;
    twice += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return Math.abs(twice) / 2;
}

/** Is this a point the page-width box can hold? `x` spans 0..1; `y` spans
 * 0..H/W, so its ceiling depends on the sheet and the widest paper in normal
 * use is wider than it is tall. 2 is a sanity bound, not a page bound — the
 * page's real height is what a caller checks when it has one. */
export function pointInSheet(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 2;
}
