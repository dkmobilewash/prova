import path from "node:path";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── ROUND 18 ON BLUETOOTH: THE PAGE ASKED FOR, AND TWO SHEETS WITH ONE NAME ──
 *
 * Bluetooth's set prints AI101 CONSTRUCTION PLAN twice (pages 6 and 7) and AI501 twice, and
 * nobody has scaled anything yet (its AI101 reads no scale). Found reproducing ROUND 18:
 *   - `?page=7` opened page 6: the takeoff page only knew pages with a scale, so an unscaled
 *     page asked for was "no sheet" and the workspace took its own choice;
 *   - the sheet picker offered "AI101 · CONSTRUCTION PLAN" twice, nothing to tell them apart.
 * Now the page asked for opens, and a repeated name carries its page. (The set's takeoff
 * counting the same sheet number once, and naming it "AI101 (page 6)", is `walls.test.ts`.)
 *
 * SKIPS unless REAL_PLAN_DIR holds the Bluetooth set, and the runner was started with
 * TAKEOFF_LOCAL_PLAN_DIR = REAL_PLAN_DIR, ALLOW_LOCAL_PLANS=1 and HOSTNAME=localhost.
 * One stand-in, named: the plan row is written with a `local:` file instead of an upload.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.R18_SET ?? "Bluetooth-office-TI-Kirkland-WA.pdf";

test.describe.configure({ mode: "serial" });

test.describe("ROUND 18 on Bluetooth: the page asked for, and two sheets with one name", () => {
  test.skip(DIR === "" || !existsSync(path.join(DIR, SET)), "REAL_PLAN_DIR does not hold the Bluetooth set");
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
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

  const picker = () => page.locator('[data-takeoff="sheet-picker"]').first();

  test("1. plan reading off, the set read, nothing scaled", async () => {
    test.setTimeout(900_000);
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Round 18 — Bluetooth", gcName: "ZZ-E2E Round 18 GC" });
    await finishWizard(page, monitor, jobId);
    ({ companyId } = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } }));
    aiWas = (await prisma.companyAiSettings.findUnique({ where: { companyId }, select: { aiEnabled: true } }))?.aiEnabled ?? true;
    await prisma.companyAiSettings.upsert({ where: { companyId }, create: { companyId, aiEnabled: false }, update: { aiEnabled: false } });
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: `local:${SET}`, fileName: SET, revisionLabel: "Bid set" }, select: { id: true } });
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expect.poll(async () => (await prisma.planIngestJob.findFirst({ where: { planId: plan.id, stage: "PAGE_INVENTORY" }, select: { finishedAt: true } }))?.finishedAt != null, { timeout: 600_000, intervals: [5_000] }).toBe(true);
    expect(await prisma.takeoffScaleCalibration.count({ where: { page: { planId: plan.id } } }), "nothing is scaled yet").toBe(0);
  });

  test("2. ?page=7 opens page 7, not the workspace's own choice", async () => {
    test.setTimeout(120_000);
    await page.goto(`/takeoff/${jobId}?page=7`);
    await expect(page.locator('[data-takeoff="find-walls"]')).toBeVisible({ timeout: 90_000 });
    await expect(picker()).toHaveValue("7", { timeout: 30_000 });
    await page.waitForTimeout(8_000);
    await expect(picker(), "it stays on the page asked for").toHaveValue("7");
  });

  test("3. the two AI101 sheets are told apart by their page, and no choice is repeated", async () => {
    const options = await picker().locator("option").allInnerTexts();
    const repeated = options.filter((o, i) => options.indexOf(o) !== i);
    console.log(`[r18] picker 6/7: ${JSON.stringify(options.slice(5, 7))}`);
    expect(repeated).toEqual([]);
    expect(options[5]).toBe("AI101 · CONSTRUCTION PLAN (page 6)");
    expect(options[6]).toBe("AI101 · CONSTRUCTION PLAN (page 7)");
  });
});
