import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── ONE REVIEW QUEUE (guided flow, Phase 4) ──
 *
 * The stepper's Review opens the workspace on a single list across the job:
 * a wall held "to confirm", an untyped wall group, a floor plan with no scale,
 * an unpriced estimate line — one at a time, with Next and a count left. Each
 * is decided with the piece that already decides it, and Review is done when
 * the list is empty.
 *
 * THE TAKEOFF ROWS ARE SEEDED, in the shapes the WALLS stage and the reader
 * write, because in CI nothing can run detection on a stubbed upload. The set
 * is two copies of one fixture sheet; the titles and the type code are invented.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/review-queue");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const QUARTER = '1/4" = 1\'-0"';
// The starter library's stud partition. The takeoff company is shared with
// takeoff-workspace.spec.ts, which adds that library only to a company with
// no types: so this spec adds it the same way, never a type of its own.
const CODE = "W1";
const HELD = "wall, to confirm";

test.describe("the job's one review queue", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let planId = "";
  let lineId = "";

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({ viewport: SIZE });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(readFileSync(S02));
    const doubled = await PDFDocument.create();
    for (const copied of await doubled.copyPages(source, [0, 0])) doubled.addPage(copied);
    const pdf = Buffer.from(await doubled.save());
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  const queue = (tab: Page) => tab.locator('[data-takeoff="review-queue"]');
  const left = (tab: Page) => queue(tab).locator('[data-takeoff="review-queue-left"]');
  const item = (tab: Page) => queue(tab).locator('[data-takeoff="review-queue-item"]');
  const picker = (tab: Page) => tab.locator('[data-takeoff="sheet-picker"]');

  test("1. a job with something of each kind to review", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Review queue — Two floors", gcName: "ZZ-E2E Review queue GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    planId = plan.id;
    const companyId = plan.companyId;

    // Two floor plans; the second has only its title block's scale.
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 2, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    for (const [pageNumber, number, title] of [[1, "A101", "FIRST FLOOR PLAN"], [2, "A102", "SECOND FLOOR PLAN"]] as const) {
      await prisma.planSheetText.create({ data: { planId, pageNumber, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
      await prisma.planSheetProposal.create({
        data: { ingestJobId: ingest.id, planId, pageNumber, proposedSheetNumber: number, proposedTitle: title, proposedPageType: "PLAN", proposedScale: QUARTER, proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
      });
    }
    await prisma.planSheetScaleReading.create({ data: { planId, pageNumber: 2, scaleName: QUARTER, source: "CAPTION", x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "144", declaredText: QUARTER, consideredCount: 1 } });
    // The legend names one type, and the library has it.
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: [CODE], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    if ((await prisma.wallType.count({ where: { companyId, code: CODE } })) === 0) {
      await page.goto("/wall-types");
      await page.getByRole("button", { name: /Start from the common trade assemblies/ }).click();
      await expect(page.getByText(/^Added /)).toBeVisible({ timeout: 60_000 });
    }

    // Sheet 1, scaled (1 page-width = 144 ft), with what the WALLS stage wrote:
    // one group of two runs posted to "Walls — untyped", and one run held to confirm.
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    const runs = [
      { x1: 0.2, y1: 0.3, x2: 0.5, y2: 0.3, thicknessFeet: 0.40625 },
      { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.45, thicknessFeet: 0.40625 },
    ];
    await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: 4.875, source: "REMAINDER", runs } });
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" } });
    for (const run of runs) {
      await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [run.x1, run.x2], ys: [run.y1, run.y2], itemId: untyped.id, label: "4 7/8\" wall" } });
    }
    await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [0.6, 0.7], ys: [0.6, 0.6], label: HELD } });

    // And a line on the estimate with neither a price nor a cost.
    lineId = (await prisma.jobLineItem.create({ data: { jobId, description: "ZZ-E2E Patch and repair", quantity: "3", unit: "EA" }, select: { id: true } })).id;
  });

  test("2. the stepper's Review counts the whole queue and opens it", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expectHealthy(page, "the job with things to review", { monitor });
    await expect(page.locator('[data-job-step="review"]')).toHaveAttribute("data-state", "current");
    await expect(page.locator("[data-job-next]")).toContainText("Next: Review 4 items");
    await expect(page.locator("[data-job-next]")).toHaveAttribute("href", `/takeoff/${jobId}?open=review`);
  });

  let tab: Page;
  test("3. one item at a time: the held wall first, on its sheet, with Next and a count", async () => {
    [tab] = await Promise.all([page.context().waitForEvent("page"), page.locator("[data-job-next]").click()]);
    await tab.waitForURL(new RegExp(`/takeoff/${jobId}\\?open=review`));
    await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(queue(tab)).toBeVisible();
    await expect(left(tab)).toHaveText("4 left to review");
    await expect(item(tab)).toHaveAttribute("data-kind", "wall");
    await expect(item(tab)).toContainText("Wall to confirm · sheet A101 · 14 ft");
    await expect(picker(tab)).toHaveValue("1");
    await tab.screenshot({ path: path.join(SHOTS, "queue-wall-1440.png") });
    // Next skips without deciding: the count stays, and it comes back round.
    await item(tab).locator('[data-takeoff="review-queue-next"]').click();
    await expect(item(tab)).toHaveAttribute("data-kind", "type");
    await expect(left(tab)).toHaveText("4 left to review");
    for (const kind of ["scale", "price", "wall"]) {
      await item(tab).locator('[data-takeoff="review-queue-next"]').click();
      await expect(item(tab)).toHaveAttribute("data-kind", kind);
    }
  });

  test("4. Not a wall: it is dropped, and leaves the queue", async () => {
    await item(tab).locator('[data-takeoff="review-queue-drop"]').click();
    await expect(left(tab)).toHaveText("3 left to review");
    await expect.poll(async () => (await prisma.takeoffMeasurement.findFirst({ where: { page: { planId }, xs: { equals: [0.6, 0.7] } }, select: { label: true } }))?.label).toBe("wall, dropped");
  });

  test("5. the untyped group: Set type names it, and every run goes onto that type", async () => {
    await expect(item(tab)).toHaveAttribute("data-kind", "type");
    await expect(item(tab)).toContainText(/Untyped walls · sheet A101 · 4-7\/8" · 65 ft/);
    await tab.screenshot({ path: path.join(SHOTS, "queue-type-1440.png") });
    await item(tab).locator('[data-takeoff="review-queue-type"]', { hasText: CODE }).click();
    await expect(left(tab)).toHaveText("2 left to review");
    await expect
      .poll(async () => (await prisma.takeoffMeasurement.findMany({ where: { page: { planId }, label: `${CODE} wall (set by hand)` }, select: { id: true } })).length)
      .toBe(2);
  });

  test("6. the floor plan with no scale: its sheet, and the printed-scale fix", async () => {
    await expect(item(tab)).toHaveAttribute("data-kind", "scale");
    await expect(item(tab)).toContainText("No scale · floor plan A102");
    await expect(picker(tab)).toHaveValue("2");
    await expect(item(tab).locator('[data-takeoff="review-queue-set-scale"]')).toBeVisible();
    await item(tab).locator('[data-takeoff="review-queue-printed"]').click();
    await expect(left(tab)).toHaveText("1 left to review");
    expect(await prisma.takeoffScaleCalibration.count({ where: { page: { planId, pageNumber: 2 } } })).toBe(1);
  });

  test("7. the unpriced line opens on the estimate; once priced, the queue is empty", async () => {
    await expect(item(tab)).toHaveAttribute("data-kind", "price");
    const link = item(tab).locator('[data-takeoff="review-queue-line"]');
    await expect(link).toHaveAttribute("href", `/jobs/${jobId}/estimate?line=${lineId}#line-${lineId}`);
    const [estimate] = await Promise.all([tab.context().waitForEvent("page"), link.click()]);
    const line = estimate.locator(`details#line-${lineId}`);
    await expect(line).toHaveAttribute("open", "");
    await line.locator('input[name="unitPrice"]').first().fill("85");
    await line.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await prisma.jobLineItem.findUniqueOrThrow({ where: { id: lineId }, select: { unitPrice: true } })).unitPrice?.toString()).toBe("85");
    await estimate.close();
    // Back on the workspace's tab: it reads the queue again.
    await tab.bringToFront();
    await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(left(tab)).toHaveText("Nothing left to review", { timeout: 30_000 });
    await expect(queue(tab).locator('[data-takeoff="review-queue-done"]')).toHaveAttribute("href", `/jobs/${jobId}`);
    await queue(tab).screenshot({ path: path.join(SHOTS, "queue-done.png") });
  });

  test("8. Review is done when the list is empty", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expect(page.locator('[data-job-step="review"]')).toHaveAttribute("data-state", "done");
    await expect(page.locator("[data-job-next]")).not.toHaveText(/Review/);
  });

  test("9. nothing crashed", async () => {
    await tab.close();
    expect(monitor.crashes).toEqual([]);
  });
});
