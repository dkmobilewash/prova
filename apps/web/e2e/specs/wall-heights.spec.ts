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
 * ── WALL HEIGHTS AND SQUARE FEET IN THE TAKEOFF SCREEN ──
 *
 * Every wall group's layer row and its Quantities row read length × height ×
 * sides = square feet, less openings, and say where the height came from. A
 * group with no height offers Set height: the ceiling over the rooms its walls
 * bound, the type's legend height, or a typed figure. It is saved on the
 * group's item for the whole job, and a group with none is in the review queue.
 *
 * SEEDED, in the shapes the WALLS stage, the legend read and the room finder
 * write, because in CI nothing can run detection on a stubbed upload. The
 * ROOMS company, because a ceiling is its business and no other spec there
 * reads wall types; the type code is invented and has no thickness, so it
 * matches nothing drawn.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/wall-heights");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const CODE = "ZH1";
const LEGEND_NOTE = `Height 14 ft (MEDIUM): "TO DECK"; A301 prints T.O. DECK 14' 0"`;
// 1 page width = 144 ft.
const GROUPS = {
  typed: { inches: 4.875, runs: [{ x1: 0.2, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.45 }] },
  untyped: { inches: 6.125, runs: [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6 }] },
  hand: { inches: 3.625, runs: [{ x1: 0.6, y1: 0.2, x2: 0.8, y2: 0.2 }] },
};

