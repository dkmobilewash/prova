import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── CONFIRMING SUGGESTIONS FAST, IN THE REVIEW QUEUE ──
 *
 * Each untyped wall group shows its walls lit and zoomed on the plan, the
 * suggested type and height already in place with where each came from, and
 * Enter accepts both; 1–9 picks another legend type, T edits the height, N
 * skips. Every press is timed from the key to the next group on screen and to
 * the rows saved, against 5 seconds.
 *
 * SEEDED in the shapes detection, the legend read and the room finder write
 * (CI cannot run detection on a stubbed upload). The ROOMS company, whose spec
 * reads no wall types; the codes are invented and have no thickness, so
 * nothing drawn matches them by size.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/fast-confirm");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const NOTE = `Height 15 ft (MEDIUM): "TO DECK"; A301 prints T.O. DECK 15' 0"`;
const LEGEND_FROM = `legend ZF1: "TO DECK"; A301 prints T.O. DECK 15' 0" → 15'-0"`;
// 1 page width = 144 ft; the groups are longest first, which is the queue's order.
const GROUPS = {
  one: { tag: "ZF1", inches: 4.875, runs: [{ x1: 0.1, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.5 }] },
  two: { tag: "ZF2", inches: 3.625, runs: [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6 }] },
  three: { tag: null, inches: 6.125, runs: [{ x1: 0.6, y1: 0.2, x2: 0.7, y2: 0.2 }] },
};
const BUDGET_MS = 5_000;

