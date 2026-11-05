import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── THE PLANS AND SCALE STEPS (guided flow, Phase 2) ──
 *
 * After upload the set is shown sorted — floor plans, then the rest, the cover
 * last — each sheet with the scale the reader stored and how sure it is. One
 * Confirm scales saves every sure one; the floor plans it is not sure of are
 * listed with a one-click fix. The stepper's Scale step is done only when every
 * floor plan has a scale.
 *
 * THE INVENTORY AND THE SCALE READINGS ARE SEEDED, because in CI the upload is
 * stubbed and the reader cannot fetch the file (`plan-ingest.spec.ts` says why).
 * The rows are the shapes the reader writes: a DIMENSIONS reading is sure, a
 * CAPTION reading is the printed scale with nothing confirming it, and a sheet
 * with only a decline reason has none. Titles are invented.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/plan-set-scales");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const QUARTER = '1/4" = 1\'-0"';
// 36in wide: at 1/4" the whole width is 144 ft, half of it 72 ft.
const WIDTH_PT = 2592;

test.describe("the plan set and its scales", () => {
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

  const panel = () => page.locator('[data-takeoff="plan-set"]');
  const row = (pageNumber: number) => panel().locator(`[data-takeoff="plan-set-row"][data-page="${pageNumber}"]`);
  const fix = (pageNumber: number) => panel().locator(`[data-takeoff="plan-set-fix"][data-page="${pageNumber}"]`);

  test("1. a job with a plan set, read: five sheets, three of them floor plans", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Plan set — Three floors", gcName: "ZZ-E2E Plan set GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    planId = plan.id;
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId: plan.companyId, stage: "TITLE_BLOCK", pageCount: 5, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    const sheets: [number, string, string, string][] = [
      [1, "A101", "FIRST FLOOR PLAN", "PLAN"],
      [2, "A102", "SECOND FLOOR PLAN", "PLAN"],
      [3, "A103", "THIRD FLOOR PLAN", "PLAN"],
      [4, "G001", "COVER SHEET", "COVER"],
      [5, "A201", "EXTERIOR ELEVATIONS", "ELEVATION"],
    ];
    for (const [pageNumber, number, title, pageType] of sheets) {
      await prisma.planSheetText.create({ data: { planId, pageNumber, hasTextLayer: true, widthPt: WIDTH_PT, heightPt: 1728 } });
      await prisma.planSheetProposal.create({
        data: { ingestJobId: ingest.id, planId, pageNumber, proposedSheetNumber: number, proposedTitle: title, proposedPageType: pageType, proposedScale: QUARTER, proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
      });
    }
    // Page 1: read off its dimensions, which agreed. Page 2: the title block only.
    await prisma.planSheetScaleReading.create({
      data: { planId, pageNumber: 1, scaleName: QUARTER, source: "DIMENSIONS", x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.5, declaredDistanceFeet: "72", declaredText: "72'-0\"", agreedText: "72'-0\"\n24'-0\"\n12'-6\"", consideredCount: 4, inheritedError: 0.002 },
    });
    await prisma.planSheetScaleReading.create({
      data: { planId, pageNumber: 2, scaleName: QUARTER, source: "CAPTION", x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "144", declaredText: QUARTER, consideredCount: 1 },
    });
    // Page 3: nothing read.
    await prisma.planSheetScaleReading.create({ data: { planId, pageNumber: 3, consideredCount: 1, declineReason: "only 1 printed dimension could be read" } });
  });

  test("2. sorted: floor plans first, the cover last, each with its scale and how sure", async () => {
    // Test 1 ended on this very page, so a goto with only a #hash added would
    // not load it again: reload, so it is rendered from the rows just seeded.
    await page.goto(`/jobs/${jobId}/takeoff#plan-set`);
    await page.reload();
    await expectHealthy(page, "the plan set", { monitor });
    await expect(panel()).toBeVisible();
    await expect(panel().locator('[data-takeoff="plan-set-summary"]')).toHaveText(/^5 sheets · 0 of 3 floor plans scaled/);
    expect(await panel().locator('[data-takeoff="plan-set-group"]').evaluateAll((g) => g.map((n) => n.getAttribute("data-category")))).toEqual(["floor", "elevations", "cover"]);
    expect(await panel().locator('[data-takeoff="plan-set-group"][data-category="floor"] [data-takeoff="plan-set-row"]').evaluateAll((r) => r.map((n) => n.getAttribute("data-page")))).toEqual(["1", "2", "3"]);
    await expect(row(1)).toHaveAttribute("data-confidence", "high");
    await expect(row(1)).toContainText("Sure");
    await expect(row(2)).toContainText("Printed only");
    await expect(row(3)).toContainText("No scale");
    // The ones to look at, with their fixes: the printed scale offered only where it is all there is.
    await expect(fix(2).getByRole("button", { name: `Use the printed scale ${QUARTER}` })).toBeVisible();
    await expect(fix(3).getByRole("button")).toHaveCount(0);
    await expect(fix(3).getByRole("link", { name: /Set it by two clicks/ })).toHaveAttribute("href", `/takeoff/${jobId}?page=3&open=scale`);
    await expect(fix(1)).toHaveCount(0);
    await panel().screenshot({ path: path.join(SHOTS, "plan-set-before.png") });
  });

  test("3. the stepper's Scale step lands here, and is not done", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expect(page.locator('[data-job-step="scale"]')).toHaveAttribute("data-state", "current");
    await expect(page.locator("[data-job-next]")).toHaveText("Next: Confirm the scales");
    await page.locator("[data-job-next]").click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff#plan-set`));
    await expect(panel()).toBeVisible();
  });

  test("4. Confirm scales saves the sure one, as a hand-set scale would be", async () => {
    await panel().locator('[data-takeoff="confirm-scales"]').click();
    await expect(panel().locator('[data-takeoff="plan-set-message"]')).toHaveText("1 scale confirmed.");
    await expect(row(1)).toHaveAttribute("data-confidence", "set");
    await expect(panel().locator('[data-takeoff="plan-set-summary"]')).toHaveText(/1 of 3 floor plans scaled/);
    const saved = await prisma.takeoffScaleCalibration.findMany({ where: { page: { planId } }, select: { declaredDistanceFeet: true, x1: true, x2: true, note: true, page: { select: { pageNumber: true } } } });
    expect(saved.map((c) => [c.page.pageNumber, Number(c.declaredDistanceFeet), c.x1, c.x2])).toEqual([[1, 72, 0.2, 0.7]]);
    expect(saved[0]!.note).toMatch(/^Matched 3 printed dimensions .*Confirmed with Confirm scales\.$/);
    await expect(panel().locator('[data-takeoff="confirm-scales"]'), "nothing sure is left to confirm").toBeDisabled();
  });

  test("5. the printed-scale fix, in one click", async () => {
    await fix(2).getByRole("button", { name: /Use the printed scale/ }).click();
    await expect(row(2)).toHaveAttribute("data-confidence", "set");
    await expect(fix(2)).toHaveCount(0);
    const note = (await prisma.takeoffScaleCalibration.findFirstOrThrow({ where: { page: { planId, pageNumber: 2 } }, select: { note: true } })).note;
    expect(note).toMatch(/^From the 1\/4" = 1'-0" printed on this sheet/);
    await panel().screenshot({ path: path.join(SHOTS, "plan-set-after.png") });
  });

  test("6. the two-click fix opens the workspace with Set scale armed", async () => {
    const [tab] = await Promise.all([page.context().waitForEvent("page"), fix(3).getByRole("link", { name: /Set it by two clicks/ }).click()]);
    await tab.waitForURL(new RegExp(`/takeoff/${jobId}\\?page=3&open=scale`));
    await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(tab.getByRole("button", { name: "Set scale", exact: true })).toHaveAttribute("aria-pressed", "true");
    await tab.close();
  });

  test("7. the Scale step waits for the LAST floor plan, and then is done", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expect(page.locator('[data-job-step="scale"]')).toHaveAttribute("data-state", "current");
    await expect(page.locator("[data-job-next]")).toHaveText("Next: Scale 1 more floor plan");
    // Page 3 set by hand, as the two-click fix would (the PDF here has one page to click on).
    const page3 = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 3 } });
    await prisma.takeoffScaleCalibration.create({ data: { pageId: page3.id, x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.5, declaredDistanceFeet: "72" } });
    await page.reload();
    await expect(page.locator('[data-job-step="scale"]')).toHaveAttribute("data-state", "done");
    await expect(page.locator('[data-job-step="takeoff"]')).toHaveAttribute("data-state", "current");
  });

  test("8. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
