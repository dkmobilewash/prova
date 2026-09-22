import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { dataTour } from "../lib/dataTour";

/**
 * Dashboard on a brand-new, genuinely empty company (the EMPTY persona —
 * see lib/personas.ts; its company exists only because this spec's first
 * sign-in triggers apps/web/lib/auth.ts's adoptCompanyContext, the exact
 * path a real new customer hits). Nothing here mutates EMPTY's data, so
 * this spec can run in any order relative to the other specs that read
 * the same persona (contacts/punch-lists/field-reports empty states).
 */
test.describe("dashboard, brand-new empty company", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, PERSONAS.empty.email);
  });

  test("shows the Getting started card and its jobs-empty state", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Getting started progress" })).toBeVisible();

    const empty = page.locator(dataTour("dashboard-jobs-empty"));
    await expect(empty).toContainText("No jobs yet");
    await expect(empty.getByRole("link", { name: "Start your first job" })).toHaveAttribute("href", "/jobs/new");
    // Nothing has anything to say before the first job, so none of it shows.
    await expect(page.getByText("Needs attention")).toHaveCount(0);
    await expect(page.getByText("Browse all jobs")).toHaveCount(0);
  });

  test("every Getting started step link resolves to a real page", async ({ page }) => {
    await page.goto("/dashboard");

    const steps: Array<{ id: string; href: string }> = [
      { id: "name-company", href: "/settings" },
      { id: "first-job", href: "/jobs/new" },
      { id: "crew", href: "/team" },
      { id: "schedule", href: "/schedule" },
      { id: "first-day", href: "/field-reports" },
    ];

    for (const step of steps) {
      const item = page.locator(`[data-step="${step.id}"]`);
      // Optional steps (import, quickbooks) may be filtered out for this
      // viewer; only assert the href on steps actually present.
      if ((await item.count()) === 0) continue;
      await expect(item.locator("a")).toHaveAttribute("href", step.href);

      await page.goto(step.href);
      // A page that crashed renders the app's own error boundary rather
      // than 404ing — either is a real failure, so both are ruled out.
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("404");

      await page.goto("/dashboard");
    }
  });
});
