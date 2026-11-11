import path from "node:path";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── ONE SCALE QUESTION PER SET, ONLY THE FLOOR PLANS THE TAKEOFF NEEDS; CONFIRM WAITS FOR THE READ ──
 *
 * The accept-job walks (2026-11-10, plan reading off):
 *   Green Bay — the review queue carried 380 scale items, one per sheet its keyless titles
 *               called a plan;
 *   Topeka    — Confirm scales was pressed at 52 of 137 sheets read, the floor plans (74 on)
 *               were read after it, and the stepper called Scale done with 10 of 12 unscaled.
 * Now:
 *   1. Green Bay (plan comparison on, as a new company has it): once read, the queue holds ONE
 *      scale item ("Scales 0 of 1");
 *   2. Topeka: Confirm scales is off, saying how far the reading is, until every sheet is read;
 *   3. then Confirm, and the queue's one item, "Use the printed scale on all N sheets", scale the
 *      floor plans the takeoff needs, and the stepper's Scale is done.
 *
 * SKIPS unless REAL_PLAN_DIR holds both sets, and the runner was started with
 * TAKEOFF_LOCAL_PLAN_DIR = REAL_PLAN_DIR, ALLOW_LOCAL_PLANS=1 and HOSTNAME=localhost.
 * One stand-in, named: the plan row is written with a `local:` file instead of an upload.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const GREEN_BAY = "NG-Green-Bay-WI.pdf";
const TOPEKA = "Topeka-Senior-Villas.pdf";

test.describe.configure({ mode: "serial" });

