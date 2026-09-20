import { test, expect } from "@playwright/test";

/**
 * The bug class this whole suite exists for: happy-dom does no layout, so
 * "no horizontal scroll at 375px" is unverifiable anywhere else in this
 * repo. Exact check the task specifies:
 * document.scrollingElement.scrollWidth <= innerWidth.
 */
test("/pilot has no horizontal scroll at 375px", async ({ page }) => {
  await page.goto("/pilot");
  await expect(page.getByRole("heading", { name: "Your whole job, in one place." })).toBeVisible();

  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
});
