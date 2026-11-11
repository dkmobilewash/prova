import path from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { dataTour } from "../lib/dataTour";

/**
 * ── "TRY IT ON A SAMPLE SET": THE WHOLE FLOW BEFORE YOUR OWN PLANS ──
 *
 * A brand-new company picks its trade and is offered a sample job on an invented
 * drawing (`lib/sample-job`). Pressed, it lands on a job already taken off: the
 * sheet draws (from the `sample:` scheme, the deployment's own file), the queue has
 * walls left to confirm, the estimate has lines, the proposal has a schedule of
 * values. It is labelled Sample everywhere, kept out of the work being priced, and
 * deleted in one press. Nothing is stubbed or seeded: the server builds it with the
 * same steps a pilot's job goes through.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/sample-job");
const NAME = "Sample — Professional office suite";

test.describe("the sample job", () => {
  test.setTimeout(180_000);
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. after the trade pick, the sample is offered; pressed, it opens a job already taken off", async () => {
    await signInAs(page, PERSONAS.sampleJob.email);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "What's your trade?" })).toBeVisible({ timeout: 60_000 });
    await page.locator('[data-setup="trades"]').getByRole("button", { name: /Framing and drywall/ }).click();
    const offer = page.locator('[data-setup="sample"]');
    await expect(offer.getByRole("heading", { name: "See it work first?" })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "01-offer.png") });
    await page.locator('[data-setup="try-sample"]').click();
    await page.waitForURL(/\/jobs\/[^/?#]+$/, { timeout: 90_000 });
    jobId = new URL(page.url()).pathname.split("/").pop()!;
    await expectHealthy(page, "the sample job", { monitor });
    await expect(page.getByRole("heading", { level: 1, name: NAME }).first()).toBeVisible();
    await expect(page.locator('[data-job="sample-banner"] [data-job="sample-label"]')).toHaveText("Sample");
    // Plans, scale and takeoff are done before the person has done anything.
    for (const step of ["plans", "scale", "takeoff"]) {
      await expect(page.locator(`[data-job-step="${step}"]`), `${step} is not done on the sample`).toHaveAttribute("data-state", "done");
    }
    await page.screenshot({ path: path.join(SHOTS, "02-sample-job.png"), fullPage: true });
  });

  test("2. the sheet draws in the workspace, and the queue has walls left to confirm", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    // The viewer reads the sample: scheme: a canvas with no width is a drawing that never arrived.
    const canvas = page.locator('[data-testid="takeoff-plan-port"] canvas');
    await expect.poll(() => canvas.evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 60_000, message: "the sample sheet never drew" }).toBeGreaterThan(0);
    const queue = page.locator('[data-takeoff="review-queue"]');
    await expect(queue).toBeVisible({ timeout: 60_000 });
    await expect(queue.locator('[data-takeoff="queue-group"]').first()).toBeVisible({ timeout: 30_000 });
    await expectHealthy(page, "the sample's review queue", { monitor, signedIn: false });
    await page.screenshot({ path: path.join(SHOTS, "03-queue.png") });
  });

  test("3. the estimate has lines and the proposal has a schedule of values", async () => {
    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "the sample's estimate", { monitor });
    await expect(page.locator(`${dataTour("job-line-items")} [id^="line-"]`).first()).toBeVisible({ timeout: 30_000 });
    await page.goto(`/jobs/${jobId}/proposal`);
    await expectHealthy(page, "the sample's proposal", { monitor });
    await expect(page.getByRole("heading", { name: "Schedule of values" })).toBeVisible();
    await expect(page.getByText("This job has no line items yet.")).toHaveCount(0);
  });

  test("4. the jobs list labels it and does not count it as work being priced", async () => {
    await page.goto("/jobs");
    await expectHealthy(page, "jobs", { monitor });
    const row = page.locator("li").filter({ hasText: NAME });
    await expect(row.locator('[data-job="sample-label"]')).toHaveText("Sample");
    await expect(page.getByText(/still being priced/)).toHaveCount(0);
  });

  test("5. deleted in one press: gone from the jobs list", async () => {
    await page.goto(`/jobs/${jobId}`);
    const banner = page.locator('[data-job="sample-banner"]');
    await banner.getByRole("button", { name: "Delete", exact: true }).click();
    await banner.getByRole("button", { name: "Confirm delete" }).click();
    await page.waitForURL(/\/jobs$/, { timeout: 30_000 });
    await expect(page.locator("li").filter({ hasText: NAME })).toHaveCount(0);
  });

  test("6. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
