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
 * ── CONFIRM ONCE PER SET ──
 *
 * Three floor plans, each with a ZK6 group (printed tag, 6") and a ZK8 group
 * (printed tag, 8"). Confirming ZK6 on the first floor offers "Apply ZK6 to 2
 * more groups on A201, A301 (86 ft)"; one click types both. After "Accept all"
 * on a sheet, the same printed tags on the other floors are offered the same way. ZK8 is never touched. Undo puts
 * the two floors back, and the toolbar's Undo then takes the first floor back
 * too, so every floor is as it was.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/confirm-once-per-set");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
// 1 page width = 144 ft: the ZK6 run is 43.2 ft, the ZK8 run 14.4 ft.
const ZK6 = { tag: "ZK6", inches: 6, run: { x1: 0.1, y1: 0.3, x2: 0.4, y2: 0.3 } };
const ZK8 = { tag: "ZK8", inches: 8, run: { x1: 0.1, y1: 0.7, x2: 0.2, y2: 0.7 } };
// Each floor's counted windows: floors 1 and 2 print W1 and W2; floor 3 also prints W3, which nobody has confirmed.
const WINDOWS: Record<number, string[]> = { 1: ["W1", "W1", "W2"], 2: ["W1", "W2"], 3: ["W1", "W3"] };
const FLOORS = [
  { page: 1, number: "A101", title: "FIRST FLOOR PLAN" },
  { page: 2, number: "A201", title: "SECOND FLOOR PLAN" },
  { page: 3, number: "A301", title: "THIRD FLOOR PLAN" },
];

test.describe("confirm a wall group once, apply it to the same group on the other floors", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({ viewport: SIZE });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(readFileSync(S02));
    const set = await PDFDocument.create();
    for (const copied of await set.copyPages(source, [0, 0, 0])) set.addPage(copied);
    const pdf = Buffer.from(await set.save());
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  const queue = () => page.locator('[data-takeoff="review-queue"]');
  const left = () => queue().locator('[data-takeoff="review-queue-left"]');
  const apply = () => queue().locator('[data-takeoff="review-queue-floors-apply"]');
  const runsOf = (code: string) => prisma.takeoffMeasurement.count({ where: { item: { jobId, wallType: { code } } } });
  const untypedOn = (pageNumber: number) => prisma.takeoffMeasurement.count({ where: { page: { pageNumber, plan: { jobId } }, item: { jobId, name: "Walls — untyped" } } });

  test("1. three floor plans, each with a ZK6 and a ZK8 group", async () => {
    test.setTimeout(120_000);
    // The rooms persona, as accept-sheet: the takeoff persona's workspace spec adds its starter library only
    // while the company has no wall types, and this spec's ZK6/ZK8 would stop that (step 20, "no W1").
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Confirm once — Three floors", gcName: "ZZ-E2E Confirm once GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    const { id: planId, companyId } = plan;

    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 3, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: ["ZK6", "ZK8"], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    for (const code of ["ZK6", "ZK8"]) {
      if ((await prisma.wallType.count({ where: { companyId, code } })) === 0) {
        await prisma.wallType.create({ data: { companyId, code, name: `ZZ-E2E ${code}`, defaultHeightFt: "10", sides: 2, components: { create: [{ description: `ZZ-E2E ${code} board`, unit: "sq ft", basis: "BOARDED_SQFT" }] } } });
      }
    }
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } });
    const at = new Date();
    for (const floor of FLOORS) {
      await prisma.planSheetText.create({ data: { planId, pageNumber: floor.page, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
      await prisma.planSheetProposal.create({
        data: { ingestJobId: ingest.id, planId, pageNumber: floor.page, proposedSheetNumber: floor.number, proposedTitle: floor.title, proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
      });
      const sheet = await prisma.takeoffPlanPage.upsert({
        where: { planId_pageNumber: { planId, pageNumber: floor.page } },
        create: { planId, pageNumber: floor.page, label: floor.number, pageWidthPt: 2592 },
        update: { label: floor.number, pageWidthPt: 2592 },
      });
      const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
      for (const g of [ZK6, ZK8]) {
        await prisma.takeoffWallProposal.create({
          data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: g.inches, createdAt: at, source: "TAG", sourceLabel: g.tag, namedCode: g.tag, runs: [{ ...g.run, thicknessFeet: g.inches / 12 }] },
        });
        await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [g.run.x1, g.run.x2], ys: [g.run.y1, g.run.y2], itemId: untyped.id, label: "wall, untyped" } });
      }
      const windows = WINDOWS[floor.page]!.map((tag, i) => ({ tag, x1: 0.6 + i * 0.05, y1: 0.1, x2: 0.63 + i * 0.05, y2: 0.1 }));
      await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: floor.page, kind: "WINDOWS_SUGGESTED", value: { windows } } });
    }
  });

  test("2. confirming ZK6 on the first floor offers it on the other two, and only ZK6", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await expect(left()).toHaveText("9 left to review");
    // The longest group on the first sheet comes first: ZK6 on A101.
    await expect(queue().locator('[data-takeoff="queue-type"]')).toHaveText("ZK6");
    await queue().locator('[data-takeoff="queue-accept"]').click();
    await expect(apply()).toHaveText("Apply ZK6 to 2 more groups on A201, A301 (86 ft)", { timeout: 10_000 });
    await expect.poll(() => runsOf("ZK6"), { timeout: 30_000 }).toBe(1);
    await page.screenshot({ path: path.join(SHOTS, "offer-1440.png") });
  });

  test("3. one click types ZK6 on both floors; every ZK8 group is untouched", async () => {
    await apply().click();
    await expect(queue().locator('[data-takeoff="review-queue-accepted-text"]')).toHaveText("Applied ZK6 to 2 more groups on A201, A301 · 86 ft");
    await expect.poll(() => runsOf("ZK6"), { timeout: 30_000 }).toBe(3);
    expect(await runsOf("ZK8")).toBe(0);
    // Each floor keeps exactly its ZK8 run on Walls — untyped.
    for (const floor of FLOORS) expect(await untypedOn(floor.page)).toBe(1);
    // 9 − 3 ZK6 groups, + ONE height question for the ZK6 item: one for all three floors, not one per floor.
    await expect(left()).toHaveText("7 left to review", { timeout: 30_000 });
    await expect(queue().locator('[data-takeoff="review-queue-progress"]')).toContainText("Groups");
    await expect(apply()).toHaveCount(0);
  });

  test("4. Undo puts both floors back, and the toolbar's Undo takes the first floor back too", async () => {
    await queue().locator('[data-takeoff="review-queue-accepted-undo"]').click();
    await expect.poll(() => runsOf("ZK6"), { timeout: 30_000 }).toBe(1);
    expect(await untypedOn(2)).toBe(2);
    expect(await untypedOn(3)).toBe(2);
    const undo = page.locator('[data-takeoff="undo"]');
    await expect(undo).toBeEnabled({ timeout: 30_000 });
    // The stack's top is the Apply the inline Undo already took back (as for Accept all): it does nothing.
    await expect(undo).toHaveAttribute("title", /Undo: Apply ZK6 to 2 more groups on A201, A301/);
    await undo.click();
    expect(await untypedOn(2)).toBe(2);
    await expect(undo).toHaveAttribute("title", /Undo: Type ZK6 on A101/, { timeout: 30_000 });
    await undo.click();
    await expect.poll(() => runsOf("ZK6"), { timeout: 30_000 }).toBe(0);
    for (const floor of FLOORS) expect(await untypedOn(floor.page)).toBe(2);
    await expect(left()).toHaveText("9 left to review", { timeout: 30_000 });
  });

  test("5. windows: confirming the first floor's W1 and W2 offers floor 2, never floor 3 (it prints W3)", async () => {
    // Steps through the queue with N, then several saves: past 30 s on a loaded gate machine.
    test.setTimeout(120_000);
    const counts = () => prisma.takeoffMeasurement.count({ where: { kind: "COUNT", page: { plan: { jobId } } } });
    const item = queue().locator('[data-takeoff="review-queue-item"]');
    for (let i = 0; i < 12 && (await item.getAttribute("data-kind")) !== "windows"; i += 1) {
      await page.keyboard.press("n");
      await page.waitForTimeout(150);
    }
    await expect(item).toHaveAttribute("data-kind", "windows");
    // The first windows sheet is A101.
    await expect(item).toContainText("A101");
    await queue().locator('[data-takeoff="queue-windows-accept"]').click();
    const offer = queue().locator('[data-takeoff="review-queue-windows-floors-apply"]');
    await expect(offer).toHaveText("Confirm the same window tags on 1 other floor (2 windows)", { timeout: 10_000 });
    await expect.poll(counts, { timeout: 30_000 }).toBeGreaterThan(0);
    const afterFirst = await counts();
    await offer.click();
    await expect(queue().locator('[data-takeoff="review-queue-windows-applied"]')).toContainText("Confirmed the same window tags on 1 other floor · 2 windows");
    await expect.poll(counts, { timeout: 30_000 }).toBeGreaterThan(afterFirst);
    // Floor 3 is still the person's to confirm.
    const third = await prisma.takeoffPlanTextRead.findFirstOrThrow({ where: { plan: { jobId }, pageNumber: 3, kind: "WINDOWS_SUGGESTED" }, select: { value: true } });
    expect((third.value as { decided?: boolean }).decided ?? false).toBe(false);
    // Undo takes floor 2 back.
    await queue().locator('[data-takeoff="review-queue-windows-applied-undo"]').click();
    await expect.poll(counts, { timeout: 30_000 }).toBe(afterFirst);
    const second = await prisma.takeoffPlanTextRead.findFirstOrThrow({ where: { plan: { jobId }, pageNumber: 2, kind: "WINDOWS_SUGGESTED" }, select: { value: true } });
    expect((second.value as { decided?: boolean }).decided ?? false).toBe(false);
  });

  test("6. after Accept all on A101, both printed tags are offered on the other two floors, and Undo puts them back", async () => {
    // Steps through the queue with N, then several saves: past 30 s on a loaded gate machine.
    test.setTimeout(120_000);
    const item = queue().locator('[data-takeoff="review-queue-item"]');
    const acceptAll = queue().locator('[data-takeoff="review-queue-accept-sheet"]');
    for (let i = 0; i < 14 && !((await item.getAttribute("data-kind")) === "type" && (await acceptAll.count()) > 0 && (await item.textContent())?.includes("A101")); i += 1) {
      await page.keyboard.press("n");
      await page.waitForTimeout(150);
    }
    await expect(acceptAll).toHaveText("Accept all suggestions on this sheet (2 groups)");
    await acceptAll.click();
    await expect(apply()).toHaveText("Apply these 2 types to 4 more groups on A201, A301 (115 ft)", { timeout: 10_000 });
    await expect.poll(() => runsOf("ZK6"), { timeout: 30_000 }).toBe(1);
    await apply().click();
    await expect.poll(() => runsOf("ZK6"), { timeout: 30_000 }).toBe(3);
    await expect.poll(() => runsOf("ZK8"), { timeout: 30_000 }).toBe(3);
    await queue().locator('[data-takeoff="review-queue-accepted-undo"]').click();
    await expect.poll(() => runsOf("ZK6"), { timeout: 30_000 }).toBe(1);
    expect(await runsOf("ZK8")).toBe(1);
    for (const floor of FLOORS.slice(1)) expect(await untypedOn(floor.page)).toBe(2);
  });
});
