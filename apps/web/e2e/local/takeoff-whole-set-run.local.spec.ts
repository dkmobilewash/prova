import path from "node:path";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── RUN TAKEOFF TAKES OFF THE SET'S FLOOR PLANS, THE OPEN SHEET FIRST ──
 *
 * Plan reading off and plan comparison off, so nothing names a sheet. The accept-job walks
 * (2026-11-10) found Run takeoff posted only the sheet on screen, and that the workspace opened
 * Baker on A100, the OVERALL plan, rather than A101. Now:
 *   Baker   — the workspace opens on A101 by itself; Run takeoff posts A101, and nothing of
 *             A100 (the same floor, overall), A111 (the ceiling plan Confirm scales scaled) or
 *             the structural sheets Confirm scaled;
 *   Topeka  — Run takeoff on the first floor plan posts it at once and then the other floor
 *             plans of the set, counted as they land, until the set is on the job.
 *
 * SKIPS unless REAL_PLAN_DIR holds both sets, and the runner was started with
 * TAKEOFF_LOCAL_PLAN_DIR = REAL_PLAN_DIR, ALLOW_LOCAL_PLANS=1 and HOSTNAME=localhost.
 * One stand-in, named: the plan row is written with a `local:` file instead of an upload.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const BAKER = { file: "2025.07.08_Baker_EOC_BID.pdf", pages: 65 };
const TOPEKA = { file: "Topeka-Senior-Villas.pdf", pages: 137 };

test.describe.configure({ mode: "serial" });

test.describe("Run takeoff takes off the set's floor plans", () => {
  test.skip(DIR === "" || !existsSync(path.join(DIR, BAKER.file)) || !existsSync(path.join(DIR, TOPEKA.file)), "REAL_PLAN_DIR does not hold Baker and Topeka");
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

  const run = () => page.locator('[data-takeoff="find-walls"]');
  const onSheet = () => page.locator('[data-takeoff="sheet-picker"]').first().inputValue();
  const postedPages = async (jobId: string) =>
    (await prisma.takeoffMeasurement.findMany({ where: { kind: "LINEAR", source: "DETECTED", page: { plan: { jobId } } }, select: { page: { select: { pageNumber: true } } }, distinct: ["pageId"] })).map((m) => m.page.pageNumber).sort((a, b) => a - b);

  /** A job with the set, read by the inventory, and Confirm scales pressed once every sheet is read. */
  async function jobWith(set: { file: string; pages: number }, name: string): Promise<string> {
    const jobId = await startJob(page, monitor, { name, gcName: `${name} GC` });
    await finishWizard(page, monitor, jobId);
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: `local:${set.file}`, fileName: set.file, revisionLabel: "Bid set" }, select: { id: true } });
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expect.poll(() => prisma.planSheetText.count({ where: { planId: plan.id } }), { timeout: 900_000, intervals: [5_000] }).toBe(set.pages);
    await page.goto(`/jobs/${jobId}/takeoff`);
    await page.locator('[data-takeoff="confirm-scales"]').click();
    await expect(page.locator('[data-takeoff="plan-set-message"]')).toContainText(/scales? confirmed/, { timeout: 120_000 });
    // And each floor plan the reader is not sure of, at its printed scale.
    await page.goto(`/jobs/${jobId}/takeoff`);
    const all = page.locator('[data-takeoff="plan-set-printed-all"]');
    if (await all.isVisible().catch(() => false)) {
      await all.click();
      await page.locator('[data-takeoff="plan-set-printed-apply"]').click();
      await expect(page.locator('[data-takeoff="plan-set-message"]')).toContainText(/confirmed/, { timeout: 120_000 });
    }
    return jobId;
  }

  test("1. plan reading and comparison off", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    const job = await prisma.job.findFirst({ where: { company: { users: { some: { email: PERSONAS.takeoff.email } } } }, select: { companyId: true } });
    companyId = job?.companyId ?? (await prisma.user.findFirstOrThrow({ where: { email: PERSONAS.takeoff.email }, select: { companyId: true } })).companyId;
    was = {
      aiEnabled: (await prisma.companyAiSettings.findUnique({ where: { companyId }, select: { aiEnabled: true } }))?.aiEnabled ?? true,
      planCompareOn: (await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { planCompareOn: true } })).planCompareOn,
    };
    await prisma.companyAiSettings.upsert({ where: { companyId }, create: { companyId, aiEnabled: false }, update: { aiEnabled: false } });
    await prisma.company.update({ where: { id: companyId }, data: { planCompareOn: false, wholeSetTakeoffOn: true } });
  });

  test("2. Baker opens on A101, and Run takeoff posts A101 alone", async () => {
    test.setTimeout(1_200_000);
    const jobId = await jobWith(BAKER, "ZZ-E2E Whole set — Baker");
    await page.goto(`/takeoff/${jobId}`);
    await expect(run()).toBeEnabled({ timeout: 120_000 });
    expect(await onSheet(), "the workspace opens on A101 (page 13), not A100 OVERALL (12)").toBe("13");
    await run().click();
    await expect.poll(() => postedPages(jobId), { timeout: 120_000, intervals: [2_000] }).toContain(13);
    await page.waitForTimeout(15_000);
    const posted = await postedPages(jobId);
    console.log(`[whole-set] Baker posted pages: ${posted.join(", ")}`);
    expect(posted).toEqual([13]);
  });

  test("3. Topeka: the open floor plan first, then the set's others, counted as they land", async () => {
    test.setTimeout(1_800_000);
    const jobId = await jobWith(TOPEKA, "ZZ-E2E Whole set — Topeka");
    await page.goto(`/takeoff/${jobId}?page=74`);
    await expect(run()).toBeEnabled({ timeout: 120_000 });
    const t0 = Date.now();
    await run().click();
    await expect.poll(() => postedPages(jobId), { timeout: 120_000, intervals: [1_000] }).toContain(74);
    console.log(`[whole-set] Topeka p74 on the job ${Math.round((Date.now() - t0) / 1000)} s after the press`);
    const progress = page.locator('[data-takeoff="run-set-progress"]');
    await expect(progress).toBeVisible({ timeout: 60_000 });
    console.log(`[whole-set] progress: ${await progress.innerText()}`);
    await expect(progress).toContainText(/all \d+ floor plans of the set are on the job/, { timeout: 900_000 });
    const posted = await postedPages(jobId);
    console.log(`[whole-set] Topeka posted pages after ${Math.round((Date.now() - t0) / 1000)} s: ${posted.join(", ")} · ${await progress.innerText()}`);
    expect(posted).toEqual(expect.arrayContaining([74, 75, 76]));
  });
});
