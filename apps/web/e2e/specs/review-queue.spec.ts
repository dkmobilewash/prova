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
 * ── ONE REVIEW QUEUE (guided flow, Phase 4) ──
 *
 * The stepper's Review opens the workspace on a single list across the job:
 * a wall held "to confirm", an untyped wall group, a wall group with no height,
 * a floor plan with no scale, an unpriced estimate line — one at a time, with Next and a count left. Each
 * is decided with the piece that already decides it, and Review is done when
 * the list is empty.
 *
 * THE TAKEOFF ROWS ARE SEEDED, in the shapes the WALLS stage and the reader
 * write, because in CI nothing can run detection on a stubbed upload. The set
 * is two copies of one fixture sheet; the titles and the type code are invented.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/review-queue");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };
const QUARTER = '1/4" = 1\'-0"';
// The starter library's stud partition. The takeoff company is shared with
// takeoff-workspace.spec.ts, which adds that library only to a company with
// no types: so this spec adds it the same way, never a type of its own.
const CODE = "W1";
const HELD = "wall, to confirm";

test.describe("the job's one review queue", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let planId = "";
  let lineId = "";

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({ viewport: SIZE });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(readFileSync(S02));
    const doubled = await PDFDocument.create();
    for (const copied of await doubled.copyPages(source, [0, 0])) doubled.addPage(copied);
    const pdf = Buffer.from(await doubled.save());
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  const queue = (tab: Page) => tab.locator('[data-takeoff="review-queue"]');
  const left = (tab: Page) => queue(tab).locator('[data-takeoff="review-queue-left"]');
  const item = (tab: Page) => queue(tab).locator('[data-takeoff="review-queue-item"]');
  const picker = (tab: Page) => tab.locator('[data-takeoff="sheet-picker"]');

  test("1. a job with something of each kind to review", async () => {
    // Sign-in, a job, an upload and the seeding: past the 30s default on a busy runner.
    test.setTimeout(90_000);
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Review queue — Two floors", gcName: "ZZ-E2E Review queue GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, companyId: true } });
    planId = plan.id;
    const companyId = plan.companyId;

    // Two floor plans; the second has only its title block's scale.
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 2, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
    for (const [pageNumber, number, title] of [[1, "A101", "FIRST FLOOR PLAN"], [2, "A102", "SECOND FLOOR PLAN"]] as const) {
      await prisma.planSheetText.create({ data: { planId, pageNumber, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
      await prisma.planSheetProposal.create({
        data: { ingestJobId: ingest.id, planId, pageNumber, proposedSheetNumber: number, proposedTitle: title, proposedPageType: "PLAN", proposedScale: QUARTER, proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
      });
    }
    await prisma.planSheetScaleReading.create({ data: { planId, pageNumber: 2, scaleName: QUARTER, source: "CAPTION", x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "144", declaredText: QUARTER, consideredCount: 1 } });
    // The legend names one type, and the library has it.
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: [CODE], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    if ((await prisma.wallType.count({ where: { companyId, code: CODE } })) === 0) {
      await page.goto("/wall-types");
      // Another spec on this company can add the starter types between the
      // count above and this page: then the button is never offered, and the
      // step waited on it until its timeout (#1010's CI, run 42139739730).
      // So the button OR the row, whichever comes first.
      const start = page.getByRole("button", { name: /Start from the common trade assemblies/ });
      await expect.poll(async () => (await start.isVisible()) || (await prisma.wallType.count({ where: { companyId, code: "W1" } })) === 1, { timeout: 30_000 }).toBe(true);
      if (await start.isVisible()) await start.click();
      // By the row, not the "Added" toast: another spec on this company may add them first, and then this press says they are already there.
      await expect.poll(() => prisma.wallType.count({ where: { companyId: companyId, code: "W1" } }), { timeout: 60_000 }).toBe(1);
    }

    // Sheet 1, scaled (1 page-width = 144 ft), with what the WALLS stage wrote:
    // one group of two runs posted to "Walls — untyped", and one run held to confirm.
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    const runs = [
      { x1: 0.2, y1: 0.3, x2: 0.5, y2: 0.3, thicknessFeet: 0.40625 },
      { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.45, thicknessFeet: 0.40625 },
    ];
    await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: 4.875, source: "REMAINDER", runs } });
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" } });
    for (const run of runs) {
      await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [run.x1, run.x2], ys: [run.y1, run.y2], itemId: untyped.id, label: "4 7/8\" wall" } });
    }
    await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [0.6, 0.7], ys: [0.6, 0.6], label: HELD } });

    // And a line on the estimate with neither a price nor a cost.
    lineId = (await prisma.jobLineItem.create({ data: { jobId, description: "ZZ-E2E Patch and repair", quantity: "3", unit: "EA" }, select: { id: true } })).id;
  });

  test("2. the stepper's Review counts the whole queue and opens it", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expectHealthy(page, "the job with things to review", { monitor });
    await expect(page.locator('[data-job-step="review"]')).toHaveAttribute("data-state", "current");
    await expect(page.locator("[data-job-next]")).toContainText("Next: Review 4 items");
    await expect(page.locator("[data-job-next]")).toHaveAttribute("href", `/takeoff/${jobId}?open=review`);
  });

  let tab: Page;
  /** The lit runs of the item on show, and how many of them are inside the drawing's scrolling frame. */
  const litInView = (on: Page) =>
    on.evaluate(() => {
      const lines = [...document.querySelectorAll('[data-takeoff="focus-run"], [data-takeoff="review-run"]')];
      let frame = lines[0]?.parentElement ?? null;
      while (frame !== null && !/(auto|scroll)/.test(getComputedStyle(frame).overflow)) frame = frame.parentElement;
      if (frame === null) return { lit: lines.length, inView: 0 };
      const f = frame.getBoundingClientRect();
      const inView = lines.filter((line) => {
        const r = line.getBoundingClientRect();
        return r.left >= f.left - 2 && r.right <= f.right + 2 && r.top >= f.top - 2 && r.bottom <= f.bottom + 2;
      }).length;
      return { lit: lines.length, inView };
    });

  test("3. one item at a time: the wall group first, zoomed to and lit, with Next and a count per part", async () => {
    [tab] = await Promise.all([page.context().waitForEvent("page"), page.locator("[data-job-next]").click()]);
    await tab.waitForURL(new RegExp(`/takeoff/${jobId}\\?open=review`));
    await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(queue(tab)).toBeVisible();
    await expect(left(tab)).toHaveText("4 left to review");
    // What saves the most first: one key decides the group's 65 ft (Chrome's re-test).
    await expect(item(tab)).toHaveAttribute("data-kind", "type");
    await expect(queue(tab).locator('[data-takeoff="review-queue-progress"]')).toHaveText("Groups 0 of 1 · Held walls 0 of 1 · Scales 0 of 1 · Prices 0 of 1");
    await expect(picker(tab)).toHaveValue("1");
    // The FIRST item too: zoomed to, with both its walls lit and on screen —
    // it opened at 194% on empty paper, scrolled before the sheet had grown.
    await expect.poll(() => litInView(tab), { timeout: 30_000 }).toEqual({ lit: 2, inView: 2 });
    await tab.screenshot({ path: path.join(SHOTS, "queue-first-group-1440.png") });
    // Next skips without deciding: the count stays, and it comes back round.
    // "Walls — untyped" has no height either, but its runs are this group's:
    // asked once, with the type (fast-confirm.spec.ts).
    for (const kind of ["wall", "scale", "price", "type"]) {
      await item(tab).locator('[data-takeoff="review-queue-next"]').click();
      await expect(item(tab)).toHaveAttribute("data-kind", kind);
      if (kind === "wall") {
        await expect(item(tab)).toContainText("Wall to confirm · sheet A101 · 14 ft");
        await expect.poll(() => litInView(tab), { timeout: 30_000 }).toEqual({ lit: 1, inView: 1 });
        await tab.screenshot({ path: path.join(SHOTS, "queue-wall-1440.png") });
      }
    }
    await expect(left(tab)).toHaveText("4 left to review");
  });

  test("4. Not a wall: it is dropped, leaves the queue, and its part counts it", async () => {
    await item(tab).locator('[data-takeoff="review-queue-next"]').click();
    await expect(item(tab)).toHaveAttribute("data-kind", "wall");
    await item(tab).locator('[data-takeoff="review-queue-drop"]').click();
    await expect(left(tab)).toHaveText("3 left to review");
    await expect(queue(tab).locator('[data-takeoff="review-queue-progress"]')).toHaveText("Groups 0 of 1 · Held walls 1 of 1 · Scales 0 of 1 · Prices 0 of 1");
    await expect.poll(async () => (await prisma.takeoffMeasurement.findFirst({ where: { page: { planId }, xs: { equals: [0.6, 0.7] } }, select: { label: true } }))?.label).toBe("wall, dropped");
    // Round to the group again.
    for (let i = 0; i < 3 && (await item(tab).getAttribute("data-kind")) !== "type"; i += 1) await item(tab).locator('[data-takeoff="review-queue-next"]').click();
  });

  /** Next round the queue until the item on show is this kind (and, for a price, this line). */
  async function goTo(kind: string, line?: string) {
    for (let i = 0; i < 12; i += 1) {
      const on = (await item(tab).getAttribute("data-kind")) === kind;
      const right = line === undefined || (await item(tab).locator('[data-takeoff="review-queue-line"]').getAttribute("href").catch(() => ""))?.includes(`line=${line}`);
      if (on && right) return;
      await item(tab).locator('[data-takeoff="review-queue-next"]').click();
    }
    throw new Error(`no ${kind} item came round`);
  }
  const leftCount = async () => Number(((await left(tab).innerText()).match(/^(\d+)/) ?? [])[1] ?? 0);

  test("5. the untyped group: its type, and every run goes onto that type — and its estimate lines are written then", async () => {
    await expect(item(tab)).toHaveAttribute("data-kind", "type");
    await expect(item(tab)).toContainText(`Walls · sheet A101 · 4-7/8" · 65 ft`);
    await tab.screenshot({ path: path.join(SHOTS, "queue-type-1440.png") });
    // Nothing on the drawing names it: pick the legend's W1 and accept, with no height known.
    await item(tab).locator('[data-takeoff="queue-code"]', { hasText: CODE }).click();
    await item(tab).locator('[data-takeoff="queue-accept"]').click();
    // W1 has no height: the first press asks for one; the second leaves it for later.
    await expect(item(tab).locator('[data-takeoff="queue-ask-height"]')).toBeVisible();
    const before = await leftCount();
    await item(tab).locator('[data-takeoff="queue-accept"]').click();
    // The count moves on the answer itself.
    await expect.poll(leftCount, { timeout: 2_000 }).toBe(before - 1);
    await expect
      .poll(async () => (await prisma.takeoffMeasurement.findMany({ where: { page: { planId }, label: `${CODE} wall (set by hand)` }, select: { id: true } })).length)
      .toBe(2);
    // Reviewing it wrote W1's lines on the estimate, with no Send to estimate.
    await expect.poll(async () => prisma.jobLineItem.count({ where: { jobId, isDeleted: false, takeoffItem: { wallType: { code: CODE } } } }), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test("5b. the W1 walls have no height: a typed one sets the whole group", async () => {
    // The queue moved on before the server answered, so the new item comes round: go to it.
    await goTo("height");
    await expect(item(tab)).toContainText("No height · W1 walls · sheet A101 · 65 ft");
    await item(tab).locator('[data-takeoff="queue-height"]').fill("10");
    await item(tab).locator('[data-takeoff="queue-accept"]').click();
    await expect.poll(async () => (await prisma.takeoffItem.findFirst({ where: { jobId, wallType: { code: CODE } }, select: { heightFt: true } }))?.heightFt?.toString()).toBe("10");
  });

  test("6. the floor plan with no scale: its sheet, and the printed-scale fix", async () => {
    await goTo("scale");
    await expect(item(tab)).toContainText("No scale · floor plan A102");
    await expect(picker(tab)).toHaveValue("2");
    await expect(item(tab).locator('[data-takeoff="review-queue-set-scale"]')).toBeVisible();
    await item(tab).locator('[data-takeoff="review-queue-printed"]').click();
    await expect.poll(async () => prisma.takeoffScaleCalibration.count({ where: { page: { planId, pageNumber: 2 } } })).toBe(1);
  });

  test("7. the unpriced line opens on the estimate; once priced, it leaves the queue", async () => {
    await goTo("price", lineId);
    const link = item(tab).locator('[data-takeoff="review-queue-line"]');
    await expect(link).toHaveAttribute("href", `/jobs/${jobId}/estimate?line=${lineId}#line-${lineId}`);
    const [estimate] = await Promise.all([tab.context().waitForEvent("page"), link.click()]);
    // By attribute: the id is per line, not a fixed id the collapsed census can check.
    const line = estimate.locator(`details[id="line-${lineId}"]`);
    await expect(line).toHaveAttribute("open", "");
    // A new tab, a save and the queue read again: more than the default 30s on a busy machine.
    test.setTimeout(90_000);
    await expect(line.locator('input[name="unitPrice"]').first()).toBeVisible();
    await expectHealthy(estimate, "the estimate, opened on its line", { monitor: new HealthMonitor(estimate) });
    await line.locator('input[name="unitPrice"]').first().fill("85");
    await line.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await prisma.jobLineItem.findUniqueOrThrow({ where: { id: lineId }, select: { unitPrice: true } })).unitPrice?.toString(), { timeout: 30_000 }).toBe("85");
    await estimate.close();
    // Back on the workspace's tab: it reads the queue again, and that line is gone from it.
    await tab.bringToFront();
    await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(queue(tab).locator(`[data-takeoff="review-queue-line"][href*="line=${lineId}"]`)).toHaveCount(0, { timeout: 30_000 });
  });

  test("7b. W1's lines, written by the review, priced like any line: the queue is empty", async () => {
    // Priced here directly; step 7 is the pricing flow itself.
    await prisma.jobLineItem.updateMany({ where: { jobId, isDeleted: false, unitPrice: null, budgetedUnitCost: null }, data: { unitPrice: "1" } });
    await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
    await tab.goto(`/takeoff/${jobId}?open=review`);
    await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(tab.locator('[data-takeoff="review-queue-item"]')).toHaveCount(0);
  });

  test("8. Review is done when the list is empty", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expect(page.locator('[data-job-step="review"]')).toHaveAttribute("data-state", "done");
    await expect(page.locator("[data-job-next]")).not.toHaveText(/Review/);
    // The review put the takeoff on the estimate: there is no separate press for it.
    await expect(page.locator("[data-job-next]")).not.toContainText("Put the takeoff on the estimate");
  });

  test("9. nothing crashed", async () => {
    await tab.close();
    expect(monitor.crashes).toEqual([]);
  });
});
