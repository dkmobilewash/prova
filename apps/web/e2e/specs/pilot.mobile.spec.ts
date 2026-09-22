import { test, expect } from "@playwright/test";
import { expectFitsTheViewport } from "../lib/viewport";

/**
 * The bug class this whole suite exists for: happy-dom does no layout, so
 * "no horizontal scroll at 375px" is unverifiable anywhere else in this
 * repo. Exact check the task specifies:
 * document.scrollingElement.scrollWidth <= innerWidth.
 */
test("/pilot has no horizontal scroll at 375px", async ({ page }) => {
  await page.goto("/pilot");
  await expect(page.getByRole("heading", { name: "Your whole job, in one place." })).toBeVisible();

  /* `scrollWidth <= innerWidth` — the check this spec was written with,
     and still correct — is now one half of expectFitsTheViewport. The other
     half is `innerWidth === the declared viewport`, and it is not the same
     question: the landing page passed this one at every width while being
     22px wider than a 320px phone (measured 2026-09-21; see lib/viewport.ts).
     Nothing in this repo was asking it. */
  await expectFitsTheViewport(page, "/pilot");
});
