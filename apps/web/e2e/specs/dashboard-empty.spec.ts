import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { dataTour } from "../lib/dataTour";
import { landOnDashboard } from "../lib/journey";
import { HealthMonitor } from "../lib/health";

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
    // NOT a bare goto("/dashboard"). EMPTY is gated, on purpose:
    // `seedDatabase.ts` deliberately leaves `businessScopeAskedAt` unset on
    // this persona — "they are meant to be brand new, so they get the gate a
    // real new customer gets" — and `/dashboard` is the ONE route that
    // redirects (lib/onboarding-gate.ts). So this spec was asserting against
    // /welcome and could only fail, which is why the sibling empty-state
    // specs on the same persona (contacts, punch-lists, field-reports) pass:
    // none of them goes to /dashboard.
    //
    // #447 Cause A called this and prescribed the fix — lift what the
    // journey already does into the specs that need it, rather than each one
    // re-learning the gate exists.
    await landOnDashboard(page, new HealthMonitor(page));

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
      // THE STEP LINKS TO ITS OWN PAGE — asserted as "a link with this href is
      // in this step", not as "this step's only link has this href".
      //
      // It was the second form, and #413 (21 Sep) broke it four days before
      // anybody ran it: `GettingStartedCard` renders a SECOND link inside the
      // same `<li data-step>`, the "Ask C Stream" prompt pointing at /ask. So
      // `item.locator("a")` resolved to two elements and Playwright refused the
      // assertion — a strict-mode violation, which reads as a failing step and
      // is really an ambiguous selector. Nothing about the product is wrong
      // here; the step does link where it says.
      await expect(
        item.locator(`a[href="${step.href}"]`),
        `the "${step.id}" step should offer a link to ${step.href}`,
      ).toHaveCount(1);

      await page.goto(step.href);
      // A page that crashed renders the app's own error boundary rather
      // than 404ing — either is a real failure, so both are ruled out.
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("404");

      await page.goto("/dashboard");
    }
  });
});
