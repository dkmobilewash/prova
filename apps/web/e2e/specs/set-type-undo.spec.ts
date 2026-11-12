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
 * ── SET TYPE KEEPS THE GROUP; A MISTAKE IS UNDONE OR CLEARED ──
 *
 * Chrome's re-test on Baker: a group typed from the panel's "Set type" left the
 * list until a reload, and a type set by mistake could not be undone — Undo
 * stayed grey and Ctrl+Z did nothing. Now the group stays, showing its type;
 * Undo and Ctrl+Z take it back; "Clear type" puts its walls back on "Walls —
 * untyped". Each step checked in the rows too.
 *
 * fast-confirm.spec.ts's fixture, its own codes: the untagged 6-1/8" group is
 * the one the panel offers "Set type" on (nothing that thick in the library).
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/set-type-undo");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const NOTE = "Height 15 ft";
const GROUPS = {
  one: { tag: "ZU1", inches: 4.875, runs: [{ x1: 0.1, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.5 }] },
  two: { tag: "ZU2", inches: 3.625, runs: [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6 }] },
  three: { tag: null, inches: 6.125, runs: [{ x1: 0.6, y1: 0.2, x2: 0.7, y2: 0.2 }] },
};

test.describe("Set type in the panel: stays, undoes, clears", () => {
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

  const untagged = () => page.locator('[data-takeoff="found-group"]').filter({ has: page.locator('[data-takeoff="set-type"], [data-takeoff="group-typed"]') }).first();
  /** Where the untagged group's one run sits: "untyped", a type's code, or null. */
  const runOn = async () => {
    const m = await prisma.takeoffMeasurement.findFirst({ where: { page: { planId }, xs: { equals: [0.6, 0.7] }, ys: { equals: [0.2, 0.2] } }, select: { item: { select: { name: true, wallType: { select: { code: true } } } } } });
    return m?.item?.wallType?.code ?? (m?.item?.name === "Walls — untyped" ? "untyped" : null);
  };

  test("1. three found groups on A101, one nothing names", async () => {
    test.setTimeout(90_000);
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Set type undo — Clinic", gcName: "ZZ-E2E Set type undo GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
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
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: ["ZU1", "ZU2"], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    // ZU1 as the legend read adds it, with its height; ZU2 with none.
    if ((await prisma.wallType.count({ where: { companyId, code: "ZU1" } })) === 0) {
      await prisma.wallType.create({ data: { companyId, code: "ZU1", name: "ZZ-E2E partition to deck", defaultHeightFt: "15", sides: 2, notes: `Read off sheet A001 of the plan set. Check against the drawing before pricing.\n${NOTE}` } });
    }
    if ((await prisma.wallType.count({ where: { companyId, code: "ZU2" } })) === 0) {
      await prisma.wallType.create({ data: { companyId, code: "ZU2", name: "ZZ-E2E partition to ceiling", sides: 2 } });
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

  test("2. Set type: the group stays in the list, typed, with Clear type, and its walls go onto the type", async () => {
    await page.goto(`/takeoff/${jobId}?page=1`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(untagged().locator('[data-takeoff="set-type-code"]', { hasText: "ZU1" })).toBeVisible({ timeout: 60_000 });
    await untagged().locator('[data-takeoff="set-type-code"]', { hasText: "ZU1" }).click();
    await expect(untagged().locator('[data-takeoff="group-typed-as"]')).toContainText("ZU1");
    await expect(untagged().locator('[data-takeoff="group-clear-type"]')).toBeVisible();
    await expect.poll(runOn, { timeout: 30_000 }).toBe("ZU1");
    await page.screenshot({ path: path.join(SHOTS, "typed-in-place-1440.png") });
  });

  test("3. Undo (the button): the type is taken back in place, the codes offered again", async () => {
    const undo = page.locator('[data-takeoff="undo"]');
    await expect(undo).toBeEnabled();
    await expect(undo).toHaveAttribute("title", /Undo: Set type ZU1/);
    await undo.click();
    await expect.poll(runOn, { timeout: 30_000 }).toBe("untyped");
    await expect(untagged().locator('[data-takeoff="set-type-code"]', { hasText: "ZU1" })).toBeVisible({ timeout: 30_000 });
  });

  test("4. Ctrl+Z after a second set does the same", async () => {
    await untagged().locator('[data-takeoff="set-type-code"]', { hasText: "ZU2" }).click();
    await expect.poll(runOn, { timeout: 30_000 }).toBe("ZU2");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+z");
    await expect.poll(runOn, { timeout: 30_000 }).toBe("untyped");
    await expect(untagged().locator('[data-takeoff="set-type"]')).toBeVisible({ timeout: 30_000 });
  });

  test("5. Clear type on a typed group puts its walls back on Walls — untyped, and survives a reload", async () => {
    await untagged().locator('[data-takeoff="set-type-code"]', { hasText: "ZU1" }).click();
    await expect.poll(runOn, { timeout: 30_000 }).toBe("ZU1");
    await untagged().locator('[data-takeoff="group-clear-type"]').click();
    await expect.poll(runOn, { timeout: 30_000 }).toBe("untyped");
    await expect(untagged().locator('[data-takeoff="set-type"]')).toBeVisible();
    // Typed again and reloaded: the row reads its type off the rows, not off memory.
    await untagged().locator('[data-takeoff="set-type-code"]', { hasText: "ZU1" }).click();
    await expect.poll(runOn, { timeout: 30_000 }).toBe("ZU1");
    await page.reload();
    await expect(untagged().locator('[data-takeoff="group-typed-as"]')).toContainText("ZU1", { timeout: 60_000 });
  });

  test("6. Clear type is undone too: its walls go back on the type they had", async () => {
    await untagged().locator('[data-takeoff="group-clear-type"]').click();
    await expect.poll(runOn, { timeout: 30_000 }).toBe("untyped");
    await expect(page.locator('[data-takeoff="undo"]')).toHaveAttribute("title", /Undo: Clear type/);
    await page.locator('[data-takeoff="undo"]').click();
    await expect.poll(runOn, { timeout: 30_000 }).toBe("ZU1");
    await expect(untagged().locator('[data-takeoff="group-typed-as"]')).toContainText("ZU1", { timeout: 30_000 });
  });

  const queue = () => page.locator('[data-takeoff="review-queue"]');
  const left = () => queue().locator('[data-takeoff="review-queue-left"]');
  const groupOne = async () => {
    const m = await prisma.takeoffMeasurement.findFirst({ where: { page: { planId }, xs: { equals: [0.1, 0.5] }, ys: { equals: [0.3, 0.3] } }, select: { item: { select: { name: true, wallType: { select: { code: true } } } } } });
    return m?.item?.wallType?.code ?? (m?.item?.name === "Walls — untyped" ? "untyped" : null);
  };

  test("7. the review queue: Enter on a group, then Undo — its walls back on Walls — untyped and the group back in the queue", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    await expect(queue().locator('[data-takeoff="queue-type"]')).toHaveText("ZU1");
    const before = await left().innerText();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Enter");
    await expect.poll(groupOne, { timeout: 30_000 }).toBe("ZU1");
    await expect(left()).not.toHaveText(before);
    await expect(page.locator('[data-takeoff="undo"]')).toHaveAttribute("title", /Undo: Type ZU1 on A101/);
    await page.locator('[data-takeoff="undo"]').click();
    await expect.poll(groupOne, { timeout: 30_000 }).toBe("untyped");
    await expect(left()).toHaveText(before, { timeout: 30_000 });
  });

  test("8. a height answered in the queue is undone: the type has no height again, and asks again", async () => {
    // ZU2 has no height of its own: typed from the panel, it becomes the queue's height item.
    await page.goto(`/takeoff/${jobId}?page=1`);
    await untagged().locator('[data-takeoff="group-clear-type"]').click();
    await expect.poll(runOn, { timeout: 30_000 }).toBe("untyped");
    await untagged().locator('[data-takeoff="set-type-code"]', { hasText: "ZU2" }).click();
    await expect.poll(runOn, { timeout: 30_000 }).toBe("ZU2");
    const zu2 = async () => (await prisma.takeoffItem.findFirst({ where: { jobId, wallType: { code: "ZU2" } }, select: { heightFt: true } }))?.heightFt?.toString() ?? null;
    expect(await zu2()).toBeNull();
    await page.goto(`/takeoff/${jobId}?open=review`);
    await expect(queue()).toBeVisible({ timeout: 60_000 });
    for (let i = 0; i < 6 && (await queue().locator('[data-takeoff="review-queue-item"]').getAttribute("data-kind")) !== "height"; i += 1) {
      await queue().locator('[data-takeoff="review-queue-next"]').click();
    }
    await expect(queue().locator('[data-takeoff="review-queue-item"]')).toHaveAttribute("data-kind", "height");
    await queue().locator('[data-takeoff="queue-height"]').fill("9");
    await queue().locator('[data-takeoff="queue-accept"]').click();
    await expect.poll(zu2, { timeout: 30_000 }).toBe("9");
    await expect(page.locator('[data-takeoff="undo"]')).toHaveAttribute("title", /Undo: Height 9 ft/);
    await page.locator('[data-takeoff="undo"]').click();
    await expect.poll(zu2, { timeout: 30_000 }).toBeNull();
    await expect(queue().locator('[data-takeoff="review-queue-item"][data-kind="height"]')).toHaveCount(1, { timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "queue-height-undone-1440.png") });
  });

  test("9. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
