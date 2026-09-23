import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";

/**
 * The bug class item 3 names directly: "the panel opens from the topbar
 * and is fully on screen at 375px (the bug the audit found by
 * inspection)". Asserted the only way it can be — a real bounding box, in
 * a real Chromium viewport.
 */
test("Ask panel is fully on screen at 375px", async ({ page }) => {
  await signInAs(page, PERSONAS.main.email);
  await page.goto("/dashboard");

  await page.locator("[data-ask-launcher]").click();
  const panel = page.getByRole("dialog", { name: "Ask C Stream" });
  await expect(panel).toBeVisible();

  const box = await panel.boundingBox();
  expect(box, "Ask panel must report a bounding box").not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
});