test.describe("one scale question per set", () => {
  test.skip(DIR === "" || !existsSync(path.join(DIR, GREEN_BAY)) || !existsSync(path.join(DIR, TOPEKA)), "REAL_PLAN_DIR does not hold Green Bay and Topeka");
  let page: Page;
  let monitor: HealthMonitor;
  let companyId = "";
  let was: { aiEnabled: boolean; planCompareOn: boolean } | null = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    if (was !== null) {
      await prisma.companyAiSettings.update({ where: { companyId }, data: { aiEnabled: was.aiEnabled } }).catch(() => {});
      await prisma.company.update({ where: { id: companyId }, data: { planCompareOn: was.planCompareOn } }).catch(() => {});
    }
    await page?.context().close();
  });

  const queue = () => page.locator('[data-takeoff="review-queue"]');

  async function jobWith(file: string, name: string): Promise<{ jobId: string; planId: string }> {
    const jobId = await startJob(page, monitor, { name, gcName: `${name} GC` });
    await finishWizard(page, monitor, jobId);
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: `local:${file}`, fileName: file, revisionLabel: "Bid set" }, select: { id: true } });
    return { jobId, planId: plan.id };
  }
  /** Every page's text stored (a slow page can sit in its retry window after the rest are read). */
  const readDone = async (planId: string) => {
    const run = await prisma.planIngestJob.findFirst({ where: { planId, stage: "PAGE_INVENTORY" }, orderBy: { createdAt: "desc" }, select: { finishedAt: true, pageCount: true } });
    if (run === null) return false;
    if (run.finishedAt !== null) return true;
    return run.pageCount !== null && (await prisma.planSheetText.count({ where: { planId } })) >= run.pageCount;
  };

  test("1. plan reading off, plan comparison on (a new company's default)", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    companyId = (await prisma.user.findFirstOrThrow({ where: { email: PERSONAS.takeoff.email }, select: { companyId: true } })).companyId;
    was = {
      aiEnabled: (await prisma.companyAiSettings.findUnique({ where: { companyId }, select: { aiEnabled: true } }))?.aiEnabled ?? true,
      planCompareOn: (await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { planCompareOn: true } })).planCompareOn,
    };
    await prisma.companyAiSettings.upsert({ where: { companyId }, create: { companyId, aiEnabled: false }, update: { aiEnabled: false } });
    await prisma.company.update({ where: { id: companyId }, data: { planCompareOn: true, wholeSetTakeoffOn: true } });
  });

  test("2. Green Bay: once read, ONE scale item in the queue", async () => {
    test.setTimeout(1_200_000);
    const { jobId, planId } = await jobWith(GREEN_BAY, "ZZ-E2E Scale set — Green Bay");
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expect.poll(() => readDone(planId), { timeout: 900_000, intervals: [5_000] }).toBe(true);
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    const progress = queue().locator('[data-takeoff="review-queue-progress"]');
    await expect(progress).toContainText("Scales 0 of 1", { timeout: 30_000 });
    console.log(`[scale-set] Green Bay queue: ${await progress.innerText()} · ${await queue().locator('[data-takeoff="review-queue-left"]').innerText()}`);
  });

  test("3. Topeka: Confirm scales waits for the read, then the queue's one press scales the floor plans", async () => {
    test.setTimeout(1_800_000);
    const { jobId, planId } = await jobWith(TOPEKA, "ZZ-E2E Scale set — Topeka");
    await page.goto(`/jobs/${jobId}/takeoff`);
    const confirm = page.locator('[data-takeoff="confirm-scales"]');
    // While the set is read: off, and saying how far (the run is created a moment after the tab opens).
    const state = async () => `${(await confirm.innerText().catch(() => "")).trim()} [${(await confirm.isDisabled().catch(() => false)) ? "off" : "on"}]`;
    await expect
      .poll(
        async () => {
          await page.reload();
          return state();
        },
        { timeout: 120_000, intervals: [2_000] },
      )
      .toMatch(/^Reading the set \(\d+ of 137\)… \[off\]$/);
    console.log(`[scale-set] Topeka while reading: "${await state()}"`);
    await expect.poll(() => readDone(planId), { timeout: 900_000, intervals: [5_000] }).toBe(true);
    // The button waits for the inventory job itself, retries included.
    await expect
      .poll(
        async () => {
          await page.reload();
          return confirm.isEnabled();
        },
        { timeout: 900_000, intervals: [10_000] },
      )
      .toBe(true);
    await confirm.click();
    await expect(page.locator('[data-takeoff="plan-set-message"]')).toContainText(/scales? confirmed/, { timeout: 120_000 });
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    const all = queue().locator('[data-takeoff="review-queue-scale-all"]');
    const item = queue().locator('[data-takeoff="review-queue-item"]');
    for (let i = 0; i < 60 && (await all.count()) === 0; i += 1) {
      await page.keyboard.press("n");
      await page.waitForTimeout(150);
    }
    if ((await all.count()) > 0) {
      console.log(`[scale-set] Topeka scale item: "${await queue().locator('[data-takeoff="review-queue-scale-count"]').innerText()}" · "${await all.innerText()}"`);
      const oneClick = Number((await all.innerText()).match(/all (\d+) sheet/)?.[1] ?? "0");
      const before = await prisma.takeoffScaleCalibration.count({ where: { page: { plan: { jobId } } } });
      await all.click();
      // The press is a server action: wait for its scales to land before leaving the page.
      await expect.poll(() => prisma.takeoffScaleCalibration.count({ where: { page: { plan: { jobId } } } }), { timeout: 120_000 }).toBeGreaterThanOrEqual(before + oneClick);
      console.log(`[scale-set] Topeka: the one press set ${(await prisma.takeoffScaleCalibration.count({ where: { page: { plan: { jobId } } } })) - before} scales`);
    } else console.log(`[scale-set] Topeka: no scale item left after Confirm (${await item.getAttribute("data-kind")})`);
    const floors = await prisma.takeoffScaleCalibration.count({ where: { page: { plan: { jobId }, pageNumber: { in: [74, 75, 76] } } } });
    expect(floors, "the three floor plans have their scale").toBe(3);
    // What is left is only what no one press can scale: the item lists exactly those, each to set by hand.
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    for (let i = 0; i < 60 && (await queue().locator('[data-takeoff="review-queue-scale-count"]').count()) === 0 && !/Nothing left/.test(await queue().locator('[data-takeoff="review-queue-left"]').innerText()); i += 1) {
      await page.keyboard.press("n");
      await page.waitForTimeout(150);
    }
    const left = await queue().locator('[data-takeoff="review-queue-scale-sheet"]').count();
    console.log(`[scale-set] Topeka after the one press: ${left === 0 ? "no scale item" : `"${await queue().locator('[data-takeoff="review-queue-scale-count"]').innerText()}"`}`);
    if (left > 0) await expect(all, "nothing one press can scale is left").toHaveCount(0);
    await page.goto(`/jobs/${jobId}`);
    await expect(page.locator('[data-job-step="scale"]').first()).toHaveAttribute("data-state", left === 0 ? "done" : "current", { timeout: 60_000 });
  });
});
