import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";

/**
 * The bug class item 3 names directly: the assistant's panel must be fully
 * on screen at 375px. Asserted the only way it can be — a real bounding
 * box, in a real Chromium viewport.
 *
 * Re-aimed 2026-10-11: an owner reaches the assistant on a phone from the
 * AI bottom tab (/ai) now, not the top bar's launcher, which is only drawn
 * for someone without the AI word (components/shell/TopBar.tsx). The panel
 * sits in the page flow there and may be taller than the screen, so the
 * check is horizontal — nothing hangs off either side.
 */
test("Ask panel is fully on screen at 375px", async ({ page }) => {
  await signInAs(page, PERSONAS.main.email);
  await page.goto("/dashboard");

  await page.locator('nav[aria-label="Main"] a[href="/ai"]:visible').click();
  await expect(page).toHaveURL(/\/ai$/);
  const panel = page.locator('[data-tour="ai-chat"]');
  await expect(panel).toBeVisible();

  const box = await panel.boundingBox();
  expect(box, "Ask panel must report a bounding box").not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page must not scroll sideways").toBe(0);
});
