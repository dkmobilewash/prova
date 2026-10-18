import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { E2E_TAG } from "../lib/seedDatabase";

/** /schedule renders the seeded job as a readable row (list-based, not a
 * table — see apps/web/app/(app)/schedule/page.tsx). */
test("schedule shows the seeded job", async ({ page }) => {
  await signInAs(page, PERSONAS.main.email);
  // ?all=1: since declutter round 3 the start-date and Unscheduled lists show
  // 5 each (newest first), and the seeded job is the OLDEST one on the account.
  await page.goto("/schedule?all=1");

  await expect(page.getByText(`${E2E_TAG} Seeded Job`)).toBeVisible();
});
