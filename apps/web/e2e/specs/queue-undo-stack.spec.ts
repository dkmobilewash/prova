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
 * ── THE QUEUE'S UNDO IS A STACK, AND IT IS SAVED ──
 *
 * Chrome on Baker (91ea26b0): accept C8B on the 117 ft group, then on the 62 ft
 * group, Undo, Undo — and after a reload both were still saved, the original
 * runs on "C8B walls" labelled "set by hand", with the type's two estimate
 * lines. Here: two groups the drawing tags ZQ1, Enter on each, Undo twice,
 * every step read back from the rows, then a reload: nothing accepted.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/queue-undo-stack");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
// 1 page width = 144 ft.
const GROUPS = {
  one: { inches: 11.125, runs: [{ x1: 0.1, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.5 }] },
  two: { inches: 11.5, runs: [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6 }] },
};

test.describe("the review queue's Undo, two accepts deep, survives a reload", () => {
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

  const queue = () => page.locator('[data-takeoff="review-queue"]');
  const left = () => queue().locator('[data-takeoff="review-queue-left"]');
  const undo = () => page.locator('[data-takeoff="undo"]');
  /** The rows: how many runs are on ZQ1, how many untyped, and ZQ1's live lines. */
  const state = async () => ({
    typed: await prisma.takeoffMeasurement.count({ where: { page: { plan: { jobId } }, item: { wallType: { code: "ZQ1" } } } }),
    untyped: await prisma.takeoffMeasurement.count({ where: { page: { plan: { jobId } }, item: { name: "Walls — untyped" } } }),
    lines: await prisma.jobLineItem.count({ where: { jobId, isDeleted: false, takeoffItem: { wallType: { code: "ZQ1" } } } }),
  });

  test("1. two groups on A101 the drawing tags ZQ1, both untyped", async () => {
    test.setTimeout(90_000);
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Queue undo stack — Clinic", gcName: "ZZ-E2E Undo stack GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    const { id: planId, companyId } = plan;
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 1, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
    await prisma.planSheetProposal.create({
      data: { ingestJobId: ingest.id, planId, pageNumber: 1, proposedSheetNumber: "A101", proposedTitle: "FIRST FLOOR PLAN", proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
    });
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: ["ZQ1"], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    if ((await prisma.wallType.count({ where: { companyId, code: "ZQ1" } })) === 0) {
      // A height and a part, so an accept writes the type's estimate line, as Baker's C8B did.
      await prisma.wallType.create({ data: { companyId, code: "ZQ1", name: "ZZ-E2E queue-undo partition", defaultHeightFt: "15", sides: 2, components: { create: [{ description: "ZZ-E2E board", unit: "sq ft", basis: "BOARDED_SQFT" }] } } });
    }
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    const at = new Date();
    for (const g of Object.values(GROUPS)) {
      await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: g.inches, createdAt: at, source: "TAG", sourceLabel: "ZQ1", namedCode: "ZQ1", runs: g.runs.map((r) => ({ ...r, thicknessFeet: g.inches / 12 })) } });
    }
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } });
    for (const g of Object.values(GROUPS)) {
      for (const r of g.runs) {
        await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: untyped.id, label: "wall, untyped" } });
      }
    }
    expect(await state()).toEqual({ typed: 0, untyped: 3, lines: 0 });
  });

  test("2. Enter on each group, then Undo twice at once — before the saves are back, as a quick hand does", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await expect(left()).toHaveText("2 left to review");
    await expect(queue().locator('[data-takeoff="queue-type"]')).toHaveText("ZQ1");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Enter");
    await expect(queue().locator('[data-takeoff="queue-type"]')).toHaveText("ZQ1", { timeout: 30_000 });
    await page.keyboard.press("Enter");
    // Both accepts are on the stack at the press, newest last.
    await expect(undo()).toHaveAttribute("title", /Undo: Type ZQ1 on A101/);
    await undo().click();
    await expect(undo()).toBeEnabled({ timeout: 30_000 });
    await undo().click();
    await expect.poll(state, { timeout: 30_000 }).toEqual({ typed: 0, untyped: 3, lines: 0 });
    await expect(left()).toHaveText("2 left to review", { timeout: 30_000 });
    await expect(undo()).toBeDisabled({ timeout: 30_000 });
  });

  test("3. Redo is its own button: it puts the older accept back, and Undo takes that back in full", async () => {
    await page.locator('[data-takeoff="redo"]').click();
    await expect.poll(async () => (await state()).typed, { timeout: 30_000 }).toBeGreaterThan(0);
    // The lines follow the runs in the same save, but the read can land between them: poll, as for `typed`.
    await expect.poll(async () => (await state()).lines, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(undo()).toBeEnabled({ timeout: 30_000 });
    await undo().click();
    await expect.poll(state, { timeout: 30_000 }).toEqual({ typed: 0, untyped: 3, lines: 0 });
  });

  test("4. reloaded: nothing accepted, both groups back in the queue", async () => {
    await page.reload();
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await expect(left()).toHaveText("2 left to review", { timeout: 30_000 });
    expect(await state()).toEqual({ typed: 0, untyped: 3, lines: 0 });
    await page.screenshot({ path: path.join(SHOTS, "undone-reloaded-1440.png") });
  });

  test("5. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