test.describe("wall heights and square feet", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  const ids = { typed: "", untyped: "", hand: "" };

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

  const area = (tab: Page, key: keyof typeof ids) => tab.locator('[data-takeoff="layer-row"] [data-takeoff="wall-area"]').and(tab.locator(`[data-item="${ids[key]}"]`));
  const quantities = (tab: Page, key: keyof typeof ids) => tab.locator('[data-takeoff="found-group"] [data-takeoff="wall-area"]').and(tab.locator(`[data-item="${ids[key]}"]`));
  const heightOf = async (key: keyof typeof ids) => (await prisma.takeoffItem.findUniqueOrThrow({ where: { id: ids[key] }, select: { heightFt: true } })).heightFt?.toString() ?? null;

  test("1. a job whose wall groups have no height yet", async () => {
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Wall heights — Clinic", gcName: "ZZ-E2E Wall heights GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    const companyId = plan.companyId;

    // The type as the legend read adds it: a height, and the chain in its notes.
    const type =
      (await prisma.wallType.findFirst({ where: { companyId, code: CODE }, select: { id: true } })) ??
      (await prisma.wallType.create({ data: { companyId, code: CODE, name: "ZZ-E2E partition to deck", defaultHeightFt: "14", sides: 2, notes: `Read off sheet A001 of the plan set. Check against the drawing before pricing.\n${LEGEND_NOTE}` }, select: { id: true } }));
    // A type of the company's own with no height: the set has no legend, so the queue offers the library.
    if ((await prisma.wallType.count({ where: { companyId, code: "ZH2" } })) === 0) await prisma.wallType.create({ data: { companyId, code: "ZH2", name: "ZZ-E2E partition to ceiling", sides: 2 } });

    const sheet = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    // One detection run: every row at one timestamp.
    const at = new Date();
    for (const group of Object.values(GROUPS)) {
      await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: group.inches, source: "REMAINDER", createdAt: at, runs: group.runs.map((r) => ({ ...r, thicknessFeet: group.inches / 12 })) } });
    }
    // The items the WALLS stage posts to: a typed item that took no height, "Walls — untyped", and one more typed.
    ids.typed = (await prisma.takeoffItem.create({ data: { companyId, jobId, name: `${CODE} walls`, type: "LINEAR", colorHex: "#3366cc", wallTypeId: type.id, sides: 2 }, select: { id: true } })).id;
    ids.untyped = (await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } })).id;
    ids.hand = (await prisma.takeoffItem.create({ data: { companyId, jobId, name: `${CODE} walls — corridor`, type: "LINEAR", colorHex: "#cc6633", wallTypeId: type.id, sides: 2 }, select: { id: true } })).id;
    for (const key of ["typed", "untyped", "hand"] as const) {
      for (const [i, run] of GROUPS[key].runs.entries()) {
        await prisma.takeoffMeasurement.create({
          data: {
            pageId: sheet.id,
            calibrationId: calibration.id,
            kind: "LINEAR",
            source: "DETECTED",
            xs: [run.x1, run.x2],
            ys: [run.y1, run.y2],
            itemId: ids[key],
            label: "wall",
            // A 6 × 8 opening in the typed group's first run: 48 sf off each face.
            openings: key === "typed" && i === 0 ? [{ widthFt: 6, heightFt: 8 }] : [],
          },
        });
      }
    }
    // A room the finder saved below the untyped wall, its ceiling read off the ceiling plan.
    await prisma.takeoffMeasurement.create({
      data: { pageId: sheet.id, calibrationId: calibration.id, kind: "AREA", source: "ROOM_FINDER", xs: [0.2, 0.5, 0.5, 0.2], ys: [0.6, 0.6, 0.8, 0.8], label: "104 OFFICE", roomNumber: "104", roomName: "OFFICE", ceilingFamily: "ACT", ceilingHeightFeet: 10, ceilingFrom: "tag" },
    });
  });

  test("2. the stepper's Review counts the two typed groups with no height and the untyped group", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expectHealthy(page, "the job with walls to give a height", { monitor });
    // Three heights, and the untyped group to type.
    await expect(page.locator("[data-job-next]")).toContainText("Next: Review 3 items");
  });

  let tab: Page;
  let tabMonitor: HealthMonitor;
  test("3. every wall layer row reads its feet and 'no height', with Set height offering what the job knows", async () => {
    tab = await page.context().newPage();
    // The full-screen workspace has no app shell, so its health is its crashes (step 7).
    tabMonitor = new HealthMonitor(tab);
    await tab.goto(`/takeoff/${jobId}`);
    await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(area(tab, "typed").locator('[data-takeoff="wall-area-line"]')).toHaveText("65 ft · no height", { timeout: 60_000 });
    // The typed group bounds no room with a ceiling: the legend only.
    await expect(area(tab, "typed").locator('[data-takeoff="set-height-legend"]')).toHaveText(`Legend 14'-0"`);
    await expect(area(tab, "typed").locator('[data-takeoff="set-height-legend"]')).toHaveAttribute("title", `legend ${CODE}: "TO DECK"; A301 prints T.O. DECK 14' 0" → 14'-0"`);
    await expect(area(tab, "typed").locator('[data-takeoff="set-height-ceiling"]')).toHaveCount(0);
    // The untyped group bounds the office: its ceiling, and no legend.
    await expect(area(tab, "untyped").locator('[data-takeoff="set-height-ceiling"]')).toHaveText(`Ceiling 10'-0"`);
    await expect(area(tab, "untyped").locator('[data-takeoff="set-height-legend"]')).toHaveCount(0);
    // And the Quantities section says the same.
    await expect(quantities(tab, "typed").locator('[data-takeoff="wall-area-line"]')).toHaveText("65 ft · no height");
    await tab.locator('[data-takeoff="layer-panel"]').screenshot({ path: path.join(SHOTS, "layers-no-height.png") });
    await tab.screenshot({ path: path.join(SHOTS, "workspace-no-height-1440.png") });
  });

  test("4. Legend: one press sets the whole group, saved with the job, and the row says where it came from", async () => {
    await area(tab, "typed").locator('[data-takeoff="set-height-legend"]').click();
    await expect.poll(() => heightOf("typed"), { timeout: 30_000 }).toBe("14");
    // 64.8 ft × 14 ft × 2 sides = 1,814.4, less the 6 × 8 opening on each face = 1,718.
    await expect(area(tab, "typed").locator('[data-takeoff="wall-area-line"]')).toHaveText(`65 ft × 14'-0" × 2 sides = 1,718 sf`, { timeout: 30_000 });
    await expect(area(tab, "typed").locator('[data-takeoff="wall-height-from"]')).toHaveText(`legend ${CODE}: "TO DECK"; A301 prints T.O. DECK 14' 0" → 14'-0"`);
    await expect(area(tab, "typed").locator('[data-takeoff="set-height"]')).toHaveCount(0);
    await expect(quantities(tab, "typed").locator('[data-takeoff="wall-area-line"]')).toHaveText(`65 ft × 14'-0" × 2 sides = 1,718 sf`);
  });

  test("5. a typed height: saved, and called typed", async () => {
    await area(tab, "hand").locator('[data-takeoff="set-height-typed"]').fill(`9'-6"`);
    await area(tab, "hand").locator('[data-takeoff="set-height-save"]').click();
    await expect.poll(() => heightOf("hand"), { timeout: 30_000 }).toBe("9.5");
    // 28.8 ft × 9.5 × 2 = 547.2.
    await expect(area(tab, "hand").locator('[data-takeoff="wall-area-line"]')).toHaveText(`29 ft × 9'-6" × 2 sides = 547 sf`, { timeout: 30_000 });
    await expect(area(tab, "hand").locator('[data-takeoff="wall-height-from"]')).toHaveText(`typed: 9'-6"`);
    await tab.locator('[data-takeoff="layer-panel"]').screenshot({ path: path.join(SHOTS, "layers-heights-set.png") });
  });

  test("6. the untyped group in the queue: the ceiling pre-filled, a type of the company's own picked, Enter", async () => {
    await tab.goto(`/takeoff/${jobId}?open=review`);
    const queue = tab.locator('[data-takeoff="review-queue"]');
    const item = queue.locator('[data-takeoff="review-queue-item"]');
    // Its height is asked with its type, not as an item of its own.
    await expect(queue.locator('[data-takeoff="review-queue-left"]')).toHaveText("1 left to review", { timeout: 60_000 });
    await expect(item).toHaveAttribute("data-kind", "type");
    await expect(item).toContainText(`Walls · sheet p1 · 6-1/8" · 43 ft`);
    // No type yet: the ceiling over its walls is the height, with where it came from.
    await expect(item.locator('[data-takeoff="queue-height"]')).toHaveValue(`10'-0"`);
    await expect(item.locator('[data-takeoff="queue-height-from"]')).toHaveText(`ceiling plan, room 104 OFFICE: 10'-0"`);
    await tab.screenshot({ path: path.join(SHOTS, "queue-height-1440.png") });
    // ZH2 has no height of its own, so the ceiling stays.
    await item.locator('[data-takeoff="queue-code"]', { hasText: /ZH2$/ }).click();
    await expect(item.locator('[data-takeoff="queue-height"]')).toHaveValue(`10'-0"`);
    await item.locator('[data-takeoff="queue-accept"]').click();
    await expect(queue.locator('[data-takeoff="review-queue-left"]')).toHaveText("Nothing left to review", { timeout: 30_000 });
    const zh2 = () => prisma.takeoffItem.findFirst({ where: { jobId, wallType: { code: "ZH2" } }, select: { id: true, heightFt: true, sides: true, _count: { select: { measurements: true } } } });
    await expect.poll(async () => { const i = await zh2(); return i === null ? null : [i.heightFt?.toString(), i.sides, i._count.measurements]; }, { timeout: 30_000 }).toEqual(["10", 2, 1]);
    // 43.2 ft × 10 × 2 = 864, and the room it came from.
    const row = tab.locator('[data-takeoff="layer-row"] [data-takeoff="wall-area"]').and(tab.locator(`[data-item="${(await zh2())!.id}"]`));
    await expect(row.locator('[data-takeoff="wall-area-line"]')).toHaveText(`43 ft × 10'-0" × 2 sides = 864 sf`, { timeout: 30_000 });
    await expect(row.locator('[data-takeoff="wall-height-from"]')).toHaveText(`ceiling plan, room 104 OFFICE: 10'-0"`);
    await tab.locator('[data-takeoff="layer-panel"]').screenshot({ path: path.join(SHOTS, "layers-ceiling.png") });
  });

  test("7. nothing crashed", async () => {
    await tab.close();
    expect(monitor.crashes).toEqual([]);
    expect(tabMonitor.crashes).toEqual([]);
  });
});
