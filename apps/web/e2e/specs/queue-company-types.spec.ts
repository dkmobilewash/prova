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
 * ── A SET WHOSE LEGEND NAMES NO TYPES STILL GETS ITS WALLS TYPED IN THE QUEUE ──
 *
 * The fourth session's walk on Baker (main 66eeca59): the legend read named no
 * types, so every untyped group said "choose one in the sheet's group list",
 * offered nothing, and the queue never emptied — and the workspace behind it
 * sat on another sheet. Now the company's own types are offered in the same
 * keyboard row, and the workspace opens on the first item's sheet.
 *
 * The TAKEOFF company, whose starter W1 review-queue.spec.ts adds the same way;
 * seeded rows, as the other queue specs, because CI cannot detect on a stub.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/queue-company-types");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const RUNS = [{ x1: 0.2, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.45 }];

test.describe("the queue offers the company's types when the legend names none", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let planId = "";

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

  test("1. two scaled sheets, an untyped group on the second, and no legend read", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Queue company types — Two sheets", gcName: "ZZ-E2E Queue types GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    planId = plan.id;
    if ((await prisma.wallType.count({ where: { companyId: plan.companyId, code: "W1" } })) === 0) {
      await page.goto("/wall-types");
      await page.getByRole("button", { name: /Start from the common trade assemblies/ }).click();
      // By the row, not the "Added" toast: another spec on this company may add them first, and then this press says they are already there.
      await expect.poll(() => prisma.wallType.count({ where: { companyId: plan.companyId, code: "W1" } }), { timeout: 60_000 }).toBe(1);
    }
    for (const pageNumber of [1, 2]) {
      const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber, pageWidthPt: 2592 } });
      const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
      if (pageNumber !== 2) continue;
      await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: 4.875, source: "REMAINDER", runs: RUNS.map((r) => ({ ...r, thicknessFeet: 0.40625 })) } });
      const untyped = await prisma.takeoffItem.create({ data: { companyId: plan.companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" } });
      for (const r of RUNS) {
        await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: untyped.id, label: "wall, untyped" } });
      }
    }
    expect(await prisma.takeoffPlanTextRead.count({ where: { planId, kind: "legend" } })).toBe(0);
  });

  test("2. the queue opens on that group's sheet, with the company's types to pick from", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    const item = page.locator('[data-takeoff="review-queue-item"]');
    await expect(item).toHaveAttribute("data-kind", "type", { timeout: 60_000 });
    await expect(page.locator('[data-takeoff="sheet-picker"]')).toHaveValue("2");
    const codes = item.locator('[data-takeoff="queue-code"]');
    await expect(codes.filter({ hasText: /^1\s*W1$/ })).toHaveCount(1);
    await page.screenshot({ path: path.join(SHOTS, "queue-company-types-1440.png") });
  });

  test("3. 1 picks W1, Enter type the group, and the queue empties", async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("1");
    await expect(page.locator('[data-takeoff="queue-type"]')).toHaveText("W1");
    await page.keyboard.press("Enter");
    await expect.poll(async () => prisma.takeoffMeasurement.count({ where: { page: { planId, pageNumber: 2 }, item: { wallType: { code: "W1" } } } }), { timeout: 30_000 }).toBe(2);
    // W1 has no height of its own, so a height item may follow; the type item itself is gone.
    await expect(page.locator('[data-takeoff="review-queue-item"][data-kind="type"]')).toHaveCount(0, { timeout: 30_000 });
  });

  test("4. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
