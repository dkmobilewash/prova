import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { E2E_TAG } from "../lib/seedDatabase";
import { expectFitsTheViewport } from "../lib/viewport";

/** Rows readable at 375px, no sideways scroll — the row-stacking pattern
 * (flex-col below sm, sm:flex-row above) CLAUDE.md's phone-width entries
 * describe, checked the only way it can be: a real Chromium viewport. */
test("schedule rows are readable at 375px with no sideways scroll", async ({ page }) => {
  await signInAs(page, PERSONAS.main.email);
  await page.goto("/schedule");

  await expect(page.getByText(`${E2E_TAG} Seeded Job`)).toBeVisible();

  // Both width questions now, not just the sideways-scroll one — see
  // lib/viewport.ts for what the second one catches and why nothing here
  // was asking it.
  await expectFitsTheViewport(page, "/schedule");
});
