import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { E2E_TAG } from "../lib/seedDatabase";

/**
 * A job detail page: sections render, no crash. Navigates in via
 * /schedule rather than a hardcoded id, since the MAIN persona's seeded
 * job's cuid is not known to this spec (seedDatabase.ts creates it, but
 * specs run in a separate process from global setup and don't get its
 * return value back) — clicking the real link is also closer to how a
 * user actually gets there.
 */
test("job detail page: sections render, no crash", async ({ page }) => {
  await signInAs(page, PERSONAS.main.email);
  await page.goto("/schedule");

  await page.getByRole("link", { name: new RegExp(`${E2E_TAG} Seeded Job`) }).first().click();
  await page.waitForURL(/\/jobs\/[^/]+$/);

  await expect(page.getByText("Something went wrong")).toHaveCount(0);

  for (const heading of [
    "Job details",
    "Job status",
    "Schedule",
    "Job costing & WIP",
    "Line items (estimate)",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  // The fixed section slots CLAUDE.md warns carry no comment/sentinel in
  // the source — Retainage, then DailyFieldReports, then PayApplications,
  // always last. Asserting their headings exist (in any renderable form)
  // is the closest an E2E spec should get to "insert at your slot, never
  // at the end": a future edit that breaks the order breaks this
  // assertion's ordering, not just its presence.
  await expect(page.getByRole("heading", { name: "Daily field reports" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pay applications" })).toBeVisible();

  const bodyText = await page.locator("body").innerText();
  const retainageAt = bodyText.indexOf("Retainage");
  const fieldReportsAt = bodyText.indexOf("Daily field reports");
  const payAppsAt = bodyText.indexOf("Pay applications");
  expect(retainageAt).toBeGreaterThan(-1);
  expect(fieldReportsAt).toBeGreaterThan(retainageAt);
  expect(payAppsAt).toBeGreaterThan(fieldReportsAt);
});
