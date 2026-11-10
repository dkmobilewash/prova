import path from "node:path";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";
import { SURE_FLOOR_PLAN } from "@/lib/takeoff/sureFloorPlans";

/**
 * ── WITH PLAN READING OFF, THE SCALE STEP OFFERS THE FLOOR PLANS ──
 *
 * Baker with plan reading off and plan comparison off, so no sheet is named. Before, the
 * plan set had no floor plan in it: "Confirm scales" saved the sheets the reader was sure of
 * (the ceiling plan A111 among them), the step called itself done, and A100/A101 had no
 * scale — Run takeoff stayed off on every floor plan (the new-customer walk, 2026-11-10).
 * Now the page inventory records which pages' own drawings say FLOOR PLAN, and:
 *   1. the Scale step lists A100 (p12) and A101 (p13) as its floor plans: not A111 (ceiling),
 *      nor G010's code plan, S2.0's foundation plan or T1.01's communications plan;
 *   2. "Use the printed scale" on A101 sets it, and Run takeoff there is on.
 *
 * SKIPS unless REAL_PLAN_DIR holds the Baker set, and the runner was started with
 * TAKEOFF_LOCAL_PLAN_DIR = REAL_PLAN_DIR, ALLOW_LOCAL_PLANS=1 and HOSTNAME=localhost.
 * One stand-in, named: the plan row is written with a `local:` file instead of an upload.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.SFP_SET ?? "2025.07.08_Baker_EOC_BID.pdf";
const PAGES = 65;
const A100 = 12;
const A101 = 13;
const A111 = 14;

test.describe.configure({ mode: "serial" });

test.describe("with plan reading off, the Scale step offers the floor plans", () => {
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

  const fix = (pageNumber: number) => page.locator(`[data-takeoff="plan-set-fix"][data-page="${pageNumber}"]`);

  test("1. plan reading and comparison off; the Baker set read by the inventory", async () => {
    test.setTimeout(900_000);
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Scale floor plans — Baker", gcName: "ZZ-E2E Scale floor plans GC" });
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
    // No sheet is named: no title, no proposal.
    expect(await prisma.planSheetProposal.count({ where: { planId: plan.id } })).toBe(0);
    const sure = await prisma.takeoffPlanTextRead.findMany({ where: { planId: plan.id, kind: SURE_FLOOR_PLAN }, select: { pageNumber: true, value: true } });
    const surePages = sure.filter((r) => (r.value as { sure?: boolean }).sure === true).map((r) => r.pageNumber).sort((a, b) => a - b);
    console.log(`[scale-floor-plans] sure floor plans: ${surePages.join(", ")}`);
    // A100 OVERALL FLOOR PLAN and A101 FLOOR PLAN; not A111 (ceiling), G010 (code plan), S2.0 (foundation), T1.01 (communications).
    expect(surePages).toEqual([A100, A101]);
  });

  test("2. the Scale step lists A100 and A101 as floor plans still to do, never the ceiling plan", async () => {
    await page.goto(`/jobs/${jobId}/takeoff`);
    const floors = page.locator('[data-takeoff="plan-set-group"][data-category="floor"] [data-takeoff="plan-set-row"]');
    await expect(floors.first()).toBeVisible({ timeout: 60_000 });
    const pages = (await floors.evaluateAll((rows) => rows.map((r) => Number(r.getAttribute("data-page"))))).sort((a, b) => a - b);
    console.log(`[scale-floor-plans] floor rows: ${pages.join(", ")}`);
    expect(pages).toEqual([A100, A101]);
    await expect(fix(A101)).toBeVisible();
  });

  test("3. the printed scale on A101, and Run takeoff there is on", async () => {
    test.setTimeout(180_000);
    await fix(A101).getByRole("button", { name: /Use the printed scale/ }).click();
    await expect(page.locator('[data-takeoff="plan-set-message"]')).toContainText(/1 scale confirmed/, { timeout: 60_000 });
    await expect
      .poll(() => prisma.takeoffScaleCalibration.count({ where: { page: { pageNumber: A101, plan: { jobId } } } }), { timeout: 30_000 })
      .toBe(1);
    await page.goto(`/takeoff/${jobId}?page=${A101}`);
    await expect(page.locator('[data-takeoff="find-walls"]')).toBeEnabled({ timeout: 120_000 });
  });
});
