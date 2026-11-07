import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";
import { legendProposalFrom } from "../../lib/takeoff/legendProposalBuild";

/**
 * ── CHROME'S QUEUE TEST ON BAKER, THREE THINGS ──
 *
 * 1. Accepting a group typed by a legend code the library lacks (C8B) adds the
 *    type to the library and a "C8B walls" item to the job. Undo put the walls
 *    back and left both. Undo now takes back what its own accept made, when
 *    nothing else uses it, and offers the legend read again.
 * 2. After the undo, "Prices 2 of 12" stayed until a reload: the accept's price
 *    items left the queue and were counted as done. The counts follow now.
 * 3. The panel listed 12 groups and the queue 20: the rest were behind "Show the
 *    other". The panel lists every group, before and after Run takeoff and a reload.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/queue-undo-library");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const CODE = "ZQ8B";
// Fourteen groups (past the old fold of twelve), one run each, every one tagged ZQ8B.
const GROUPS = Array.from({ length: 14 }, (_, i) => ({ inches: 4 + i * 0.5, run: { x1: 0.1, y1: 0.2 + i * 0.05, x2: 0.3 + (i % 5) * 0.1, y2: 0.2 + i * 0.05 } }));

test.describe("Undo takes back the library type its accept added; the counts follow; the panel lists every group", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let companyId = "";
  let proposalId = "";

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
  const progress = () => queue().locator('[data-takeoff="review-queue-progress"]');
  const undo = () => page.locator('[data-takeoff="undo"]');
  const panelRows = () => page.locator('[data-takeoff="found-group"]');
  const library = () => prisma.wallType.count({ where: { companyId, code: CODE } });
  const jobItem = () => prisma.takeoffItem.count({ where: { jobId, name: `${CODE} walls` } });

  test("1. fourteen groups on A101 tagged ZQ8B, which only the set's legend defines", async () => {
    test.setTimeout(90_000);
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Queue undo library — Clinic", gcName: "ZZ-E2E Undo library GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    companyId = plan.companyId;
    const planId = plan.id;
    // A ZQ8B an earlier run left in this persona's library, unused, would make the accept not add one.
    await prisma.wallType.deleteMany({ where: { companyId, code: CODE, runs: { none: {} }, takeoffItems: { none: {} } } });
    expect(await library()).toBe(0);
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 1, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
    await prisma.planSheetProposal.create({
      data: { ingestJobId: ingest.id, planId, pageNumber: 1, proposedSheetNumber: "A101", proposedTitle: "FIRST FLOOR PLAN", proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
    });
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: [CODE], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    const legendRun = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 1 }, select: { id: true } });
    const read = { types: [{ code: CODE, name: "ZZ-E2E partition ZQ8B", lines: ['6" METAL STUDS @ 16" O.C.', '5/8" GYP. BD. EACH SIDE'] }], uno: [], reason: "seeded", confidence: "HIGH" as const };
    proposalId = (await prisma.planLegendProposal.create({ data: { ingestJobId: legendRun.id, planId, pageNumber: 1, ...legendProposalFrom({ pageNumber: 1, sheetTitle: "PARTITION TYPES", model: "seed", read, crops: [] }) }, select: { id: true } })).id;
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    const at = new Date();
    for (const g of GROUPS) {
      await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: g.inches, createdAt: at, source: "TAG", sourceLabel: CODE, namedCode: CODE, runs: [{ ...g.run, thicknessFeet: g.inches / 12 }] } });
    }
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } });
    for (const g of GROUPS) {
      await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [g.run.x1, g.run.x2], ys: [g.run.y1, g.run.y2], itemId: untyped.id, label: "wall, untyped" } });
    }
  });

  test("2. the panel lists all fourteen groups the queue has, not the first twelve", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await expect(left()).toHaveText("14 left to review");
    await expect(progress()).toHaveText("Groups 0 of 14");
    await expect(panelRows()).toHaveCount(14, { timeout: 30_000 });
    await expect(page.getByText("Show the other")).toHaveCount(0);
  });

  test("3. Enter adds ZQ8B to the library and the job; Undo takes both back, and the counts follow without a reload", async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(queue().locator('[data-takeoff="queue-type"]')).toHaveText(CODE);
    // ZQ8B has no height yet: the first Enter asks for one, the second leaves it for later.
    await page.keyboard.press("Enter");
    await expect(queue()).toContainText("Enter again to leave it for later");
    await page.keyboard.press("Enter");
    await expect.poll(library, { timeout: 30_000 }).toBe(1);
    await expect.poll(jobItem, { timeout: 30_000 }).toBe(1);
    expect((await prisma.planLegendProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("ACCEPTED");
    await expect(left()).toHaveText(/^1[34] left to review$/, { timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "accepted-1440.png") });

    await expect(undo()).toBeEnabled({ timeout: 30_000 });
    await undo().click();
    await expect.poll(library, { timeout: 30_000 }).toBe(0);
    await expect.poll(jobItem, { timeout: 30_000 }).toBe(0);
    expect((await prisma.planLegendProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("PROPOSED");
    // No reload: the counts are what they were before the accept.
    await expect(left()).toHaveText("14 left to review", { timeout: 30_000 });
    await expect(progress()).toHaveText("Groups 0 of 14", { timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "undone-1440.png") });
  });

  test("4. after Run takeoff and after a reload, the panel still lists every group the queue has", async () => {
    await page.goto(`/takeoff/${jobId}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    const run = page.locator('[data-takeoff="find-walls"]');
    await expect(run).toBeEnabled({ timeout: 60_000 });
    await run.click();
    await expect(run).toHaveText("Run takeoff", { timeout: 180_000 });
    await expect(panelRows()).toHaveCount(14, { timeout: 30_000 });
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await expect(left()).toHaveText("14 left to review", { timeout: 30_000 });
    await expect(panelRows()).toHaveCount(14, { timeout: 30_000 });
  });

  test("5. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
