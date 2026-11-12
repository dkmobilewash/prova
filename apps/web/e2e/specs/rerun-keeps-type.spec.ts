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
 * ── A RE-RUN KEEPS A CONFIRMED TYPE, AND ONE HEIGHT ORDER EVERYWHERE ──
 *
 * Chrome on Baker A101 (main e5441749):
 *   1. Run takeoff again after a group was typed: the panel showed an "S6B WALLS"
 *      heading over a row reading untyped, no height, Ceiling 10'-0", with no
 *      Clear type. The finder had found the typed group again with a run a hair
 *      off the one on the job, and one more run besides; every check matched by
 *      exact coordinates, so the row read "untyped" and Set type wrote a second
 *      row for the same wall.
 *   2. The queue said 15'-0" from general note A601 while the panel offered
 *      "Ceiling 10'-0"" first.
 *
 * The fixture is that state: a group of two runs found again, one of them on
 * ZR1 a hair off, the other untyped; the set's general note says 15'-0", the
 * ceiling plan says 10'-0" over the room the walls bound.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/rerun-keeps-type");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
/** The group as the finder returns it now. */
const RUNS = [{ x1: 0.2, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.5 }];
/** The first run as it was typed before the re-run: a hair off. */
const TYPED_BEFORE = { xs: [0.2004, 0.4997], ys: [0.3003, 0.2998] };

test.describe("a re-run keeps the confirmed type, and the panel offers heights in the queue's order", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let planId = "";
  let pageId = "";

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

  const group = () => page.locator('[data-takeoff="found-group"]').filter({ has: page.locator('[data-takeoff="group-typed"], [data-takeoff="set-type"]') }).first();
  /** Where each of the sheet's wall rows is: its type's code, or "untyped". */
  const rows = async () =>
    (await prisma.takeoffMeasurement.findMany({ where: { pageId, kind: "LINEAR" }, orderBy: { createdAt: "asc" }, select: { item: { select: { name: true, wallType: { select: { code: true } } } } } })).map(
      (m) => m.item?.wallType?.code ?? (m.item?.name === "Walls — untyped" ? "untyped" : "?"),
    );

  test("1. a typed group found again: one run on ZR1 a hair off, one untyped", async () => {
    test.setTimeout(90_000);
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Re-run keeps type — Clinic", gcName: "ZZ-E2E Re-run keeps type GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    planId = plan.id;
    const companyId = plan.companyId;

    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 1, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
    await prisma.planSheetProposal.create({
      data: { ingestJobId: ingest.id, planId, pageNumber: 1, proposedSheetNumber: "A101", proposedTitle: "FIRST FLOOR PLAN", proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
    });
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: ["ZR1"], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    // The set's sheet-wide rule, as the legend read stores it.
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "GENERAL_HEIGHT", value: { feet: 15, from: "general note A601: ALL WALLS TO DECK ABOVE" } } });
    // ZR1, a type with no height of its own (so the general note is its suggestion).
    const type = (await prisma.wallType.findFirst({ where: { companyId, code: "ZR1" }, select: { id: true } })) ?? (await prisma.wallType.create({ data: { companyId, code: "ZR1", name: "ZZ-E2E re-run partition", sides: 2 }, select: { id: true } }));

    const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    pageId = sheet.id;
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    await prisma.takeoffWallProposal.create({ data: { pageId, calibrationId: calibration.id, thicknessInches: 6.125, source: "REMAINDER", runs: RUNS.map((r) => ({ ...r, thicknessFeet: 6.125 / 12 })) } });
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } });
    const typed = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "ZR1 walls", type: "LINEAR", colorHex: "#2266aa", wallTypeId: type.id }, select: { id: true } });
    await prisma.takeoffMeasurement.create({ data: { pageId, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", ...TYPED_BEFORE, itemId: typed.id, label: "ZR1 wall (set by hand)" } });
    await prisma.takeoffMeasurement.create({ data: { pageId, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [RUNS[1]!.x1, RUNS[1]!.x2], ys: [RUNS[1]!.y1, RUNS[1]!.y2], itemId: untyped.id, label: "wall, untyped" } });
    // The room the walls bound, with the ceiling plan's 10'-0".
    const rooms = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Rooms", type: "AREA_WITH_PERIMETER", colorHex: "#999999" }, select: { id: true } });
    await prisma.takeoffMeasurement.create({ data: { pageId, calibrationId: calibration.id, kind: "AREA", source: "ROOM_FINDER", xs: [0.2, 0.5, 0.5, 0.2], ys: [0.3, 0.3, 0.5, 0.5], itemId: rooms.id, label: "101 ceiling", roomNumber: "101", ceilingHeightFeet: 10, ceilingFrom: "ceiling plan" } });
    expect(await rows()).toEqual(["ZR1", "untyped"]);
  });

  test("2. the row keeps ZR1, says it covers 1 of 2 runs, and offers Clear type and the rest", async () => {
    await page.goto(`/takeoff/${jobId}?page=1`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(group().locator('[data-takeoff="group-typed-as"]')).toContainText("ZR1", { timeout: 60_000 });
    await expect(group().locator('[data-takeoff="group-typed-partly"]')).toContainText("on 1 of 2 runs");
    await expect(group().locator('[data-takeoff="group-clear-type"]')).toBeVisible();
    await expect(group().locator('[data-takeoff="set-type-code"]', { hasText: "ZR1" })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "partly-typed-1440.png") });
  });

  test("3. heights in the queue's order: the general note's 15'-0\" first, the ceiling's 10'-0\" after", async () => {
    // The layer panel's row for ZR1's walls, as Chrome read it.
    const row = page.locator('[data-takeoff="layer-row"] [data-takeoff="wall-area"]').filter({ has: page.locator('[data-takeoff="set-height"]') }).first();
    const offered = row.locator('button[data-takeoff="set-height-legend"], button[data-takeoff="set-height-note"], button[data-takeoff="set-height-ceiling"]');
    await expect(offered.first()).toHaveText(`General note 15'-0"`, { timeout: 30_000 });
    await expect(offered.first()).toHaveAttribute("title", /general note A601/);
    await expect(offered.nth(1)).toHaveText(`Ceiling 10'-0"`);
    await page.locator('[data-takeoff="layer-panel"]').screenshot({ path: path.join(SHOTS, "heights-in-order.png") });
  });

  test("4. Set type ZR1 on the rest: the run already on the job moves, nothing is written twice", async () => {
    await group().locator('[data-takeoff="set-type-code"]', { hasText: "ZR1" }).click();
    await expect.poll(rows, { timeout: 30_000 }).toEqual(["ZR1", "ZR1"]);
    await expect(group().locator('[data-takeoff="group-typed-partly"]')).toHaveCount(0, { timeout: 30_000 });
  });

  test("5. Clear type finds both, the one a hair off included", async () => {
    await group().locator('[data-takeoff="group-clear-type"]').click();
    await expect.poll(rows, { timeout: 30_000 }).toEqual(["untyped", "untyped"]);
  });

  test("6. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
