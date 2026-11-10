import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── AN UNTAGGED GROUP'S PICKER: THE LEGEND'S TYPES, CLOSEST THICKNESS FIRST ──
 *
 * One sheet, one group nothing names, drawn 6.6" thick. The legend lists ZQ4
 * (4-7/8"), ZQ8 (8") and ZQ7 (7-1/4") in that order. The queue offers them
 * closest first, ZQ7 · ZQ8 · ZQ4, each with its thickness, preselects nothing
 * (Enter alone asks for a type), and 1 then Enter types the group ZQ7.
 *
 * The shoot persona: its one spec never touches wall types, so these three
 * library types cannot reorder another spec's picker.
 */
test.describe.configure({ mode: "serial" });

const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const TYPES = [
  { code: "ZQ4", inches: "4.875" },
  { code: "ZQ8", inches: "8" },
  { code: "ZQ7", inches: "7.25" },
];
const RUN = { x1: 0.1, y1: 0.4, x2: 0.5, y2: 0.4 };

test.describe("an untagged group's picker", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    const pdf = readFileSync(S02);
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  const queue = () => page.locator('[data-takeoff="review-queue"]');

  test("1. a sheet with one group nothing names, 6.6\" thick", async () => {
    test.setTimeout(120_000);
    await signInAs(page, PERSONAS.shoot.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Untagged picker — One sheet", gcName: "ZZ-E2E Untagged picker GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const { id: planId, companyId } = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 1, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
    await prisma.planSheetProposal.create({
      data: { ingestJobId: ingest.id, planId, pageNumber: 1, proposedSheetNumber: "A101", proposedTitle: "FIRST FLOOR PLAN", proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
    });
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: TYPES.map((t) => t.code), proposals: [], reason: "seeded", confidence: "HIGH" } } });
    for (const t of TYPES) {
      const has = await prisma.wallType.findFirst({ where: { companyId, code: t.code }, select: { id: true } });
      if (has === null) await prisma.wallType.create({ data: { companyId, code: t.code, name: `ZZ-E2E ${t.code}`, thicknessIn: t.inches, defaultHeightFt: "10", sides: 2, components: { create: [{ description: `ZZ-E2E ${t.code} board`, unit: "sq ft", basis: "BOARDED_SQFT" }] } } });
      else await prisma.wallType.update({ where: { id: has.id }, data: { thicknessIn: t.inches } });
    }
    const sheet = await prisma.takeoffPlanPage.upsert({ where: { planId_pageNumber: { planId, pageNumber: 1 } }, create: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 }, update: { label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: 6.6, source: "REMAINDER", runs: [{ ...RUN, thicknessFeet: 6.6 / 12 }] } });
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } });
    await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [RUN.x1, RUN.x2], ys: [RUN.y1, RUN.y2], itemId: untyped.id, label: "wall, untyped" } });
  });

  test("2. the legend's types closest first, each with its thickness, and nothing preselected", async () => {
    test.setTimeout(90_000);
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    const codes = queue().locator('[data-takeoff="queue-code"]');
    await expect(codes).toHaveCount(3);
    await expect(codes.nth(0)).toContainText("1ZQ7");
    await expect(codes.nth(1)).toContainText("2ZQ8");
    await expect(codes.nth(2)).toContainText("3ZQ4");
    await expect(codes.nth(0).locator('[data-takeoff="queue-code-detail"]')).toContainText('7-1/4"');
    await expect(codes.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(queue().locator('[data-takeoff="queue-code"][aria-pressed="true"]')).toHaveCount(0);
    // Enter alone does not type it: nothing was chosen.
    await page.keyboard.press("Enter");
    await expect(queue().getByRole("alert")).toHaveText("Pick a type: 1–9.");
  });

  test("3. 1 then Enter types the group as the closest type", async () => {
    await page.keyboard.press("1");
    await expect(queue().locator('[data-takeoff="queue-code"][aria-pressed="true"]')).toContainText("ZQ7");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => prisma.takeoffMeasurement.count({ where: { page: { plan: { jobId } }, item: { jobId, wallType: { code: "ZQ7" } } } }), { timeout: 30_000 })
      .toBe(1);
  });
});
