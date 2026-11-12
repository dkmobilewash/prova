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
 * ── CHROME'S RE-TEST, ITEMS 1, 2, 4, 5 AND 6 (3 is in fast-confirm.spec.ts) ──
 *
 *   1. the bottom strip shows the ONE shape picked — its length, type and
 *      height — and lets go on Esc and a sheet change;
 *   2. one review: the top bar's Review walls opens the queue, and Keep/Drop
 *      of the posted walls is a step inside it;
 *   4. the button's count is the queue's count;
 *   5. a mouse-wheel notch zooms about 12%;
 *   6. the stepper's Scale step follows a scale saved in another tab.
 *
 * Seeded in the shapes the walls stage and the room finder write, because CI
 * cannot detect on a stub. The ROOMS company; the type code is invented.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/chrome-retest");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const RUNS = [{ x1: 0.2, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.45 }];
const HELD = { x1: 0.6, y1: 0.6, x2: 0.7, y2: 0.6 };

test.describe("Chrome's re-test", () => {
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
    const set = await PDFDocument.create();
    for (const copied of await set.copyPages(source, [0, 0, 0])) set.addPage(copied);
    const pdf = Buffer.from(await set.save());
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  const queue = () => page.locator('[data-takeoff="review-queue"]');
  const left = () => queue().locator('[data-takeoff="review-queue-left"]');
  const overlay = () => page.locator('[data-testid="takeoff-plan-port"] svg').first();
  const strip = () => page.locator('[data-takeoff="selection-facts"]');
  async function at(x: number, y: number) {
    const box = (await overlay().boundingBox())!;
    return { x: box.x + x * box.width, y: box.y + y * box.width };
  }
  /**
   * The point once the sheet has stopped moving. Opening or closing the strip
   * resizes the frame, and at Fit the sheet re-fits — a render that finishes
   * later. A point taken before, or during, lands off the run (main's CI on
   * 68b531be: the click after Esc picked nothing).
   */
  async function settledAt(x: number, y: number) {
    let last = "";
    await expect
      .poll(async () => {
        const box = await overlay().boundingBox();
        const now = box === null ? "" : `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}`;
        const same = now !== "" && now === last;
        last = now;
        return same;
      }, { intervals: [250], timeout: 15_000 })
      .toBe(true);
    return at(x, y);
  }

  test("1. three floor plans, two scaled; a typed group with a height on the first, and a run held to confirm", async () => {
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Chrome re-test — Three floors", gcName: "ZZ-E2E Chrome re-test GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    planId = plan.id;
    const companyId = plan.companyId;
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 3, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    for (const [pageNumber, number, title] of [[1, "A101", "FIRST FLOOR PLAN"], [2, "A102", "SECOND FLOOR PLAN"], [3, "A103", "THIRD FLOOR PLAN"]] as const) {
      await prisma.planSheetText.create({ data: { planId, pageNumber, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
      await prisma.planSheetProposal.create({
        data: { ingestJobId: ingest.id, planId, pageNumber, proposedSheetNumber: number, proposedTitle: title, proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
      });
    }
    const type =
      (await prisma.wallType.findFirst({ where: { companyId, code: "ZR1" }, select: { id: true } })) ??
      (await prisma.wallType.create({ data: { companyId, code: "ZR1", name: "ZZ-E2E retest partition", sides: 2 }, select: { id: true } }));
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "ZR1 walls", type: "LINEAR", colorHex: "#3366cc", wallTypeId: type.id, heightFt: "9.5", sides: 2 } });
    for (const pageNumber of [1, 2]) {
      const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber, label: `A10${pageNumber}`, pageWidthPt: 2592 } });
      const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
      if (pageNumber !== 1) continue;
      await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: 4.875, source: "REMAINDER", runs: [...RUNS, HELD].map((r) => ({ ...r, thicknessFeet: 0.40625 })) } });
      for (const r of RUNS) {
        await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: item.id, label: "ZR1 wall" } });
      }
      await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [HELD.x1, HELD.x2], ys: [HELD.y1, HELD.y2], label: "wall, to confirm" } });
    }
  });

  test("2 and 4. one Review button, whose count is the queue's", async () => {
    await page.goto(`/takeoff/${jobId}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    const open = page.locator('[data-takeoff="review-queue-open"]');
    // The held wall and the floor plan with no scale.
    await expect(open).toHaveText("Review walls · 2", { timeout: 60_000 });
    await expect(page.locator('[data-takeoff="review-set"]'), "the old Keep/Drop button is gone from the top bar").toHaveCount(0);
    await open.click();
    await expect(left()).toHaveText("2 left to review");
    await page.screenshot({ path: path.join(SHOTS, "one-review-1440.png") });
  });

  test("2. a wall to confirm takes K; the posted walls' Keep/Drop is a step of the queue, and comes back to it", async () => {
    const item = queue().locator('[data-takeoff="review-queue-item"]');
    await expect(item).toHaveAttribute("data-kind", "wall");
    await expect(item.locator('[data-takeoff="review-queue-wall-keys"]')).toHaveText("K it’s a wall · D not a wall · N skip");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("k");
    // Kept: it goes onto "Walls — untyped", which has no height, so a height item takes its place.
    await expect.poll(async () => (await prisma.takeoffMeasurement.findFirst({ where: { page: { planId }, xs: { equals: [HELD.x1, HELD.x2] } }, select: { label: true } }))?.label).not.toBe("wall, to confirm");
    const doubted = queue().locator('[data-takeoff="review-queue-doubted"]');
    await expect(doubted).toHaveText(/^Check the walls the model doubts · \d+$/);
    await doubted.click();
    const counter = page.locator('[data-takeoff="review-counter"]');
    await expect(counter).toContainText(/^0 of \d+ looked at · 0 ft dropped/);
    await expect(queue()).toHaveCount(0);
    await page.keyboard.press("d");
    await expect(counter).toContainText(/^1 of \d+ looked at · [1-9][\d,]* ft dropped/);
    await page.keyboard.press("u");
    await expect(counter).toContainText(/^0 of \d+ looked at · 0 ft dropped/);
    await page.locator('[data-takeoff="review-close"]').click();
    await expect(queue(), "closing the step goes back to the queue").toBeVisible();
    await expect(left()).toHaveText(/^\d+ left to review$/);
    const n = Number((await left().innerText()).split(" ")[0]);
    await queue().locator('[data-takeoff="review-queue-close"]').click();
    // 4. The button says what the queue said.
    await expect(page.locator('[data-takeoff="review-queue-open"]')).toHaveText(`Review walls · ${n}`);
  });

  test("1. the strip shows the one run picked — its length, type and height — and lets go on Esc and a sheet change", async () => {
    const picker = page.locator('[data-takeoff="sheet-picker"]');
    if ((await picker.inputValue()) !== "1") await picker.selectOption("1");
    await expect(page.locator('[data-testid="takeoff-plan-port"]')).toHaveAttribute("data-sheet-ready", "true", { timeout: 60_000 });
    // The review left it zoomed on a run; the whole sheet, so the run is on screen.
    await page.locator('[data-takeoff="fit"]').click();
    const onRun = () => settledAt((RUNS[0]!.x1 + RUNS[0]!.x2) / 2, RUNS[0]!.y1);
    const mid = await onRun();
    await page.mouse.click(mid.x, mid.y);
    await expect(strip()).toContainText(`43'-2"`);
    await expect(strip()).toContainText("ZR1 walls");
    await expect(strip()).toContainText("Type");
    await expect(strip()).toContainText("ZR1");
    await expect(strip()).toContainText(`9'-6"`);
    // One run, not the item's 64.8 ft.
    await expect(strip()).not.toContainText(`64'-10"`);
    await page.screenshot({ path: path.join(SHOTS, "strip-one-run-1440.png") });
    await page.keyboard.press("Escape");
    await expect(strip()).toHaveCount(0);
    // The strip has closed and the frame grown back: the run is wherever the re-fit put it.
    const again = await onRun();
    await page.mouse.click(again.x, again.y);
    await expect(strip()).toContainText(`43'-2"`);
    await picker.selectOption("2");
    await expect(strip()).toHaveCount(0);
  });

  test("5. three mouse-wheel notches zoom about 40%, not 25% → 31%", async () => {
    const zoom = page.locator('[data-takeoff="zoom"]');
    await expect(page.locator('[data-testid="takeoff-plan-port"]')).toHaveAttribute("data-sheet-ready", "true", { timeout: 60_000 });
    const before = Number((await zoom.innerText()).replace("%", ""));
    const box = (await overlay().boundingBox())!;
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
    // A synthetic wheel always arrives as a mouse notch (wheelDeltaY ±120).
    for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, -4); // a small notch, as Chrome's mouse reports one
    await expect.poll(async () => Number((await zoom.innerText()).replace("%", "")) / before, { timeout: 10_000 }).toBeGreaterThan(1.35);
  });

  test("6. the stepper's Scale step follows a scale saved in another tab", async () => {
    await page.goto(`/jobs/${jobId}`);
    // A103 has no scale yet, so the Scale step is not done.
    await expect(page.locator('[data-job-step="scale"]')).not.toHaveAttribute("data-state", "done");
    // A103's scale saved elsewhere (the workspace's own tab), as its Set scale would.
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 3, label: "A103", pageWidthPt: 2592 } });
    await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    // Coming back to this tab: no reload.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator('[data-job-step="scale"]')).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  });

  test("7. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
