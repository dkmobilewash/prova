import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/** PROBE (temporary): what the takeoff workspace does on an iPad, before fixing anything. */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/ipad");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const NOTE = "Height 15 ft";
const GROUPS = {
  one: { tag: "ZI1", inches: 4.875, runs: [{ x1: 0.1, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.5 }] },
  two: { tag: "ZI2", inches: 3.625, runs: [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6 }] },
  three: { tag: null, inches: 6.125, runs: [{ x1: 0.6, y1: 0.2, x2: 0.7, y2: 0.2 }] },
};

for (const SIZE of [{ width: 1180, height: 820 }, { width: 1024, height: 768 }]) {
  test.describe(`iPad ${SIZE.width}x${SIZE.height}`, () => {
    let page: Page;
    let monitor: HealthMonitor;
    let jobId = "";
    let planId = "";
    test.beforeAll(async ({ browser }) => {
      mkdirSync(SHOTS, { recursive: true });
      const context = await browser.newContext({ viewport: SIZE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      page = await context.newPage();
      monitor = new HealthMonitor(page);
      const pdf = readFileSync(S02);
      await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
    });
    test.afterAll(async () => { await page?.context().close(); });

    test("1. seed", async () => {
      test.setTimeout(120_000);
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E iPad — Clinic", gcName: "ZZ-E2E iPad GC" });
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
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: ["ZI1", "ZI2"], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    // ZI1 as the legend read adds it, with its height; ZI2 with none.
    if ((await prisma.wallType.count({ where: { companyId, code: "ZI1" } })) === 0) {
      await prisma.wallType.create({ data: { companyId, code: "ZI1", name: "ZZ-E2E partition to deck", defaultHeightFt: "15", sides: 2, notes: `Read off sheet A001 of the plan set. Check against the drawing before pricing.\n${NOTE}` } });
    }
    if ((await prisma.wallType.count({ where: { companyId, code: "ZI2" } })) === 0) {
      await prisma.wallType.create({ data: { companyId, code: "ZI2", name: "ZZ-E2E partition to ceiling", sides: 2 } });
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

    test("2. probe", async () => {
      void monitor;
      await page.goto(`/takeoff/${jobId}?open=review`);
      await expect(page.locator('[data-takeoff="review-queue"]')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('[data-testid="takeoff-plan-port"] canvas').first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(SHOTS, `probe-${SIZE.width}.png`) });
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("button, a[href], input, select, [role=button]")]
          .filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && (r.width < 44 || r.height < 44); })
          .map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} ${el.tagName} ${(el.getAttribute("data-takeoff") ?? el.getAttribute("aria-label") ?? (el.textContent ?? "").trim()).slice(0, 40)}`; }),
      );
      console.log("PROBE small", small.length, JSON.stringify(small));
      console.log("PROBE coarse", await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "frame touch-action", await page.locator('[data-testid="takeoff-plan-port"]').evaluate((n) => getComputedStyle(n).touchAction));
      await page.locator('[data-testid="takeoff-plan-port"]').evaluate((n) => {
        const w = window as unknown as { tlog: string[] };
        w.tlog = [];
        for (const t of ["touchstart", "touchmove", "touchend", "pointerdown"]) n.addEventListener(t, (e) => w.tlog.push(`${t}:${(e as TouchEvent).touches?.length ?? (e as PointerEvent).pointerType}:${(e.target as HTMLElement).tagName}`), { capture: true });
      });
      const canvasW = () => page.locator('[data-testid="takeoff-plan-port"] canvas').first().evaluate((n) => (n as HTMLCanvasElement).style.width);
      console.log("PROBE canvas before", await canvasW());
      const cdp: CDPSession = await page.context().newCDPSession(page);
      const box = (await page.locator('[data-testid="takeoff-plan-port"]').boundingBox())!;
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const zoomBefore = await page.locator('[data-takeoff="zoom"]').innerText();
      const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
      for (let i = 1; i <= 10; i += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 40 - i * 12, y: cy, id: 1 }, { x: cx + 40 + i * 12, y: cy, id: 2 }] });
      console.log("PROBE mid transform", await page.locator('[data-testid="takeoff-plan-port"] canvas').first().evaluate((n) => [n.parentElement?.style.transform, n.parentElement?.parentElement?.style.transform].join(" | ")));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(300);
      console.log("PROBE after-end transform", await page.locator('[data-testid="takeoff-plan-port"] canvas').first().evaluate((n) => [n.parentElement?.style.transform, n.parentElement?.parentElement?.style.transform].join(" | ")), JSON.stringify(await page.evaluate(() => (window as unknown as { tlog: string[] }).tlog.slice(-4))));
      await page.waitForTimeout(1500);
      console.log("PROBE tlog", JSON.stringify(await page.evaluate(() => (window as unknown as { tlog: string[] }).tlog.slice(0, 8))), "canvas after", await canvasW());
      console.log("PROBE pinch zoom", zoomBefore, "->", await page.locator('[data-takeoff="zoom"]').innerText(), "page scale", scaleBefore, "->", await page.evaluate(() => window.visualViewport?.scale ?? 1));
      const scrollBefore = await page.locator('[data-testid="takeoff-plan-port"]').evaluate((n) => [n.scrollLeft, n.scrollTop]);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
      for (let i = 1; i <= 10; i += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 40 - i * 15, y: cy - i * 10, id: 1 }, { x: cx + 40 - i * 15, y: cy - i * 10, id: 2 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(1500);
      console.log("PROBE pan scroll", JSON.stringify(scrollBefore), "->", JSON.stringify(await page.locator('[data-testid="takeoff-plan-port"]').evaluate((n) => [n.scrollLeft, n.scrollTop])), "zoom", await page.locator('[data-takeoff="zoom"]').innerText());
      await page.screenshot({ path: path.join(SHOTS, `probe-after-${SIZE.width}.png`) });
    });
  });
}
