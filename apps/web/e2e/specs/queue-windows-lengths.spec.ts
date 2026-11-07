import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";
import { HELD_ITEM, HELD_LABEL } from "../../lib/takeoff/estimateHold";
import { WINDOWS_SUGGESTED } from "../../lib/takeoff/windowTags";

/**
 * ── CHROME'S QUEUE RE-TEST ON BAKER A101, TWO THINGS ──
 *
 * 1. "Confirm 9" on the Windows item could not be undone: it went on no Undo
 *    stack and had no undo. Window confirms, and "Not a window", are on the same
 *    stack as the groups now.
 * 2. The panel and the queue listed the same groups at different lengths (5" 46 ft
 *    against 43, 12-1/8" 24 against 18) and a 9-3/4" group the queue did not have:
 *    the panel counted runs held on "Walls — to confirm", which the queue asks
 *    about separately (Held walls). The panel leaves them out too.
 *
 * The sheet is shaped like A101's: groups with one held run, one whose every run
 * is held, one with none, and three suggested windows.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/queue-windows-lengths");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
// 1 page width = 144 ft. Each group's runs; `held` are the ones on "Walls — to confirm".
const GROUPS = [
  { inches: 5.02, runs: [{ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.2 }, { x1: 0.1, y1: 0.25, x2: 0.15, y2: 0.25 }], held: [1] },
  { inches: 12.16, runs: [{ x1: 0.4, y1: 0.3, x2: 0.55, y2: 0.3 }, { x1: 0.4, y1: 0.35, x2: 0.45, y2: 0.35 }], held: [1] },
  { inches: 9.76, runs: [{ x1: 0.6, y1: 0.4, x2: 0.7, y2: 0.4 }, { x1: 0.6, y1: 0.45, x2: 0.65, y2: 0.45 }], held: [0, 1] },
  { inches: 7.36, runs: [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6 }, { x1: 0.2, y1: 0.65, x2: 0.3, y2: 0.65 }], held: [] as number[] },
];
const WINDOWS = [{ tag: "W1", x: 0.3 }, { tag: "W1", x: 0.4 }, { tag: "W2", x: 0.5 }].map((w) => ({ tag: w.tag, x1: w.x, y1: 0.8, x2: w.x + 0.03, y2: 0.8 }));

test.describe("window confirms undo on the stack; the panel's groups have the queue's lengths", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let planId = "";

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
  const undo = () => page.locator('[data-takeoff="undo"]');
  const windowCounts = () => prisma.takeoffMeasurement.count({ where: { kind: "COUNT", page: { plan: { jobId } } } });
  const windowItems = () => prisma.takeoffItem.count({ where: { jobId, type: "COUNT" } });

  /** The panel's group rows: thickness → feet, as shown. */
  const panelLengths = async () =>
    Object.fromEntries(
      await page.locator('[data-takeoff="found-group"]').evaluateAll((rows) =>
        rows.map((r) => [Number(r.getAttribute("data-inches")).toFixed(2), Number(/(\d[\d,]*) ft/.exec(r.textContent ?? "")?.[1]?.replace(/,/g, "") ?? NaN)]),
      ),
    );
  /** The queue's groups, stepped through with N: thickness label → feet. */
  const queueLengths = async () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < 12; i += 1) {
      const label = queue().locator('[data-takeoff="queue-group"] > span').first();
      if ((await label.count()) > 0) {
        const text = (await label.textContent()) ?? "";
        const m = /^Walls · sheet A101 · (.+?) · (\d+) ft$/.exec(text);
        if (m) seen.set(m[1]!, Number(m[2]));
      }
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("n");
      await page.waitForTimeout(150);
    }
    return seen;
  };

  test("1. A101 with four wall groups (some runs held, one group all held) and three suggested windows", async () => {
    test.setTimeout(90_000);
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Queue windows lengths — Clinic", gcName: "ZZ-E2E Windows lengths GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    planId = plan.id;
    const { companyId } = plan;
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 1, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
    await prisma.planSheetProposal.create({
      data: { ingestJobId: ingest.id, planId, pageNumber: 1, proposedSheetNumber: "A101", proposedTitle: "FIRST FLOOR PLAN", proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
    });
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    const at = new Date();
    for (const g of GROUPS) {
      await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: g.inches, createdAt: at, source: "REMAINDER", runs: g.runs.map((r) => ({ ...r, thicknessFeet: g.inches / 12 })) } });
    }
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } });
    const held = await prisma.takeoffItem.create({ data: { companyId, jobId, name: HELD_ITEM, type: "LINEAR", colorHex: "#999999" }, select: { id: true } });
    for (const g of GROUPS) {
      for (const [i, r] of g.runs.entries()) {
        const isHeld = g.held.includes(i);
        await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: isHeld ? held.id : untyped.id, label: isHeld ? HELD_LABEL : "wall, untyped" } });
      }
    }
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 1, kind: WINDOWS_SUGGESTED, value: { windows: WINDOWS } } });
  });

  test("2. the panel lists the queue's groups at the queue's lengths: held runs left out of both, the all-held group in neither", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-takeoff="found-group"]')).toHaveCount(3, { timeout: 30_000 });
    const panel = await panelLengths();
    // 5" 28.8 ft (7.2 held), 12-1/8" 21.6 ft (7.2 held), 7-3/8" 57.6 ft; 9-3/4" all held.
    expect(panel).toEqual({ "5.02": 29, "12.16": 22, "7.36": 58 });
    const inQueue = await queueLengths();
    expect([...inQueue.values()].sort((a, b) => a - b)).toEqual(Object.values(panel).sort((a, b) => a - b));
    await page.screenshot({ path: path.join(SHOTS, "lengths-1440.png") });
  });

  test("3. after a reload, the same", async () => {
    await page.reload();
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-takeoff="found-group"]')).toHaveCount(3, { timeout: 30_000 });
    expect(await panelLengths()).toEqual({ "5.02": 29, "12.16": 22, "7.36": 58 });
    const inQueue = await queueLengths();
    expect([...inQueue.values()].sort((a, b) => a - b)).toEqual([22, 29, 58]);
  });

  /** Step the queue to the Windows item. */
  const toWindows = async () => {
    for (let i = 0; i < 12 && (await queue().locator('[data-takeoff="queue-windows"]').count()) === 0; i += 1) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("n");
      await page.waitForTimeout(150);
    }
    await expect(queue().locator('[data-takeoff="queue-windows-count"]')).toContainText("3 windows");
  };

  test("4. \"Not a window\" goes on the Undo stack: Undo puts the window back", async () => {
    await toWindows();
    await page.keyboard.press("d");
    await expect(queue().locator('[data-takeoff="queue-windows-count"]')).toContainText("2 windows");
    await expect(undo()).toHaveAttribute("title", /Undo: Not a window: W1 on A101/);
    await undo().click();
    await expect(queue().locator('[data-takeoff="queue-windows-count"]')).toContainText("3 windows");
  });

  test("5. Confirm 3, Undo, reload: not confirmed, no counts, no window items, and the windows are asked again", async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Enter");
    await expect.poll(windowCounts, { timeout: 30_000 }).toBe(2);
    expect(await windowItems()).toBe(2);
    await expect(undo()).toHaveAttribute("title", /Undo: Confirm 3 windows on A101/, { timeout: 30_000 });
    await expect(undo()).toBeEnabled();
    await undo().click();
    await expect.poll(windowCounts, { timeout: 30_000 }).toBe(0);
    expect(await windowItems()).toBe(0);
    await page.reload();
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await toWindows();
    expect(await windowCounts()).toBe(0);
    await page.screenshot({ path: path.join(SHOTS, "windows-undone-reloaded-1440.png") });
  });

  test("6. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
