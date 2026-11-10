import path from "node:path";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── "RUN THE TAKEOFF" NEVER OPENS ON A SHEET WHERE RUN TAKEOFF IS OFF ──
 *
 * Baker with plan reading off, as a new customer has it: no title block is read by a
 * model, so the workspace's own choice of sheet can be A111, the reflected ceiling plan
 * (page 14), where Run takeoff switches itself off once the drawing captions are read —
 * the new-customer walk sat there, 2026-11-10. Here the workspace is made to choose
 * page 14 by the same rule it uses (the sheet a person last measured on), and:
 *   1. opened with no sheet asked for, it moves itself to a sure floor plan and says so,
 *      and Run takeoff there is not refused for having no floor plan;
 *   2. opened with `?page=14` — a sheet somebody asked for — it stays.
 * ("Pick your floor plan", for a set where no sheet is sure, is `floorPlanToOpen`'s null:
 * unit-tested; no real set has none.)
 *
 * SKIPS unless REAL_PLAN_DIR holds OFP_SET (Baker), and the runner was started with
 * TAKEOFF_LOCAL_PLAN_DIR = REAL_PLAN_DIR, ALLOW_LOCAL_PLANS=1 and HOSTNAME=localhost.
 * One stand-in, named: the plan row is written with a `local:` file instead of an upload.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.OFP_SET ?? "2025.07.08_Baker_EOC_BID.pdf";
const RCP_PAGE = 14;
const PAGES = 65;

test.describe.configure({ mode: "serial" });

test.describe("Run the takeoff opens on a floor plan, never where Run takeoff is off", () => {
  test.skip(DIR === "" || !existsSync(path.join(DIR, SET)), "REAL_PLAN_DIR does not hold the Baker set");
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let companyId = "";
  let aiWasOn = true;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    // The persona's company as it was.
    if (companyId !== "" && aiWasOn) await prisma.companyAiSettings.update({ where: { companyId }, data: { aiEnabled: true } }).catch(() => {});
    await page?.context().close();
  });

  const run = () => page.locator('[data-takeoff="find-walls"]');
  const hunt = () => page.locator('[data-takeoff="floor-plan-hunt"]');
  const onSheet = () => page.locator('[data-takeoff="sheet-picker"]').first().inputValue();

  test("1. plan reading off, the Baker set read, a count left on the ceiling plan", async () => {
    test.setTimeout(900_000);
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Opens floor plan — Baker", gcName: "ZZ-E2E Opens floor plan GC" });
    await finishWizard(page, monitor, jobId);
    ({ companyId } = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } }));
    aiWasOn = (await prisma.companyAiSettings.findUnique({ where: { companyId }, select: { aiEnabled: true } }))?.aiEnabled ?? true;
    await prisma.companyAiSettings.upsert({ where: { companyId }, create: { companyId, aiEnabled: false }, update: { aiEnabled: false } });
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: `local:${SET}`, fileName: SET, revisionLabel: "Bid set" }, select: { id: true } });
    // The page inventory runs by itself and calls no model.
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expect.poll(() => prisma.planSheetText.count({ where: { planId: plan.id } }), { timeout: 600_000, intervals: [5_000] }).toBe(PAGES);
    // "The sheet a person last measured on": a count on A111, which needs no scale.
    const sheet = await prisma.takeoffPlanPage.upsert({ where: { planId_pageNumber: { planId: plan.id, pageNumber: RCP_PAGE } }, create: { planId: plan.id, pageNumber: RCP_PAGE }, update: {} });
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "ZZ-E2E fixtures", type: "COUNT", colorHex: "#888888" }, select: { id: true } });
    await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, itemId: item.id, kind: "COUNT", source: "MANUAL", xs: [0.5], ys: [0.3], label: "ZZ-E2E light" } });
  });

  test("2. opened with no sheet asked for, it leaves the ceiling plan for a floor plan, and says so", async () => {
    test.setTimeout(300_000);
    await page.goto(`/takeoff/${jobId}`);
    await expect(run()).toBeVisible({ timeout: 120_000 });
    // It opened on A111 — the rule this guards — and moves itself off it.
    await expect(hunt()).toHaveAttribute("data-state", "moved", { timeout: 180_000 });
    const said = (await hunt().innerText()).replace(/\s+/g, " ");
    console.log(`[opens-floor-plan] ${said} (now page ${await onSheet()})`);
    expect(said).toMatch(/reflected ceiling plan/);
    expect(Number(await onSheet())).not.toBe(RCP_PAGE);
    // Wherever it landed, Run takeoff is not off for want of a floor plan.
    await expect.poll(async () => (await run().getAttribute("title")) ?? "", { timeout: 60_000 }).not.toMatch(/no floor plan here to measure/);
  });

  test("3. a sheet somebody asked for stays, even the ceiling plan", async () => {
    await page.goto(`/takeoff/${jobId}?page=${RCP_PAGE}`);
    await expect(run()).toHaveAttribute("title", /reflected ceiling plan/, { timeout: 120_000 });
    await page.waitForTimeout(5_000);
    expect(Number(await onSheet())).toBe(RCP_PAGE);
    await expect(hunt()).toHaveCount(0);
  });
});
