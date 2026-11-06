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
 * ── RUN TAKEOFF PUTS THE WALLS ON THE JOB (new-customer run v2, M3) ──
 *
 * On a new job every scaled sheet has its walls stored (saving a scale finds
 * them) and nothing on the job. The workspace's Run takeoff used to find them
 * again in the browser and add nothing. Now it posts the sheet's stored walls
 * by type, says so, and a second press adds nothing more.
 *
 * The stored walls are SEEDED, in the shape detection writes, because CI
 * cannot run detection on a stubbed upload — and seeded AFTER the press, as
 * walk v6 met it: the scale saved at 15:25:06, the finder done at 15:25:48,
 * and a press in between used to post nothing and say nothing. The ROOMS
 * company, as in wall-heights.spec.ts.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/run-takeoff-posts");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };

test.describe("Run takeoff puts the sheet's walls on the job", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let pageId = "";
  let calibrationId = "";

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

  const onJob = () => prisma.takeoffMeasurement.count({ where: { pageId, kind: "LINEAR", source: "DETECTED" } });

  test("1. a scaled sheet with its walls stored and none on the job", async () => {
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Run takeoff posts — Bungalow", gcName: "ZZ-E2E Run takeoff GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    pageId = sheet.id;
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    calibrationId = calibration.id;
    expect(await onJob()).toBe(0);
  });

  test("2. Run takeoff: the walls are on the job, and the panel says so", async () => {
    await page.goto(`/takeoff/${jobId}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    const run = page.locator('[data-takeoff="find-walls"]');
    await expect(run).toBeEnabled({ timeout: 60_000 });
    await run.click();
    // The finder the scale started has not stored the walls yet: it says so and waits.
    await expect(page.locator('[data-takeoff="posted-note"]')).toHaveText(/^Putting the walls on the job as soon as this sheet’s walls are stored/, { timeout: 180_000 });
    expect(await onJob()).toBe(0);
    await prisma.takeoffWallProposal.create({
      data: { pageId, calibrationId, thicknessInches: 4.875, source: "REMAINDER", runs: [{ x1: 0.2, y1: 0.3, x2: 0.5, y2: 0.3, thicknessFeet: 0.40625 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.45, thicknessFeet: 0.40625 }] },
    });
    await expect(page.locator('[data-takeoff="posted-note"]')).toHaveText("Put on the job: on the job by type: none typed; untyped 65 ft. Untyped walls wait in Review.", { timeout: 30_000 });
    expect(await onJob()).toBe(2);
    expect(await prisma.takeoffMeasurement.count({ where: { pageId, item: { name: "Walls — untyped" } } })).toBe(2);
    await page.screenshot({ path: path.join(SHOTS, "run-takeoff-posted-1440.png") });
  });

  /** The panel's groups, by thickness: what the queue and a reload must agree with. */
  const groups = async () => (await page.locator('[data-takeoff="found-group"]').evaluateAll((rows) => rows.map((r) => r.getAttribute("data-inches")))).sort();

  test("2b. ONE GROUPING: the panel shows the stored group the queue reads, not its own find, and keeps it on a reload", async () => {
    // Chrome on Baker: one 7-3/8" 114 ft group here, C8B 117 ft in the queue, and gone on reload.
    await expect.poll(groups, { timeout: 30_000 }).toEqual(["4.875"]);
    await page.reload();
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect.poll(groups, { timeout: 30_000 }).toEqual(["4.875"]);
  });

  test("3. pressed again: nothing more goes on the job", async () => {
    const run = page.locator('[data-takeoff="find-walls"]');
    await expect(run).toBeEnabled({ timeout: 60_000 });
    await run.click();
    await expect(run).toHaveText("Run takeoff", { timeout: 180_000 });
    await page.waitForTimeout(1_000);
    expect(await onJob()).toBe(2);
    // Pressed with the walls stored: the stored group again, not a find of the sheet's own lines.
    expect(await groups()).toEqual(["4.875"]);
  });

  test("4. the stepper is past Takeoff", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expect(page.locator('[data-job-step="takeoff"]')).toHaveAttribute("data-state", "done");
  });

  test("5. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
