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
 * ── SET TYPE TOUCHES ONLY THE GROUP IT WAS PRESSED ON ──
 *
 * Chrome on Baker (ae6bffce): Set type S6B on the 114 ft 7-3/8" group also typed
 * two OTHER 7-3/8" groups (17 ft tagged S6A, 20 ft tagged S8B); after Undo the
 * heading stayed, and on reload the other two read S6B with no Clear type. Set
 * type wrote the group's thickness onto the type's item, and the thickness then
 * matched every group that thick. Here: two 6-1/8" groups with different tags (ZO8, ZO9),
 * one set, the other checked untouched, Undo, reload, Clear.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/set-type-own-runs");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const GROUPS = {
  one: { tag: "ZO8", runs: [{ x1: 0.1, y1: 0.3, x2: 0.5, y2: 0.3 }] },
  two: { tag: "ZO9", runs: [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6 }] },
};
const INCHES = 6.125;

test.describe("Set type changes only the group it was pressed on", () => {
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

  // By the group's own tag chip: every row lists the legend's codes as Set type buttons.
  const row = (tag: string) => page.locator('[data-takeoff="found-group"]').filter({ has: page.locator('[data-takeoff="cluster-tag"]', { hasText: tag }) }).first();
  /** Where a group's run sits: a type's code, or "untyped". */
  const runOf = async (g: keyof typeof GROUPS) => {
    const r = GROUPS[g].runs[0]!;
    const m = await prisma.takeoffMeasurement.findFirst({ where: { page: { planId }, xs: { equals: [r.x1, r.x2] }, ys: { equals: [r.y1, r.y2] } }, select: { item: { select: { name: true, wallType: { select: { code: true } } } } } });
    return m?.item?.wallType?.code ?? (m?.item?.name === "Walls — untyped" ? "untyped" : null);
  };
  /** The other group, on screen: no type shown, Set type offered. */
  const untouched = async () => {
    await expect(row("ZO9").locator('[data-takeoff="group-typed"]')).toHaveCount(0);
    await expect(row("ZO9").locator('[data-takeoff="set-type"]')).toBeVisible();
    expect(await runOf("two")).toBe("untyped");
    // Not filed under ZO1's heading either: the group's item is not ZO1's (Baker's "S6B WALLS" heading).
    const zo1 = await prisma.takeoffItem.findFirst({ where: { jobId, wallType: { code: "ZO1" } }, select: { id: true } });
    if (zo1 !== null) await expect(row("ZO9")).not.toHaveAttribute("data-item", zo1.id);
  };

  test("1. two 6-1/8\" groups on A101, tagged ZO8 and ZO9 (on no library), both untyped; ZO1 the type to set", async () => {
    test.setTimeout(90_000);
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Set type own runs — Clinic", gcName: "ZZ-E2E Own runs GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    planId = plan.id;
    const companyId = plan.companyId;
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 1, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
    await prisma.planSheetProposal.create({
      data: { ingestJobId: ingest.id, planId, pageNumber: 1, proposedSheetNumber: "A101", proposedTitle: "FIRST FLOOR PLAN", proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
    });
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: ["ZO1", "ZO8", "ZO9"], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    if ((await prisma.wallType.count({ where: { companyId, code: "ZO1" } })) === 0) {
      await prisma.wallType.create({ data: { companyId, code: "ZO1", name: "ZZ-E2E own-runs partition", defaultHeightFt: "10", sides: 2 } });
    }
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    const at = new Date();
    for (const g of Object.values(GROUPS)) {
      await prisma.takeoffWallProposal.create({
        data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: INCHES, createdAt: at, source: "TAG", sourceLabel: g.tag, namedCode: g.tag, runs: g.runs.map((r) => ({ ...r, thicknessFeet: INCHES / 12 })) },
      });
    }
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } });
    for (const g of Object.values(GROUPS)) {
      for (const r of g.runs) {
        await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: untyped.id, label: "wall, untyped" } });
      }
    }
  });

  test("2. Set type ZO1 on the ZO8 group: that group typed, with Clear type; the ZO9 group untouched", async () => {
    await page.goto(`/takeoff/${jobId}?page=1`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(row("ZO8").locator('[data-takeoff="set-type-code"]', { hasText: "ZO1" })).toBeVisible({ timeout: 60_000 });
    await row("ZO8").locator('[data-takeoff="set-type-code"]', { hasText: "ZO1" }).click();
    await expect.poll(() => runOf("one"), { timeout: 30_000 }).toBe("ZO1");
    await expect(row("ZO8").locator('[data-takeoff="group-clear-type"]')).toBeVisible();
    await untouched();
    // Nothing a later detection could match the ZO9 group to ZO1 by.
    expect((await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, wallType: { code: "ZO1" } }, select: { thicknessIn: true } })).thicknessIn).toBeNull();
    await page.screenshot({ path: path.join(SHOTS, "one-group-typed-1440.png") });
  });

  test("3. Undo: the ZO8 group back to untyped, the ZO9 group still untouched", async () => {
    await page.locator('[data-takeoff="undo"]').click();
    await expect.poll(() => runOf("one"), { timeout: 30_000 }).toBe("untyped");
    await expect(row("ZO8").locator('[data-takeoff="set-type"]')).toBeVisible({ timeout: 30_000 });
    await untouched();
  });

  test("4. typed again and reloaded: still only the ZO8 group, with its Clear type", async () => {
    await row("ZO8").locator('[data-takeoff="set-type-code"]', { hasText: "ZO1" }).click();
    await expect.poll(() => runOf("one"), { timeout: 30_000 }).toBe("ZO1");
    await page.reload();
    await expect(row("ZO8").locator('[data-takeoff="group-typed-as"]')).toContainText("ZO1", { timeout: 60_000 });
    await expect(row("ZO8").locator('[data-takeoff="group-clear-type"]')).toBeVisible();
    await untouched();
  });

  test("5. Clear type: both untyped, exactly as before", async () => {
    await row("ZO8").locator('[data-takeoff="group-clear-type"]').click();
    await expect.poll(() => runOf("one"), { timeout: 30_000 }).toBe("untyped");
    await untouched();
  });

  test("6. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
