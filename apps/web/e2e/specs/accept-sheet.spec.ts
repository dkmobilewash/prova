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
 * ── "ACCEPT ALL SUGGESTIONS ON THIS SHEET" ──
 *
 * One press confirms every group on the sheet whose type the drawing gives —
 * a printed tag or the legend — each with its height, writes their estimate
 * lines, and leaves the rest in the queue. One line says what went in, with
 * Undo, which puts every run back on "Walls — untyped" and the lines with it.
 *
 * fast-confirm.spec.ts's fixture: ZF1 and ZF2 tagged on A101, and a third group
 * nothing names, which the press must leave.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/accept-sheet");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const NOTE = `Height 15 ft (MEDIUM): "TO DECK"; A301 prints T.O. DECK 15' 0"`;
// 1 page width = 144 ft.
const GROUPS = {
  one: { tag: "ZF1", inches: 4.875, runs: [{ x1: 0.1, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.5 }] },
  two: { tag: "ZF2", inches: 3.625, runs: [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6 }] },
  three: { tag: null, inches: 6.125, runs: [{ x1: 0.6, y1: 0.2, x2: 0.7, y2: 0.2 }] },
};

test.describe("accepting a sheet's drawn suggestions in one press", () => {
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
  const left = () => queue().locator('[data-takeoff="review-queue-left"]');
  const acceptAll = () => queue().locator('[data-takeoff="review-queue-accept-sheet"]');
  const untypedRuns = async () => (await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, name: "Walls — untyped" }, select: { _count: { select: { measurements: true } } } }))._count.measurements;
  const linesOf = (code: string) => prisma.jobLineItem.count({ where: { jobId, isDeleted: false, takeoffItem: { wallType: { code } } } });

  test("1. three untyped wall groups on A101, two of them tagged", async () => {
    test.setTimeout(90_000);
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Accept sheet — Clinic", gcName: "ZZ-E2E Accept sheet GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    planId = plan.id;
    const companyId = plan.companyId;

    // The sheet is A101, and the set's legend defines both codes.
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 1, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
    await prisma.planSheetProposal.create({
      data: { ingestJobId: ingest.id, planId, pageNumber: 1, proposedSheetNumber: "A101", proposedTitle: "FIRST FLOOR PLAN", proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
    });
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: ["ZF1", "ZF2"], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    // ZF1 as the legend read adds it, with its height; ZF2 with none.
    if ((await prisma.wallType.count({ where: { companyId, code: "ZF1" } })) === 0) {
      await prisma.wallType.create({ data: { companyId, code: "ZF1", name: "ZZ-E2E partition to deck", defaultHeightFt: "15", sides: 2, notes: `Read off sheet A001 of the plan set. Check against the drawing before pricing.\n${NOTE}` } });
    }
    if ((await prisma.wallType.count({ where: { companyId, code: "ZF2" } })) === 0) {
      await prisma.wallType.create({ data: { companyId, code: "ZF2", name: "ZZ-E2E partition to ceiling", sides: 2 } });
    }

    const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    const at = new Date();
    for (const g of Object.values(GROUPS)) {
      await prisma.takeoffWallProposal.create({
        data: {
          pageId: sheet.id,
          calibrationId: calibration.id,
          thicknessInches: g.inches,
          createdAt: at,
          ...(g.tag === null ? { source: "REMAINDER" as const } : { source: "TAG" as const, sourceLabel: g.tag, namedCode: g.tag }),
          runs: g.runs.map((r) => ({ ...r, thicknessFeet: g.inches / 12 })),
        },
      });
    }
    // The walls stage posted every run to "Walls — untyped" (types are suggested, not posted).
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } });
    for (const g of Object.values(GROUPS)) {
      for (const r of g.runs) {
        await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: untyped.id, label: "wall, untyped" } });
      }
    }
  });

  test("2. the queue offers the sheet's two drawn suggestions, not the third group", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await expect(left()).toHaveText("3 left to review");
    await expect(acceptAll()).toHaveText("Accept all suggestions on this sheet (2 groups)");
  });

  test("3. one press: both groups typed with their heights, their lines written, the third left", async () => {
    await acceptAll().click();
    await expect(left()).toHaveText(/^[12] left to review$/, { timeout: 5_000 });
    await expect(queue().locator('[data-takeoff="review-queue-accepted-text"]')).toHaveText("Accepted 2 groups on sheet A101 · 130 ft");
    await expect.poll(untypedRuns, { timeout: 30_000 }).toBe(1);
    const zf1 = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, wallType: { code: "ZF1" } }, select: { heightFt: true, _count: { select: { measurements: true } } } });
    expect(zf1._count.measurements).toBe(2);
    expect(zf1.heightFt?.toString()).toBe("15");
    expect(await linesOf("ZF1")).toBeGreaterThan(0);
    // What stays is the group nothing names, and ZF2's height (it has none of its own).
    const kinds = await queue().locator('[data-takeoff="review-queue-item"]').getAttribute("data-kind");
    expect(["type", "height"]).toContain(kinds);
    await expect(acceptAll()).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, "accepted-1440.png") });
  });

  test("4. Undo: every run back on Walls — untyped, the lines gone, the groups back in the queue", async () => {
    await queue().locator('[data-takeoff="review-queue-accepted-undo"]').click();
    await expect(queue().locator('[data-takeoff="review-queue-accepted"]')).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(untypedRuns, { timeout: 30_000 }).toBe(4);
    expect(await linesOf("ZF1")).toBe(0);
    expect(await linesOf("ZF2")).toBe(0);
    await expect(left()).toHaveText("3 left to review", { timeout: 30_000 });
    await expect(acceptAll()).toHaveText("Accept all suggestions on this sheet (2 groups)");
  });

  test("5. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
