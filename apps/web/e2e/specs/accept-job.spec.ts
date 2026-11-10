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
 * ── ACCEPT ALL PRINTED-TAG SUGGESTIONS ON THIS JOB ──
 *
 * Three floor plans, each with a ZK6 group (printed tag, 6") and a ZK8 group (printed
 * tag, 8"), and on A201 one group nothing names. The queue header offers the six printed
 * tags; its preview lists ZK6 and ZK8, each with its groups, feet and sheets, and a sheet
 * lights its walls on that plan. One click types all six; the untagged group stays. One
 * Undo puts every floor back.
 *
 * The rooms persona and the ZK6/ZK8 codes of confirm-once-per-set: no new library types,
 * so no other spec's picker changes.
 */
test.describe.configure({ mode: "serial" });

const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
// 1 page width = 144 ft: the ZK6 run is 43.2 ft, the ZK8 run 14.4 ft.
const ZK6 = { tag: "ZK6", inches: 6, run: { x1: 0.1, y1: 0.3, x2: 0.4, y2: 0.3 } };
const ZK8 = { tag: "ZK8", inches: 8, run: { x1: 0.1, y1: 0.7, x2: 0.2, y2: 0.7 } };
const LOOSE = { x1: 0.5, y1: 0.5, x2: 0.6, y2: 0.5 };
const FLOORS = [
  { page: 1, number: "A101", title: "FIRST FLOOR PLAN" },
  { page: 2, number: "A201", title: "SECOND FLOOR PLAN" },
  { page: 3, number: "A301", title: "THIRD FLOOR PLAN" },
];

test.describe("accept every printed-tag suggestion on the job in one click, with one Undo", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: SIZE });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(readFileSync(S02));
    const set = await PDFDocument.create();
    for (const copied of await set.copyPages(source, [0, 0, 0])) set.addPage(copied);
    const pdf = Buffer.from(await set.save());
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  const queue = () => page.locator('[data-takeoff="review-queue"]');
  const button = () => queue().locator('[data-takeoff="review-queue-accept-job"]');
  const preview = () => queue().locator('[data-takeoff="review-queue-job-preview"]');
  const runsOf = (code: string) => prisma.takeoffMeasurement.count({ where: { item: { jobId, wallType: { code } } } });
  const untypedOn = (pageNumber: number) => prisma.takeoffMeasurement.count({ where: { page: { pageNumber, plan: { jobId } }, item: { jobId, name: "Walls — untyped" } } });

  test("1. three floor plans: a ZK6 and a ZK8 group on each, and one untagged group on A201", async () => {
    test.setTimeout(120_000);
    // The rooms persona, as accept-sheet: the takeoff persona's workspace spec adds its starter library only
    // while the company has no wall types, and this spec's ZK6/ZK8 would stop that (step 20, "no W1").
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Accept job — Three floors", gcName: "ZZ-E2E Accept job GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    const { id: planId, companyId } = plan;

    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 3, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: ["ZK6", "ZK8"], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    for (const code of ["ZK6", "ZK8"]) {
      if ((await prisma.wallType.count({ where: { companyId, code } })) === 0) {
        await prisma.wallType.create({ data: { companyId, code, name: `ZZ-E2E ${code}`, defaultHeightFt: "10", sides: 2, components: { create: [{ description: `ZZ-E2E ${code} board`, unit: "sq ft", basis: "BOARDED_SQFT" }] } } });
      }
    }
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } });
    const at = new Date();
    for (const floor of FLOORS) {
      await prisma.planSheetText.create({ data: { planId, pageNumber: floor.page, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
      await prisma.planSheetProposal.create({
        data: { ingestJobId: ingest.id, planId, pageNumber: floor.page, proposedSheetNumber: floor.number, proposedTitle: floor.title, proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
      });
      const sheet = await prisma.takeoffPlanPage.upsert({
        where: { planId_pageNumber: { planId, pageNumber: floor.page } },
        create: { planId, pageNumber: floor.page, label: floor.number, pageWidthPt: 2592 },
        update: { label: floor.number, pageWidthPt: 2592 },
      });
      const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
      for (const g of [ZK6, ZK8]) {
        await prisma.takeoffWallProposal.create({
          data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: g.inches, createdAt: at, source: "TAG", sourceLabel: g.tag, namedCode: g.tag, runs: [{ ...g.run, thicknessFeet: g.inches / 12 }] },
        });
        await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [g.run.x1, g.run.x2], ys: [g.run.y1, g.run.y2], itemId: untyped.id, label: "wall, untyped" } });
      }
      if (floor.page === 2) {
        // A group nothing names: it stays for a person.
        await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: 5, createdAt: at, source: "REMAINDER", runs: [{ ...LOOSE, thicknessFeet: 5 / 12 }] } });
        await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [LOOSE.x1, LOOSE.x2], ys: [LOOSE.y1, LOOSE.y2], itemId: untyped.id, label: "wall, untyped" } });
      }
    }
  });

  test("2. the header offers the six printed tags; the preview lists each type's groups, feet and sheets", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await expect(button()).toHaveText("Accept all printed-tag suggestions on this job (6 groups)");
    await button().click();
    const rows = preview().locator('[data-takeoff="review-queue-job-type"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("ZK6");
    await expect(rows.nth(0)).toContainText("3 groups");
    await expect(rows.nth(0)).toContainText("130 ft");
    await expect(rows.nth(1)).toContainText("ZK8");
    await expect(rows.nth(1)).toContainText("43 ft");
    await expect(rows.nth(0).locator('[data-takeoff="review-queue-job-sheet"]')).toHaveText(["A101 (43 ft)", "A201 (43 ft)", "A301 (43 ft)"]);
    // A sheet lights its walls on that plan: the workspace goes to A201.
    await rows.nth(0).locator('[data-takeoff="review-queue-job-sheet"]').nth(1).click();
    await expect(page.locator('[data-takeoff="review-queue-item"]')).toBeVisible();
    // Nothing is typed by looking.
    expect(await runsOf("ZK6")).toBe(0);
    await expect(preview().locator('[data-takeoff="review-queue-job-accept"]')).toHaveText("Accept 6 printed-tag groups on 3 sheets (173 ft)");
  });

  test("3. one click types all six; the untagged group stays", async () => {
    await preview().locator('[data-takeoff="review-queue-job-accept"]').click();
    await expect(queue().locator('[data-takeoff="review-queue-accepted-text"]')).toHaveText("Accepted 6 printed-tag groups on 3 sheets · 173 ft", { timeout: 30_000 });
    await expect.poll(() => runsOf("ZK6"), { timeout: 30_000 }).toBe(3);
    await expect.poll(() => runsOf("ZK8"), { timeout: 30_000 }).toBe(3);
    expect(await untypedOn(1)).toBe(0);
    expect(await untypedOn(2)).toBe(1);
    expect(await untypedOn(3)).toBe(0);
    await expect(button()).toHaveCount(0);
  });

  test("4. one Undo puts every floor back", async () => {
    await queue().locator('[data-takeoff="review-queue-accepted-undo"]').click();
    await expect.poll(() => runsOf("ZK6"), { timeout: 30_000 }).toBe(0);
    expect(await runsOf("ZK8")).toBe(0);
    for (const floor of FLOORS) expect(await untypedOn(floor.page)).toBe(floor.page === 2 ? 3 : 2);
    await expect(button()).toHaveText("Accept all printed-tag suggestions on this job (6 groups)", { timeout: 30_000 });
    const undo = page.locator('[data-takeoff="undo"]');
    await expect(undo).toHaveAttribute("title", /Undo: Accept 6 printed-tag groups on 3 sheets/, { timeout: 30_000 });
  });
});
