import path from "node:path";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── SCALE SNAP ON BLUETOOTH AI101: OFFERED, ONE CLICK, NEVER SET BY ITSELF ──
 *
 * AI101 CONSTRUCTION PLAN (pages 6 and 7) read no scale: 18 dimensions agree on 1/8" within 1%,
 * but no single line is close enough to set it from, and the title block's scale is not in the
 * text layer. Now the plan set offers "Use 1/8" (from 18 dimensions)" on that sheet:
 *   - nothing is saved until it is pressed (the inventory stores it unconfirmed);
 *   - Confirm scales and "Use the printed scale on all" never take it;
 *   - pressing it saves 1/8" on that sheet alone.
 *
 * SKIPS unless REAL_PLAN_DIR holds the Bluetooth set, and the runner was started with
 * TAKEOFF_LOCAL_PLAN_DIR = REAL_PLAN_DIR, ALLOW_LOCAL_PLANS=1 and HOSTNAME=localhost.
 * One stand-in, named: the plan row is written with a `local:` file instead of an upload.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = "Bluetooth-office-TI-Kirkland-WA.pdf";

test.describe.configure({ mode: "serial" });

test.describe("scale snap on Bluetooth AI101", () => {
  test.skip(DIR === "" || !existsSync(path.join(DIR, SET)), "REAL_PLAN_DIR does not hold the Bluetooth set");
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let planId = "";
  let companyId = "";
  let aiWas = true;

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    if (companyId !== "") await prisma.companyAiSettings.update({ where: { companyId }, data: { aiEnabled: aiWas } }).catch(() => {});
    await page?.context().close();
  });

  const calibrated = async (n: number) => prisma.takeoffScaleCalibration.findFirst({ where: { page: { planId, pageNumber: n } }, select: { declaredDistanceFeet: true, x1: true, x2: true, note: true } });
  const fix = (n: number) => page.locator(`[data-takeoff="plan-set-fix"][data-page="${n}"]`);

  test("1. plan reading off, the set read: AI101 holds an unconfirmed 1/8\" snap and no scale", async () => {
    test.setTimeout(900_000);
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Scale snap — Bluetooth", gcName: "ZZ-E2E Scale snap GC" });
    await finishWizard(page, monitor, jobId);
    ({ companyId } = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } }));
    aiWas = (await prisma.companyAiSettings.findUnique({ where: { companyId }, select: { aiEnabled: true } }))?.aiEnabled ?? true;
    await prisma.companyAiSettings.upsert({ where: { companyId }, create: { companyId, aiEnabled: false }, update: { aiEnabled: false } });
    ({ id: planId } = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: `local:${SET}`, fileName: SET, revisionLabel: "Bid set" }, select: { id: true } }));
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expect.poll(async () => (await prisma.planIngestJob.findFirst({ where: { planId, stage: "PAGE_INVENTORY" }, select: { finishedAt: true } }))?.finishedAt != null, { timeout: 600_000, intervals: [5_000] }).toBe(true);
    const reading = await prisma.planSheetScaleReading.findFirst({ where: { planId, pageNumber: 6 }, select: { source: true, scaleName: true } });
    expect(reading).toEqual({ source: "DIMENSIONS_SNAP", scaleName: '1/8" = 1\'-0"' });
    expect(await calibrated(6), "an offer, never set by itself").toBeNull();
  });

  test("2. the plan set offers Use 1/8\" (from 18 dimensions) on AI101, and Confirm scales leaves it", async () => {
    test.setTimeout(180_000);
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expect(page.locator('[data-takeoff="plan-set"]')).toBeVisible({ timeout: 60_000 });
    await expect(fix(6).locator('[data-takeoff="plan-set-snap"]')).toHaveText('Use 1/8" (from 18 dimensions)', { timeout: 60_000 });
    await expect(page.locator('[data-takeoff="plan-set-printed-sheet"][data-page="6"]'), "not in Use the printed scale on all").toHaveCount(0);
    const confirm = page.getByRole("button", { name: /^Confirm \d+ scales?$/ });
    if (await confirm.isVisible()) {
      await confirm.click();
      await expect(page.locator('[data-takeoff="plan-set-message"]')).toBeVisible({ timeout: 60_000 });
    }
    expect(await calibrated(6), "Confirm scales never takes a snap").toBeNull();
  });

  test("3. one press saves 1/8\" on AI101 page 6 alone", async () => {
    test.setTimeout(120_000);
    await fix(6).locator('[data-takeoff="plan-set-snap"]').click();
    await expect(page.locator('[data-takeoff="plan-set-message"]')).toHaveText(/^1 scale confirmed/, { timeout: 60_000 });
    const saved = await calibrated(6);
    expect(saved).not.toBeNull();
    // 36" of paper at 1/8" = 288 ft across the page width.
    expect(Number(saved!.declaredDistanceFeet) / Math.abs(Number(saved!.x2) - Number(saved!.x1))).toBeCloseTo(288, 0);
    expect(saved!.note).toMatch(/^18 printed dimensions on this sheet agree on 1\/8" = 1'-0" within 1%/);
    expect(await calibrated(7), "page 7 still waits for its own press").toBeNull();
  });
});
