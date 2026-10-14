import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { E2E_TAG } from "../lib/seedDatabase";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { jobStageNav, jobTab, openJobTab } from "../lib/journey";

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
 * shows change orders where an ESTIMATE-stage job shows "Line items
 * (estimate)" ((tabs)/estimate/page.tsx, the `isEstimateStage` branch).
 * The spec asserts that swap happened, so a regression in either direction
 * is caught, and this is not a heading that just went missing.
 */
test("job detail: every tab renders its sections, in the rail's order, no crash", async ({ page }) => {
  // Eight tabs behind four stage boxes is up to twelve navigations, each
  // one a server render; main's 4s was for eight clicks on a rail that was
  // always on screen. Room for a slow runner, not a licence for a slow app.
  test.setTimeout(90_000);
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

  // Where the rail's order now lives (Concept G, 2026-10-10): five stage
  // boxes, in lifecycle order, each opening a row of the pages it files
  // (components/job/jobStages.ts). The old Retainage -> Field reports ->
  // Pay apps ordering survives as Billing's row holding Billing and
  // Retainage, after Crew's row holds Field reports.
  const boxes = jobStageNav(page).locator("li[data-stage]");
  await expect(boxes).toHaveCount(5);
  expect(await boxes.evaluateAll((items) => items.map((item) => item.getAttribute("data-stage")))).toEqual([
    "estimate",
    "contract",
    "crew",
    "billing",
    "closeout",
  ]);

  // MAIN's seeded job is IN_PROGRESS and MAIN is the OWNER, so every page a
  // job has is on offer. Grouped by stage so each stage is opened once; the
  // Estimate page of a job that has left ESTIMATE is filed under Contract
  // as "Change orders". The Billing register's heading is one bill noun per
  // company (billingNoun in components/job/jobStages.ts): the seeded
  // company has not answered the pay-apps question, so it reads "Pay apps".
  const tabs: Array<{ label: string; path: string; headings: string[]; absent?: string[]; buttons?: string[] }> = [
    { label: "Takeoff", path: `${jobPath}/takeoff`, headings: ["Takeoff"] },
    {
      // THE TAB IS "Estimate" AT EVERY STAGE NOW (#757). It was "Change
      // orders" once a job left ESTIMATE, and filing it under Contract by that
      // name hid the estimate tools on a running job — the restore brief's own
      // words. The PAGE is unchanged: on an IN_PROGRESS job it still leads with
      // job costing and the change orders, and still has no estimate line-item
      // editor, which is what the headings below check.
      label: "Estimate",
      path: `${jobPath}/estimate`,
      headings: ["Job costing & WIP", "Change orders"],
      absent: ["Line items (estimate)"],
    },
    { label: "Compliance", path: `${jobPath}/compliance`, headings: ["Prevailing wage determination"] },
    { label: "Crew & time", path: `${jobPath}/crew`, headings: ["Field time entries"] },
    { label: "Field reports", path: `${jobPath}/field-reports`, headings: ["Daily field reports"] },
    { label: "Photos", path: `${jobPath}/photos`, headings: ["Site photos"] },
    // ONE list since declutter round 2: the "Pay applications" section was a
    // second copy of the pay apps already listed as rows under "Pay apps", so
    // its heading is gone. What it uniquely carried — starting a pay app — is
    // the button, which is what is checked in its place.
    { label: "Billing", path: `${jobPath}/billing`, headings: ["Pay apps"], buttons: ["Submit pay application"] },
    { label: "Retainage", path: `${jobPath}/retainage`, headings: ["Retainage"] },
  ];

  for (const tab of tabs) {
    await openJobTab(page, tab.label);
    // `#`: the Change orders tab lands at its section (`/estimate#change-orders`).
    await page.waitForURL(new RegExp(`${tab.path}(\\?|#|$)`));
    await expectHealthy(page, `job tab: ${tab.label}`, { monitor });
    await expect(jobTab(page, tab.label)).toHaveAttribute("aria-current", "page");

    for (const heading of tab.headings) {
      await expect(page.getByRole("heading", { name: heading, exact: true }), `${tab.label} shows "${heading}"`).toBeVisible();
    }
    for (const button of tab.buttons ?? []) {
      await expect(page.getByRole("button", { name: button, exact: true }), `${tab.label} offers "${button}"`).toBeVisible();
    }
    for (const heading of tab.absent ?? []) {
      await expect(page.getByRole("heading", { name: heading, exact: true }), `${tab.label} does not show "${heading}"`).toHaveCount(0);
    }
  }
});
