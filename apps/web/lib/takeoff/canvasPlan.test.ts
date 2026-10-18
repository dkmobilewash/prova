import { describe, expect, it } from "vitest";
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, canvasPlan } from "./canvasPlan";

/**
 * The zoom that turned the plan black.
 *
 * Every case here is an ARCH-D sheet — 2,592 x 1,728 pt, which is what Camp
 * Bow Wow A101 is — because that is the size the bug was reported on, and the
 * numbers below are the ones a reviewer actually produced by pressing + a few
 * times.
 */
const ARCH_D = { pageWidth: 2592, pageHeight: 1728 };
const BASE_SCALE = 1.5;

const at = (zoom: number, devicePixelRatio = 2) =>
  canvasPlan({ ...ARCH_D, scale: BASE_SCALE * zoom, devicePixelRatio });

describe("sizing the page canvas", () => {
  it("leaves an ordinary zoom completely alone", () => {
    const plan = at(1);
    expect(plan.density).toBe(2);
    expect(plan.reduced).toBe(false);
    expect(plan.canvasWidth).toBe(2592 * 1.5 * 2);
    expect(plan.renderScale).toBe(1.5 * 2);
  });

  it("NEVER EXCEEDS WHAT A BROWSER WILL DRAW, at any zoom", () => {
    // The whole point: past the cap a canvas allocates nothing and the render
    // writes into nowhere, with no error. 20x is well past anything the UI
    // offers and the guarantee has to hold there too.
    for (const zoom of [0.5, 1, 2, 3, 4, 6, 8, 12, 20]) {
      const plan = at(zoom);
      expect(plan.canvasWidth, `width at ${zoom}x`).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
      expect(plan.canvasHeight, `height at ${zoom}x`).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
      expect(
        plan.canvasWidth * plan.canvasHeight,
        `area at ${zoom}x`,
      ).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    }
  });

  it("THE REPORTED CASE: 4x on a retina screen used to ask for 645 megapixels", () => {
    // 2592 * 1.5 * 4 * 2 = 31,104 wide. Nearly twice the longest side Safari
    // allows, and 645 Mpx against a 64 Mpx budget.
    const naive = 2592 * BASE_SCALE * 4 * 2 * (1728 * BASE_SCALE * 4 * 2);
    expect(naive).toBeGreaterThan(600_000_000);

    const plan = at(4);
    expect(plan.reduced).toBe(true);
    expect(plan.canvasWidth * plan.canvasHeight).toBeLessThanOrEqual(MAX_CANVAS_AREA);
  });

  it("keeps the CSS size exactly as asked, so zoom and coordinates do not move", () => {
    // The overlay, the scroll position and every click-to-model conversion
    // are in CSS pixels. Shrinking those to fit the cap would silently move
    // every wall the reviewer has drawn.
    for (const zoom of [1, 4, 12]) {
      const plan = at(zoom);
      expect(plan.cssWidth, `css width at ${zoom}x`).toBe(Math.round(2592 * BASE_SCALE * zoom));
      expect(plan.cssHeight, `css height at ${zoom}x`).toBe(Math.round(1728 * BASE_SCALE * zoom));
    }
  });

  it("spends the whole budget rather than giving up early", () => {
    // A cap that over-shrinks is its own bug: the page would be legible and
    // is not. At the first zoom that needs clamping the canvas should still
    // be close to the limit.
    const plan = at(4);
    const area = plan.canvasWidth * plan.canvasHeight;
    expect(area).toBeGreaterThan(MAX_CANVAS_AREA * 0.9);
  });

  it("renders at the density it sized for", () => {
    // renderScale and the canvas must agree, or pdf.js draws the page at one
    // size into a bitmap of another and the result is the clipped page this
    // fix exists to stop.
    for (const zoom of [1, 4, 12]) {
      const plan = at(zoom);
      expect(Math.floor(ARCH_D.pageWidth * plan.renderScale)).toBe(plan.canvasWidth);
      expect(Math.floor(ARCH_D.pageHeight * plan.renderScale)).toBe(plan.canvasHeight);
    }
  });

  it("STILL OBEYS THE CAP ON an absurd sheet, rather than holding a quality floor", () => {
    // The first version floored density at 0.25 so a huge sheet "still draws
    // something". That put a 12x ARCH-D back over the area limit, which is
    // the black page this whole file exists to stop. The cap is hardware; a
    // floor is a preference, and the preference loses.
    const plan = canvasPlan({
      pageWidth: 10_000,
      pageHeight: 10_000,
      scale: 20,
      devicePixelRatio: 2,
    });
    expect(plan.density).toBeLessThan(0.25);
    expect(plan.canvasWidth * plan.canvasHeight).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(plan.canvasWidth).toBeGreaterThan(0);
    expect(plan.canvasHeight).toBeGreaterThan(0);
  });

  it("does not invent density on a screen that has none", () => {
    expect(at(1, 1).density).toBe(1);
    expect(at(1, 1).reduced).toBe(false);
  });
});
