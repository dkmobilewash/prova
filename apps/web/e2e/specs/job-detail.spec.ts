import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { E2E_TAG } from "../lib/seedDatabase";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { jobTab } from "../lib/journey";

/**
 * A job's pages: every tab renders its own sections, and none crashes.
 *
 * Navigates in via /schedule rather than a hardcoded id, since the MAIN
 * persona's seeded job's cuid is not known to this spec (seedDatabase.ts
 * creates it, but specs run in a separate process from global setup and
 * don't get its return value back) — clicking the real link is also closer
 * to how a user actually gets there.
 *
 * REWRITTEN 2026-09-21 because it asserted a page that no longer exists.
 * This spec was written against the single long job page, and it looked
 * for "Job costing & WIP", "Line items (estimate)", "Daily field reports"
 * and "Pay applications" on one screen, plus a text-order check that
 * Retainage came before Field reports before Pay apps. The job page has
 * since been split into tabs ((tabs)/layout.tsx), so every one of those
 * headings lives on a different URL and the order check had nothing to
 * order. It failed on the first missing heading and checked nothing after
 * that point.
 *
 * The coverage is kept, not dropped: each heading is asserted on the tab
 * that renders it now. The old "fixed slots" order (CLAUDE.md, about the
 * monolith) survives in the only form it still has, the ORDER OF THE TAB
 * RAIL: Billing (which holds Pay applications), then Retainage, then Field
 * reports.
 *
 * MAIN's seeded job is IN_PROGRESS, not ESTIMATE, and MAIN is the OWNER,
 * so every tab the layout can offer is on the rail. The Estimate tab then
 * shows Change orders where an ESTIMATE-stage job shows "Line items
 * (estimate)" ((tabs)/estimate/page.tsx, the `isEstimateStage` branch).
 * The spec asserts that swap happened, so a regression in either direction
 * is caught, and this is not a heading that just went missing.
 */
test("job detail: every tab renders its sections, in the rail's order, no crash", async ({ page }) => {
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.main.email);
  await page.goto("/schedule");

  await page.getByRole("link", { name: new RegExp(`${E2E_TAG} Seeded Job`) }).first().click();
  await page.waitForURL(/\/jobs\/[^/]+$/);
  const jobPath = new URL(page.url()).pathname;

  // Overview — the tab the job link lands on.
  await expectHealthy(page, "job overview", { monitor });
  for (const heading of ["Job details", "Job status", "Schedule"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }

  // The rail, in order. This is where the old Retainage -> Field reports
  // -> Pay apps ordering now lives: Pay applications moved onto Billing.
  const rail = page.getByRole("navigation", { name: "Job sections" }).getByRole("link");
  await expect(rail).toHaveText([
    "Overview",
    "Estimate",
    "Takeoff",
    "Crew & time",
    "Compliance",
    "Billing",
    "Retainage",
    "Field reports",
    "Photos",
  ]);

  const tabs: Array<{ label: string; path: string; headings: string[]; absent?: string[] }> = [
    {
      label: "Estimate",
      path: `${jobPath}/estimate`,
      headings: ["Job costing & WIP", "Change orders"],
      absent: ["Line items (estimate)"],
    },
    // #476 added this tab and nothing updated the two lists below it, so the
    // rail assertion failed on an extra entry that was supposed to be there.
    // Walking it as well as naming it is the point: a tab in the rail that
    // nobody opens is exactly the shape this spec exists to catch.
    { label: "Takeoff", path: `${jobPath}/takeoff`, headings: ["Takeoff"] },
    { label: "Crew & time", path: `${jobPath}/crew`, headings: ["Field time entries"] },
    { label: "Compliance", path: `${jobPath}/compliance`, headings: ["Prevailing wage determination"] },
    { label: "Billing", path: `${jobPath}/billing`, headings: ["Invoices", "Pay applications"] },
    { label: "Retainage", path: `${jobPath}/retainage`, headings: ["Retainage"] },
    { label: "Field reports", path: `${jobPath}/field-reports`, headings: ["Daily field reports"] },
    { label: "Photos", path: `${jobPath}/photos`, headings: ["Site photos"] },
  ];

  for (const tab of tabs) {
    await jobTab(page, tab.label).click();
    await page.waitForURL(new RegExp(`${tab.path}(\\?|$)`));
    await expectHealthy(page, `job tab: ${tab.label}`, { monitor });
    await expect(jobTab(page, tab.label)).toHaveAttribute("aria-current", "page");

    for (const heading of tab.headings) {
      await expect(page.getByRole("heading", { name: heading, exact: true }), `${tab.label} shows "${heading}"`).toBeVisible();
    }
    for (const heading of tab.absent ?? []) {
      await expect(page.getByRole("heading", { name: heading, exact: true }), `${tab.label} does not show "${heading}"`).toHaveCount(0);
    }
  }
});
