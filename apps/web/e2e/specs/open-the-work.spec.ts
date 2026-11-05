import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── THE WORKSPACE OPENS ON THE WORK, AND PRICES SHARE ONE TAB (new-customer run v2, M2 and M5) ──
 *
 * M2: "Next: Run the takeoff" opened the overall plan (Baker's A100), and
 * before the scales the reflected ceiling plan. It now opens the floor plan
 * the whole-set run counts: A101. M5: every "Open the line" in the review
 * queue opened a new browser tab; they now share one estimate tab, which
 * moves to each line.
 *
 * The set is three copies of one fixture sheet titled as Baker's are; the
 * titles and lines are invented. The ROOMS company, as in wall-heights.spec.ts.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/open-the-work");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };

test.describe("opening on the work, and one estimate tab", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  const lines: string[] = [];

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({ viewport: SIZE });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(readFileSync(S02));
    const tripled = await PDFDocument.create();
    for (const copied of await tripled.copyPages(source, [0, 0, 0])) tripled.addPage(copied);
    const pdf = Buffer.from(await tripled.save());
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  const picker = (tab: Page) => tab.locator('[data-takeoff="sheet-picker"]');

  test("1. an overall plan, the floor plan and a ceiling plan, and two unpriced lines", async () => {
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Open the work — Clinic", gcName: "ZZ-E2E Open the work GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    const ingest = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId: plan.companyId, stage: "TITLE_BLOCK", pageCount: 3, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    for (const [pageNumber, number, title] of [[1, "A100", "OVERALL FLOOR PLAN"], [2, "A101", "FLOOR PLAN"], [3, "A111", "REFLECTED CEILING PLAN"]] as const) {
      await prisma.planSheetText.create({ data: { planId: plan.id, pageNumber, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
      await prisma.planSheetProposal.create({
        data: { ingestJobId: ingest.id, planId: plan.id, pageNumber, proposedSheetNumber: number, proposedTitle: title, proposedPageType: "PLAN", proposedScale: '1/8" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
      });
    }
    // Only the overall plan and the ceiling plan are scaled so far: the floor plan of the work is not.
    for (const pageNumber of [1, 3]) {
      const sheet = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber, pageWidthPt: 2592 } });
      await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "288" } });
    }
    for (const description of ["ZZ-E2E Patch and repair", "ZZ-E2E Corner bead"]) {
      lines.push((await prisma.jobLineItem.create({ data: { jobId, description, quantity: "3", unit: "EA" }, select: { id: true } })).id);
    }
  });

  test("2. the workspace opens on A101, before its scale is set", async () => {
    await page.goto(`/takeoff/${jobId}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(picker(page)).toHaveValue("2");
  });

  test("3. and once it is scaled too, still A101, not the overall plan", async () => {
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, select: { id: true } });
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 2, pageWidthPt: 2592 } });
    await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "288" } });
    await page.goto(`/jobs/${jobId}`);
    const next = page.locator("[data-job-next]");
    await expect(next).toContainText("Next: Run the takeoff");
    const [tab] = await Promise.all([page.context().waitForEvent("page"), next.click()]);
    await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(picker(tab)).toHaveValue("2");
    await tab.screenshot({ path: path.join(SHOTS, "opens-on-a101-1440.png") });
    await tab.close();
  });

  test("4. two prices, one estimate tab that moves to each line", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    const queue = page.locator('[data-takeoff="review-queue"]');
    const item = queue.locator('[data-takeoff="review-queue-item"]');
    await expect(queue.locator('[data-takeoff="review-queue-left"]')).toHaveText("2 left to review", { timeout: 60_000 });
    await expect(item).toHaveAttribute("data-kind", "price");
    const link = item.locator('[data-takeoff="review-queue-line"]');
    await expect(link).toHaveAttribute("target", `estimate-${jobId}`);
    const [estimate] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
    await expect.poll(() => estimate.url()).toContain(`line=${lines[0]}`);
    const tabs = page.context().pages().length;
    // The second line: the same tab moves to it; no new one opens.
    await page.bringToFront();
    await item.locator('[data-takeoff="review-queue-next"]').click();
    await expect(link).toHaveAttribute("href", new RegExp(`line=${lines[1]}`));
    let opened = false;
    page.context().once("page", () => (opened = true));
    await link.click();
    await expect.poll(() => estimate.url(), { timeout: 30_000 }).toContain(`line=${lines[1]}`);
    await expect(estimate.locator(`details[id="line-${lines[1]}"]`)).toHaveAttribute("open", "", { timeout: 30_000 });
    expect(opened, "a second tab opened for the second price").toBe(false);
    expect(page.context().pages().length).toBe(tabs);
    await estimate.screenshot({ path: path.join(SHOTS, "estimate-on-second-line-1440.png") });
    await estimate.close();
  });

  test("5. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
