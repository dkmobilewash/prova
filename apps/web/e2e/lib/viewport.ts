import { expect, type Page } from "@playwright/test";

/**
 * THE TWO WIDTH QUESTIONS THAT ARE NOT THE SAME QUESTION, and the reason
 * this repo had only ever asked one of them.
 *
 *   `scrollWidth <= innerWidth` asks whether the page scrolls sideways
 *   INSIDE its layout viewport. It is the check `pilot.mobile.spec.ts` and
 *   `schedule.mobile.spec.ts` were written with, and it is a real check.
 *
 *   `innerWidth === the declared viewport` asks whether the layout viewport
 *   IS the phone. It can legitimately be wider: one unbreakable word at a
 *   large enough font sets a minimum content width the screen cannot hold,
 *   the browser widens the layout viewport to fit it, and the page then
 *   pans sideways on the device while `scrollWidth === innerWidth` stays
 *   perfectly true.
 *
 * Measured, not argued. On 2026-09-21 the landing page at a 320px device
 * reported `window.innerWidth` 342 — isolated to the hero `<h1>` by hiding
 * it and watching 342 become 320, with `/pilot` and `/terms` tracking the
 * device width in the same run. The first check passed throughout.
 *
 * ONE HELPER IN ONE FILE, used by the Clerk-backed mobile specs and by the
 * public suite, so the two can never drift into asking different things
 * about the same product.
 */
export async function expectFitsTheViewport(page: Page, where: string): Promise<void> {
  const declared = page.viewportSize();
  expect(declared, `${where}: no viewport size declared — a width with no viewport is unreproducible`).not.toBeNull();

  const measured = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement!.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  expect(
    measured.innerWidth,
    `${where}: the LAYOUT VIEWPORT is ${measured.innerWidth}px on a ${declared!.width}px screen — ` +
      "something on this page cannot be made narrower than that, so the whole page pans sideways. " +
      "Find it by hiding elements until innerWidth drops to the device width.",
  ).toBe(declared!.width);

  expect(
    measured.scrollWidth,
    `${where}: scrollWidth ${measured.scrollWidth} > innerWidth ${measured.innerWidth} — the page scrolls sideways`,
  ).toBeLessThanOrEqual(measured.innerWidth);
}
