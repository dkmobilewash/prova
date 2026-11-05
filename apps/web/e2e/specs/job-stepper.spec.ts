import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";
import { openItems } from "../lib/finders";

/**
 * ── THE JOB STEPPER: Job → Plans → Scale → Takeoff → Review → Estimate → Send ──
 *
 * Walked on a brand-new company (NEW_JOB, which nothing seeds), one fact at a
 * time, reading the bar after each: which step is current, what its one Next
 * button says, and where it goes. Takeoff opens the full-screen workspace in a
 * new tab, and every step is a link a person can take out of order.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/job-stepper");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };

test.describe("the job stepper", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({ viewport: SIZE });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    const pdf = readFileSync(S02);
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  const bar = () => page.locator("[data-job-stepper]");
  const step = (key: string) => page.locator(`[data-job-step="${key}"]`);
  const next = () => page.locator("[data-job-next]");
  /** Every step's state, in order, as "key:state". */
  const states = () =>
    page.locator("[data-job-step]").evaluateAll((links) => links.map((a) => `${a.getAttribute("data-job-step")}:${a.getAttribute("data-state")}`).join(" "));
  async function onJob(): Promise<void> {
    await page.goto(`/jobs/${jobId}`);
    await expectHealthy(page, "job overview with the stepper", { monitor });
    await expect(bar()).toBeVisible();
  }

  test("1. a brand-new job: Job done, Plans current, and Next says upload", async () => {
    await signInAs(page, PERSONAS.newJob.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Stepper — Bungalow", gcName: "ZZ-E2E Stepper GC" });
    await finishWizard(page, monitor, jobId);
    await expect(bar(), "no stepper on a brand-new estimate").toBeVisible();
    expect(await states()).toBe("job:done plans:current scale:todo takeoff:todo review:todo estimate:todo send:todo");
    await expect(next()).toHaveText("Next: Upload the plans");
    await expect(next()).toHaveAttribute("href", `/jobs/${jobId}/takeoff#plan-set`);
    // A step says its state in words too, not only by its mark.
    await expect(step("plans")).toContainText("current step");
    await expect(step("send")).toContainText("not started");
    // SLIM: one row, well under the height of the stage boxes above it.
    expect((await bar().boundingBox())!.height).toBeLessThan(56);
    await bar().screenshot({ path: path.join(SHOTS, "stepper-new-job.png") });
    await page.screenshot({ path: path.join(SHOTS, "job-page-new-job-1440.png") });
  });

  test("2. NOT A LOCKED WIZARD: a step not reached is still a link that goes there", async () => {
    await step("send").click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}#contract-signature`));
    await expect(page.getByRole("button", { name: /Create signing link/ }), "Send goes where a job can be sent").toBeVisible();
    await expectHealthy(page, "the signing link, reached from a step not yet started", { monitor });
    await onJob();
    await step("estimate").click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/estimate`));
    await expect(bar(), "the stepper is on every tab of an estimate").toBeVisible();
  });

  test("3. Next: upload the plans, then Scale is current", async () => {
    await onJob();
    await next().click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff`));
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    await page.reload();
    expect(await states()).toBe("job:done plans:done scale:current takeoff:todo review:todo estimate:todo send:todo");
    await expect(next()).toHaveText("Next: Confirm the scales");
    // Scale lands on the plan set, in this tab (plan-set-scales.spec.ts walks it).
    await expect(next()).toHaveAttribute("href", `/jobs/${jobId}/takeoff#plan-set`);
    await next().click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff#plan-set`));
    await expect(page.locator('[data-takeoff="plan-set"]')).toBeVisible();
  });

  test("4. set the scale: Takeoff is current, and its Next opens the workspace in a NEW TAB", async () => {
    const port = page.locator('[data-testid="takeoff-plan-port"]');
    await expect.poll(() => port.locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect(port).toHaveAttribute("data-sheet-ready", "true", { timeout: 60_000 });
    await page.getByRole("button", { name: "Set scale", exact: true }).click();
    const overlay = port.locator("svg");
    await page.waitForTimeout(500);
    const box = (await overlay.boundingBox())!;
    await overlay.click({ position: { x: box.width * 0.2, y: box.width * 0.5 } });
    await overlay.click({ position: { x: box.width * 0.7, y: box.width * 0.5 } });
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await form.locator('input[name="declaredDistanceFeet"]').fill("48");
    await form.locator('input[name="pageLabel"]').fill("sheet 1");
    await form.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 30_000 });

    await onJob();
    expect(await states()).toBe("job:done plans:done scale:done takeoff:current review:todo estimate:todo send:todo");
    await expect(next()).toContainText("Next: Run the takeoff");
    await expect(next()).toHaveAttribute("target", "_blank");
    await expect(step("takeoff")).toHaveAttribute("target", "_blank");
    await bar().screenshot({ path: path.join(SHOTS, "stepper-takeoff-current.png") });

    // The Next button opens the full-screen workspace in its own tab, and this one stays.
    const [tab] = await Promise.all([page.context().waitForEvent("page"), next().click()]);
    await tab.waitForURL(new RegExp(`/takeoff/${jobId}`));
    expect(page.url(), "the job tab navigated away").toContain(`/jobs/${jobId}`);
    await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible();

    // Take something off, so the next step can be read.
    const run = tab.locator('[data-takeoff="find-walls"]');
    await expect(run).toBeEnabled({ timeout: 60_000 });
    await run.click();
    await expect(run).toHaveText(/^(Find the walls|Run takeoff)$/, { timeout: 180_000 });
    const choice = tab.locator('[data-takeoff="group-choice"]').first();
    await choice.selectOption({ index: (await choice.locator("option").allInnerTexts()).findIndex((o) => /plain measurements/i.test(o)) });
    await tab.locator('[data-takeoff="add-group"]').first().click();
    // A company with no wall types adds walls plain. They file under the
    // "Walls — untyped" item, not Unassigned (the walkthrough's step 15).
    await openItems(tab);
    await expect(tab.locator('[data-takeoff="item-row"]').filter({ hasText: "Walls — untyped" })).toBeVisible({ timeout: 30_000 });
    await tab.close();
  });

  test("5. something taken off: the walls are ALREADY on the estimate, with real feet, and Estimate stays current until they are priced", async () => {
    await onJob();
    // An unpriced footage line is not an estimate: no "Send" on a $0.00 bid.
    expect(await states()).toBe("job:done plans:done scale:done takeoff:done review:done estimate:current send:todo");
    await expect(next()).toContainText("Next: Price 1 line on the estimate");
    await expect(next()).toHaveAttribute("href", `/jobs/${jobId}/estimate`);
    await bar().screenshot({ path: path.join(SHOTS, "stepper-estimate-current.png") });
    await page.screenshot({ path: path.join(SHOTS, "job-page-estimate-current-1440.png") });
    // No hidden setup between the takeoff and the estimate: the footage is a
    // line on the estimate tab, unpriced and saying so.
    await next().click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/estimate`));
    const line = page.getByText(/Walls — untyped \(no type: check\)/).first();
    await expect(line).toBeVisible({ timeout: 30_000 });
    const feet = Number(((await page.locator("body").innerText()).match(/([\d,]+(?:\.\d+)?)\s*lin ft/) ?? [])[1]?.replace(/,/g, "") ?? 0);
    expect(feet, "the estimate shows no wall footage").toBeGreaterThan(0);
    await page.screenshot({ path: path.join(SHOTS, "estimate-plain-walls-1440.png"), fullPage: true });
  });

  test("6. the phone: the bar scrolls in its own row and the page does not scroll sideways", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await onJob();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    // Name what runs past the right edge, outermost first, so a failure says where.
    const past = await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .filter((node) => node.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .filter((node) => !node.parentElement || node.parentElement.getBoundingClientRect().right <= document.documentElement.clientWidth + 1)
        .slice(0, 6)
        .map((node) => `${node.tagName.toLowerCase()}${node.getAttribute("data-job-stepper") !== null ? "[stepper]" : ""}.${String((node as HTMLElement).className).slice(0, 60)} → ${Math.round(node.getBoundingClientRect().right)}`),
    );
    expect(sideways, `the page scrolls sideways; past the edge: ${past.join(" | ")}`).toBeLessThanOrEqual(1);
    await expect(next()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "job-page-390.png") });
    await page.setViewportSize(SIZE);
  });

  test("7. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
