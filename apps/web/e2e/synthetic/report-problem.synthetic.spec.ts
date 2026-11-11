import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";

/**
 * ── "REPORT A PROBLEM", AGAINST A DEPLOYED PREVIEW ──
 *
 * Sends ONE real report to the support address, so it runs only when asked
 * (REPORT_PROBLEM_WALK=1) and never in the daily synthetic check. A preview has
 * the email settings CI's server does not, so this is the only place the whole
 * path (picture, mail, /messages row) runs for real. It uses a ZZ-SYNTH job the
 * synthetic check already made, so nothing new is uploaded.
 */
test.skip(process.env.REPORT_PROBLEM_WALK !== "1", "sends a real email to support; set REPORT_PROBLEM_WALK=1");

test("report a problem from the takeoff workspace, and the estimate offers it too", async ({ page }) => {
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.takeoff.email);
  await page.goto("/jobs?q=ZZ-SYNTH");
  const job = page.locator('a[href^="/jobs/"]').filter({ hasText: "ZZ-SYNTH" }).first();
  await expect(job, "no ZZ-SYNTH job on this company: run the synthetic check once first").toBeVisible({ timeout: 60_000 });
  const jobId = (await job.getAttribute("href"))!.split("/")[2]!;

  await page.goto(`/takeoff/${jobId}`);
  await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 120_000 });
  const canvas = page.locator('[data-testid="takeoff-plan-port"] canvas');
  await expect.poll(() => canvas.evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 120_000 }).toBeGreaterThan(0);
  await page.locator('[data-report="open"]').click();
  const panel = page.locator('[data-report="panel"]');
  await expect(panel.locator('[data-report="what"]')).toContainText("a picture of the plan view");
  await panel.locator('[data-report="message"]').fill("ZZ-TEST: a report sent by the report-problem walk. Please ignore.");
  await panel.locator('[data-report="send"]').click();
  await expect(panel.locator('[data-report="sent"]')).toHaveText("Sent. We'll look at it.", { timeout: 60_000 });

  // The report is a row on /messages like any other mail, so the sub can see it went.
  await page.goto("/messages");
  await expectHealthy(page, "messages", { monitor });
  await expect(page.getByText(/Problem report — .* — \/takeoff\//).first()).toBeVisible({ timeout: 30_000 });

  await page.goto(`/jobs/${jobId}/estimate`);
  await expectHealthy(page, "estimate", { monitor });
  await page.locator('[data-report="open"]').click();
  await expect(page.locator('[data-report="what"]')).not.toContainText("plan view");
  expect(monitor.crashes).toEqual([]);
});
