import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { E2E_TAG } from "../lib/seedDatabase";

/** Rows readable at 375px, no sideways scroll — the row-stacking pattern
 * (flex-col below sm, sm:flex-row above) CLAUDE.md's phone-width entries
 * describe, checked the only way it can be: a real Chromium viewport. */
test("schedule rows are readable at 375px with no sideways scroll", async ({ page }) => {
  await signInAs(page, PERSONAS.main.email);
  await page.goto("/schedule");

  await expect(page.getByText(`${E2E_TAG} Seeded Job`)).toBeVisible();

  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
});
