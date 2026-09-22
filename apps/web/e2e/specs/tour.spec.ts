import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";

/**
 * Help → "Walk me through this page" (WalkthroughTour.tsx). Precisely the
 * class of bug a DOM-only test cannot see — #324 shipped a positioning
 * bug here that only a real browser found (CLAUDE.md's engine.ts
 * placeCard clamp). Each browser context starts with empty localStorage,
 * so this is always the first time MAIN's browser has seen this page's
 * tour ("...again" only appears on a repeat).
 */
test("the page tour opens on screen, Next advances, Esc closes", async ({ page }) => {
  await signInAs(page, PERSONAS.main.email);
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();

  await page.getByRole("button", { name: "Walk me through this page" }).click();

  // Clicking "Walk me through this page" closes the Help dialog
  // (HelpButton.tsx's startTour calls setIsOpen(false) first), so this is
  // the only dialog on screen. aria-modal="false" is WalkthroughTour's own
  // marker — a spotlight overlay that lets clicks through, not a true
  // modal — and distinguishes it from the Help dialog's role="dialog".
  const tour = page.locator('[role="dialog"][aria-modal="false"]');
  await expect(tour).toBeVisible();
  await expect(tour.getByText(/^Step 1 of \d+ ·/)).toBeVisible();

  const firstStepTitle = await tour.locator('[id^="walkthrough-title-"]').innerText();

  const box = await tour.boundingBox();
  expect(box, "tour card must report a bounding box").not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

  await tour.getByRole("button", { name: "Next", exact: true }).click();

  await expect(tour.getByText(/^Step 2 of \d+ ·/)).toBeVisible();
  const secondStepTitle = await tour.locator('[id^="walkthrough-title-"]').innerText();
  expect(secondStepTitle).not.toBe(firstStepTitle);

  await page.keyboard.press("Escape");
  await expect(page.locator('[role="dialog"][aria-modal="false"]')).toHaveCount(0);
});
