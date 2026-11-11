import path from "node:path";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── RUN TAKEOFF ON BAKER, PLAN READING OFF: WALLS STORED, AND NO PRESS ON A SHEET ABOUT TO BE REFUSED ──
 *
 * The "hang" (the fourth's walk, 22:10Z, and the third's, 2026-11-10): the workspace opened
 * on A111, the reflected ceiling plan, which "Confirm scales" had scaled. For the second or
 * so before the sheet's drawing captions were read, Run takeoff was ON; the walk pressed it,
 * the find began on the ceiling plan, the verdict then turned the button off and moved the
 * workspace to the floor plan, and the find was dropped with nothing posted. The walk then
 * waited 25 minutes for walls. Profiled: the page was idle the whole time.
 *
 *   1. plan reading off, the set read, Confirm scales (A111 among them) and A101's printed scale;
 *   2. A111 asked for by URL: Run takeoff is never ON while the sheet is still being read
 *      (sampled every 50 ms), and ends off with the ceiling-plan reason;
 *   3. A101: Run takeoff pressed, walls stored within 60 s.
 *
 * SKIPS unless REAL_PLAN_DIR holds the Baker set, and the runner was started with
 * TAKEOFF_LOCAL_PLAN_DIR = REAL_PLAN_DIR, ALLOW_LOCAL_PLANS=1 and HOSTNAME=localhost.
 * One stand-in, named: the plan row is written with a `local:` file instead of an upload.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.RTB_SET ?? "2025.07.08_Baker_EOC_BID.pdf";
const PAGES = 65;
const A101 = 13;
const A111 = 14;

test.describe.configure({ mode: "serial" });

test.describe("Run takeoff on Baker with plan reading off", () => {
  test.skip(DIR === "" || !existsSync(path.join(DIR, SET)), "REAL_PLAN_DIR does not hold the Baker set");
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let companyId = "";
  let was: { aiEnabled: boolean; planCompareOn: boolean } | null = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    // The persona's company as it was.
    if (was !== null) {
      await prisma.companyAiSettings.update({ where: { companyId }, data: { aiEnabled: was.aiEnabled } }).catch(() => {});
      await prisma.company.update({ where: { id: companyId }, data: { planCompareOn: was.planCompareOn } }).catch(() => {});
    }
    await page?.context().close();
  });

  const run = () => page.locator('[data-takeoff="find-walls"]');
  const scaled = (pageNumber: number) => prisma.takeoffScaleCalibration.count({ where: { page: { pageNumber, plan: { jobId } } } });

  test("1. plan reading off; the set read; Confirm scales, and A101's printed scale", async () => {
    test.setTimeout(900_000);
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Run takeoff — Baker", gcName: "ZZ-E2E Run takeoff GC" });
    await finishWizard(page, monitor, jobId);
    ({ companyId } = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } }));
    was = {
      aiEnabled: (await prisma.companyAiSettings.findUnique({ where: { companyId }, select: { aiEnabled: true } }))?.aiEnabled ?? true,
      planCompareOn: (await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { planCompareOn: true } })).planCompareOn,
    };
    await prisma.companyAiSettings.upsert({ where: { companyId }, create: { companyId, aiEnabled: false }, update: { aiEnabled: false } });
    await prisma.company.update({ where: { id: companyId }, data: { planCompareOn: false } });
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: `local:${SET}`, fileName: SET, revisionLabel: "Bid set" }, select: { id: true } });
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expect.poll(() => prisma.planSheetText.count({ where: { planId: plan.id } }), { timeout: 600_000, intervals: [5_000] }).toBe(PAGES);
    await page.goto(`/jobs/${jobId}/takeoff`);
    // As a customer does: Confirm scales (the sheets the reader is sure of — A111 is one), then A101's own.
    await page.locator('[data-takeoff="confirm-scales"]').click();
    await expect(page.locator('[data-takeoff="plan-set-message"]')).toContainText(/scales? confirmed/, { timeout: 60_000 });
    await page.locator(`[data-takeoff="plan-set-fix"][data-page="${A101}"]`).getByRole("button", { name: /Use the printed scale/ }).click();
    await expect.poll(() => scaled(A101), { timeout: 30_000 }).toBe(1);
    expect(await scaled(A111), "Confirm scales scaled the ceiling plan, the sheet the hang opened on").toBe(1);
  });

  test("2. on A111 Run takeoff is never on while the sheet is still being read, and ends off", async () => {
    test.setTimeout(120_000);
    // Sampled from the page itself from the first moment, every 50 ms for 10 s.
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __runSeen: string[] }).__runSeen = seen;
      const t0 = performance.now();
      const tick = () => {
        const b = document.querySelector('[data-takeoff="find-walls"]') as HTMLButtonElement | null;
        if (b) seen.push(`${Math.round(performance.now() - t0)}:${b.disabled ? "off" : "ON"}:${b.title}`);
        if (performance.now() - t0 < 10_000) setTimeout(tick, 50);
      };
      tick();
    });
    await page.goto(`/takeoff/${jobId}?page=${A111}`);
    await expect(run()).toHaveAttribute("title", /reflected ceiling plan/, { timeout: 60_000 });
    await page.waitForTimeout(10_000);
    const seen = await page.evaluate(() => (window as unknown as { __runSeen: string[] }).__runSeen);
    const on = seen.filter((s) => s.includes(":ON:"));
    console.log(`[run-baker] A111: ${seen.length} samples; first ${seen.slice(0, 3).join(" | ")}; ON ${on.length}`);
    expect(seen.length, "the sampler saw the button").toBeGreaterThan(20);
    expect(on, "Run takeoff was ON on the ceiling plan before its verdict").toEqual([]);
  });

  test("3. on A101 Run takeoff, pressed, stores walls within 60 s", async () => {
    test.setTimeout(180_000);
    await page.goto(`/takeoff/${jobId}?page=${A101}`);
    await expect(run()).toBeEnabled({ timeout: 60_000 });
    await run().click();
    const t0 = Date.now();
    await expect
      .poll(() => prisma.takeoffMeasurement.count({ where: { page: { pageNumber: A101, plan: { jobId } } } }), { timeout: 60_000, intervals: [1_000] })
      .toBeGreaterThan(0);
    console.log(`[run-baker] A101: walls stored ${Math.round((Date.now() - t0) / 1000)} s after the press`);
  });
});
