/**
 * ── A CANVAS HAS A MAXIMUM SIZE, AND PAST IT THE PAGE GOES BLACK ──
 *
 * Every browser caps a canvas's backing store, by side and by total area.
 * Over the cap the canvas does NOT throw: it allocates nothing, the render
 * writes into nowhere, and what you get is a black or half-drawn page with no
 * error anywhere. Chrome, Safari and Firefox all behave this way and all pick
 * different limits.
 *
 * The takeoff viewer hit it as soon as anyone zoomed past Fit to look at a
 * line. An ARCH-D sheet is 2,592 x 1,728 pt; at `BASE_SCALE` 1.5, 4x zoom and
 * a retina `devicePixelRatio` of 2 that asks for 31,104 x 20,736 — 645 million
 * pixels, about 2.4 GB of RGBA, and roughly twice the longest side any
 * browser allows. Zooming in to inspect a wall is the one thing a reviewer
 * does constantly, so this fired for every customer on every sheet.
 *
 * ── WHAT IT GIVES UP, AND WHY THAT IS THE RIGHT TRADE ──
 *
 * The CSS size is what the user asked for and is never reduced, so the zoom
 * level, the scroll position and every coordinate the overlay computes stay
 * exactly as they were. What shrinks is the BACKING STORE: past the limit the
 * page is rendered at a lower pixel density and stretched to fit. The drawing
 * gets softer at extreme zoom and it is still there, which beats sharp and
 * black.
 *
 * Pure. No DOM, no React — so the limits can be tested without a browser.
 */

/**
 * The longest side any mainstream browser allows, in device pixels.
 *
 * Chrome and Firefox allow 32,767 on desktop; Safari allows 16,384 and iOS
 * Safari less again. 16,384 is the smallest of the desktop numbers and is the
 * one to honour, because a limit that works on three browsers out of four is
 * a bug report from the fourth.
 */
export const MAX_CANVAS_SIDE = 16_384;

/**
 * The most device pixels in total.
 *
 * Side limits are not the binding ones in practice — area is. Safari starts
 * refusing around 2^24 device pixels on iOS and comfortably allows 2^26 on a
 * Mac; 64 megapixels is 2^26 and holds on every desktop browser, at 256 MB of
 * RGBA for the backing store.
 */
export const MAX_CANVAS_AREA = 64_000_000;

export type CanvasPlan = {
  /** Backing store, in device pixels. */
  canvasWidth: number;
  canvasHeight: number;
  /** What the page occupies on screen, in CSS pixels. Never reduced. */
  cssWidth: number;
  cssHeight: number;
  /** The scale to hand pdf.js, which is the CSS scale times the density. */
  renderScale: number;
  /** Device pixels per CSS pixel after clamping — 2 on retina, less when the
   *  page is too big to draw at that density. */
  density: number;
  /** True when the density was reduced, so the UI can say the view is soft
   *  rather than leaving somebody wondering. */
  reduced: boolean;
};

/**
 * Sizes the canvas for one page at one zoom, within what a browser will draw.
 */
export function canvasPlan(input: {
  /** The page at scale 1, in PDF points. */
  pageWidth: number;
  pageHeight: number;
  /** `BASE_SCALE * zoomFactor` — CSS pixels per PDF point. */
  scale: number;
  /** `window.devicePixelRatio`, already capped by the caller if it wants. */
  devicePixelRatio: number;
}): CanvasPlan {
  const cssWidth = Math.max(1, Math.round(input.pageWidth * input.scale));
  const cssHeight = Math.max(1, Math.round(input.pageHeight * input.scale));
  const wanted = Math.max(0.1, input.devicePixelRatio);

  // The three limits, each as the largest density that satisfies it.
  const bySide = Math.min(MAX_CANVAS_SIDE / cssWidth, MAX_CANVAS_SIDE / cssHeight);
  const byArea = Math.sqrt(MAX_CANVAS_AREA / (cssWidth * cssHeight));
  // ── THE CAP WINS OVER ANY FLOOR, BECAUSE IT IS PHYSICAL ──
  //
  // The first version clamped density to a minimum of 0.25 "so a huge sheet
  // still draws something". Its own test caught that: at 12x zoom the floor
  // put the canvas back over the area limit — 90 megapixels against a budget
  // of 64 — which is the black page this file exists to stop, reintroduced by
  // the guard against it. A quality floor cannot override a hardware limit.
  // The only floor left is the one that keeps the number positive.
  const density = Math.max(0.001, Math.min(wanted, bySide, byArea));

  return {
    // FLOOR, not round: rounding a side up puts the area back over the cap by
    // a few hundred pixels, which is just as unallocatable as a few million.
    canvasWidth: Math.max(1, Math.floor(cssWidth * density)),
    canvasHeight: Math.max(1, Math.floor(cssHeight * density)),
    cssWidth,
    cssHeight,
    renderScale: input.scale * density,
    density,
    reduced: density < wanted - 1e-9,
  };
}