test.describe("confirming wall groups from the keyboard", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let planId = "";
  const timings: { step: string; shownMs: number; savedMs: number }[] = [];

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: SHOTS, size: SIZE } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    const pdf = readFileSync(S02);
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    writeFileSync(path.join(SHOTS, "timings.json"), JSON.stringify(timings, null, 2));
    await page?.context().close();
  });

  const queue = () => page.locator('[data-takeoff="review-queue"]');
  const group = () => queue().locator('[data-takeoff="queue-group"]');
  const label = () => group().locator("span.font-medium").first();
  const itemOf = (code: string) => prisma.takeoffItem.findFirst({ where: { jobId, wallType: { code } }, select: { id: true, heightFt: true, _count: { select: { measurements: true } } } });
  /** Press a key and time it: to the next thing on screen, and to the rows saved. */
  async function timed(step: string, key: string, shown: () => Promise<void>, saved: () => Promise<void>) {
    const start = Date.now();
    await page.keyboard.press(key);
    await shown();
    const shownMs = Date.now() - start;
    await saved();
    timings.push({ step, shownMs, savedMs: Date.now() - start });
    expect(shownMs, `${step}: the next group took ${shownMs} ms to show`).toBeLessThan(BUDGET_MS);
    expect(Date.now() - start, `${step}: saving took over ${BUDGET_MS} ms`).toBeLessThan(BUDGET_MS);
  }
  const noFocus = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  test("1. three untyped wall groups, two of them tagged", async () => {
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Fast confirm — Clinic", gcName: "ZZ-E2E Fast confirm GC" });
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
    // The room under ZF2's wall, its ceiling read off the ceiling plan.
    await prisma.takeoffMeasurement.create({
      data: { pageId: sheet.id, calibrationId: calibration.id, kind: "AREA", source: "ROOM_FINDER", xs: [0.2, 0.5, 0.5, 0.2], ys: [0.6, 0.6, 0.8, 0.8], label: "104 OFFICE", roomNumber: "104", roomName: "OFFICE", ceilingFamily: "ACT", ceilingHeightFeet: 10, ceilingFrom: "tag" },
    });
  });

  test("2. the first group: its walls lit and zoomed, type and height pre-filled with where each came from", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(queue().locator('[data-takeoff="review-queue-left"]')).toHaveText("3 left to review", { timeout: 60_000 });
    await expect(label()).toHaveText(`Walls · sheet A101 · 4-7/8" · 86 ft`);
    await expect(group().locator('[data-takeoff="queue-type"]')).toHaveText("ZF1");
    await expect(group().locator('[data-takeoff="queue-type-from"]')).toHaveText("printed tag: ZF1 on A101");
    await expect(group().locator('[data-takeoff="queue-height"]')).toHaveValue(`15'-0"`);
    await expect(group().locator('[data-takeoff="queue-height-from"]')).toHaveText(LEGEND_FROM);
    await expect(group().locator('[data-takeoff="queue-keys"]')).toHaveText("Enter accept · 1–9 type · T height · N skip");
    // Every run of the group is lit, and the plan has zoomed in to them.
    await expect(page.locator('[data-takeoff="focus-run"]')).toHaveCount(2);
    // Zoomed to the group, so no longer the whole sheet fitted.
    await expect(page.locator('[data-takeoff="fit"]')).not.toHaveClass(/border-tag-amber-ink/);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, "group-1-suggested-1440.png") });
  });

  test("3. N skips, round the queue and back", async () => {
    await noFocus();
    await page.keyboard.press("n");
    await expect(group().locator('[data-takeoff="queue-type"]')).toHaveText("ZF2");
    await page.keyboard.press("n");
    await expect(group().locator('[data-takeoff="queue-type"]')).toHaveText("—");
    await page.keyboard.press("n");
    await expect(group().locator('[data-takeoff="queue-type"]')).toHaveText("ZF1");
    await expect(queue().locator('[data-takeoff="review-queue-left"]')).toHaveText("3 left to review");
  });

  test("4. Enter accepts the type and the height, and the next group is on screen at once", async () => {
    await timed(
      "Enter on ZF1 (suggested type and legend height)",
      "Enter",
      () => expect(group().locator('[data-takeoff="queue-type"]')).toHaveText("ZF2"),
      () => expect.poll(async () => { const i = await itemOf("ZF1"); return i === null ? null : [i.heightFt?.toString(), i._count.measurements]; }, { intervals: [100] }).toEqual(["15", 2]),
    );
    await expect(queue().locator('[data-takeoff="review-queue-left"]')).toHaveText("2 left to review");
    // And from the server, once the confirm has written the untyped runs' own
    // "no type: check" line: the queue does not ask a price for walls it is
    // about to type. Before, it did, and this count read 3 whenever the
    // refresh came before the assertion (it passed on CI by timing).
    await expect.poll(() => prisma.jobLineItem.count({ where: { jobId, isDeleted: false, takeoffItem: { name: "Walls — untyped" } } }), { timeout: 30_000 }).toBe(1);
    await page.reload();
    await expect(queue().locator('[data-takeoff="review-queue-left"]')).toHaveText("2 left to review", { timeout: 60_000 });
    await expect(queue().locator('[data-takeoff="review-queue-item"]')).toHaveAttribute("data-kind", "type");
  });

  test("5. a type with no height of its own takes the ceiling over its walls", async () => {
    await expect(group().locator('[data-takeoff="queue-type-from"]')).toHaveText("printed tag: ZF2 on A101");
    await expect(group().locator('[data-takeoff="queue-height"]')).toHaveValue(`10'-0"`);
    await expect(group().locator('[data-takeoff="queue-height-from"]')).toHaveText(`ceiling plan, room 104 OFFICE: 10'-0"`);
    await expect(page.locator('[data-takeoff="focus-run"]')).toHaveCount(1);
    await page.screenshot({ path: path.join(SHOTS, "group-2-ceiling-1440.png") });
    await timed(
      "Enter on ZF2 (suggested type, ceiling height)",
      "Enter",
      () => expect(group().locator('[data-takeoff="queue-type"]')).toHaveText("—"),
      () => expect.poll(async () => { const i = await itemOf("ZF2"); return i === null ? null : [i.heightFt?.toString(), i._count.measurements]; }, { intervals: [100] }).toEqual(["10", 1]),
    );
  });

  test("6. nothing names the last group: 1 and 2 pick from the legend, T types the height", async () => {
    await expect(group().locator('[data-takeoff="queue-type-from"]')).toHaveText("nothing on the drawing names it: 1–9");
    await expect(group().locator('[data-takeoff="queue-height"]')).toHaveValue("");
    await page.keyboard.press("1");
    await expect(group().locator('[data-takeoff="queue-type"]')).toHaveText("ZF1");
    await expect(group().locator('[data-takeoff="queue-type-from"]')).toHaveText("picked by you");
    // The height follows the type picked.
    await expect(group().locator('[data-takeoff="queue-height"]')).toHaveValue(`15'-0"`);
    await page.keyboard.press("2");
    await expect(group().locator('[data-takeoff="queue-type"]')).toHaveText("ZF2");
    await page.keyboard.press("t");
    await expect(group().locator('[data-takeoff="queue-height"]')).toBeFocused();
    // T is the queue's height key; H stays the Hand tool.
    await expect(page.getByRole("button", { name: /^Hand/ }).first()).not.toHaveAttribute("aria-pressed", "true");
    await page.keyboard.type(`9'-6"`);
    await page.screenshot({ path: path.join(SHOTS, "group-3-typed-1440.png") });
    await timed(
      "Enter in the height box (picked type, typed height)",
      "Enter",
      () => expect(queue().locator('[data-takeoff="review-queue-left"]')).toHaveText("Nothing left to review"),
      // The height is the type's for the whole job, so ZF2's walls are all 9'-6" now.
      () => expect.poll(async () => { const i = await itemOf("ZF2"); return i === null ? null : [i.heightFt?.toString(), i._count.measurements]; }, { intervals: [100] }).toEqual(["9.5", 2]),
    );
    expect(await prisma.takeoffMeasurement.count({ where: { page: { planId }, item: { name: "Walls — untyped" } } }), "every run left Walls — untyped").toBe(0);
    await page.screenshot({ path: path.join(SHOTS, "queue-done-1440.png") });
  });

  test("7. nothing crashed", async () => {
    // eslint-disable-next-line no-console -- the per-press timings, for the PR body
    console.log(`[fast-confirm] ${JSON.stringify(timings)}`);
    expect(monitor.crashes).toEqual([]);
  });
});
