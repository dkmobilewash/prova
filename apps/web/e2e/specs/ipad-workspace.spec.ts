import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── THE TAKEOFF WORKSPACE ON AN iPAD ──
 *
 * Contractors use iPads on site. At the two iPad landscape sizes, with touch:
 * every control is a 44px tap target, a pinch zooms the drawing (never the
 * page), two fingers pan it, the tool rail works by tap, the items and layers
 * panels open as drawers, and the review queue's keys are buttons on screen.
 *
 * Touch comes in through Chromium's own touch protocol (two touch points), the
 * nearest a browser test gets to fingers. fast-confirm.spec.ts's fixture.
 */
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
  test.describe(`iPad ${SIZE.width}x${SIZE.height}, touch`, () => {
    let page: Page;
    let monitor: HealthMonitor;
    let cdp: CDPSession;
    let jobId = "";
    let planId = "";
    const shot = (name: string) => page.screenshot({ path: path.join(SHOTS, `${SIZE.width}-${name}.png`) });
    const port = () => page.locator('[data-testid="takeoff-plan-port"]');
    const queue = () => page.locator('[data-takeoff="review-queue"]');
    const zoom = async () => Number((await page.locator('[data-takeoff="zoom"]').innerText()).replace("%", ""));
    const settled = async () => {
      let last = "";
      await expect.poll(async () => { const now = `${await zoom()}|${await port().locator("canvas").first().evaluate((n) => (n as HTMLCanvasElement).style.width)}`; const same = now === last; last = now; return same; }, { intervals: [400], timeout: 15_000 }).toBe(true);
    };
    async function fingers(from: [number, number][], to: [number, number][], steps = 10) {
      const p = (pts: [number, number][]) => pts.map(([x, y], i) => ({ x, y, id: i + 1 }));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: p(from) });
      for (let s = 1; s <= steps; s += 1) {
        const at = from.map(([x, y], i) => [x + ((to[i]![0] - x) * s) / steps, y + ((to[i]![1] - y) * s) / steps] as [number, number]);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: p(at) });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }

    test.beforeAll(async ({ browser }) => {
      mkdirSync(SHOTS, { recursive: true });
      const context = await browser.newContext({ viewport: SIZE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      page = await context.newPage();
      monitor = new HealthMonitor(page);
      cdp = await context.newCDPSession(page);
      const pdf = readFileSync(S02);
      await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
    });
    test.afterAll(async () => {
      await page?.context().close();
    });

    test("1. three wall groups on A101, opened in the review queue", async () => {
      test.setTimeout(120_000);
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E iPad — Clinic", gcName: "ZZ-E2E iPad GC" });
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

    test("2. every control in the workspace and the queue is a 44px tap target", async () => {
      await page.goto(`/takeoff/${jobId}?open=review`);
      await expect(queue()).toBeVisible({ timeout: 60_000 });
      await expect(port().locator("canvas").first()).toBeVisible({ timeout: 60_000 });
      await settled();
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "a touch screen").toBe(true);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('[data-takeoff="workspace"] :is(button, a[href], input, select, [role=button])')]
          .filter((el) => !el.classList.contains("sr-only"))
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && (r.width < 44 || r.height < 44); })
          .map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} ${el.getAttribute("data-takeoff") ?? el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 30)}`; }),
      );
      expect(small, "controls under 44px").toEqual([]);
      // The HUD's boxes do not sit on one another: the taller zoom bar did, and a first fix put the sheet card on the queue.
      const overlaps = await page.evaluate(() => {
        const boxes = ['[data-hud="corner"]', '[data-hud="notices"]', '[data-takeoff="sheet-summary"]', '[data-takeoff="review-queue"]']
          .map((sel) => [sel, document.querySelector(sel)] as const)
          .filter(([, el]) => el !== null && el.getBoundingClientRect().height > 0)
          .map(([sel, el]) => [sel, el!.getBoundingClientRect()] as const);
        const hits: string[] = [];
        for (let i = 0; i < boxes.length; i += 1)
          for (let j = i + 1; j < boxes.length; j += 1) {
            const [a, r] = boxes[i]!, [b, q] = boxes[j]!;
            if (r.left < q.right - 1 && q.left < r.right - 1 && r.top < q.bottom - 1 && q.top < r.bottom - 1) hits.push(`${a} on ${b}`);
          }
        return { shown: boxes.length, hits };
      });
      expect(overlaps.shown, "the corner, the notices, the sheet card and the queue are all on screen").toBe(4);
      expect(overlaps.hits).toEqual([]);
      await shot("queue");
    });

    test("3. a pinch zooms the drawing, with the queue open, and never the page", async () => {
      const box = (await port().boundingBox())!;
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const before = await zoom();
      await fingers([[cx - 40, cy], [cx + 40, cy]], [[cx - 100, cy], [cx + 100, cy]]);
      await settled();
      expect(await zoom(), "the drawing zoomed in by the pinch").toBeGreaterThan(before * 1.8);
      expect(await page.evaluate(() => window.visualViewport?.scale ?? 1), "the page itself did not zoom").toBe(1);
      await expect(queue()).toBeVisible();
      await shot("pinched");
    });

    test("4. two fingers dragged together pan the drawing and do not zoom it", async () => {
      const box = (await port().boundingBox())!;
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const before = await zoom();
      const [left0, top0] = await port().evaluate((n) => [n.scrollLeft, n.scrollTop]);
      await fingers([[cx - 40, cy], [cx + 40, cy]], [[cx - 160, cy - 100], [cx - 80, cy - 100]]);
      await settled();
      const [left1, top1] = await port().evaluate((n) => [n.scrollLeft, n.scrollTop]);
      expect(await zoom()).toBe(before);
      // The drawing follows the fingers: dragged left and up, it scrolls right and down.
      expect(left1 - left0).toBeGreaterThan(100);
      expect(top1 - top0).toBeGreaterThan(60);
    });

    test("5. the tool rail works by tap: the Hand, then Select back", async () => {
      const hand = page.getByRole("button", { name: /^Hand/ }).first();
      await hand.tap();
      await expect(hand).toHaveAttribute("aria-pressed", "true");
      const select = page.getByRole("button", { name: /^Select/ }).first();
      await select.tap();
      await expect(select).toHaveAttribute("aria-pressed", "true");
    });

    test("6. the items list opens as a drawer over the drawing and a tap outside closes it; the layers panel is a drawer too", async () => {
      await page.locator('[data-takeoff="toggle-items"]').tap();
      const drawer = page.locator('[data-takeoff="items-drawer"]');
      await expect(drawer).toBeVisible();
      expect(await drawer.evaluate((n) => getComputedStyle(n).position)).toBe("fixed");
      await shot("items-drawer");
      await page.locator('[data-takeoff="drawer-backdrop"]').tap({ position: { x: 20, y: SIZE.height - 20 } }); // the drawer opens on the right
      await expect(drawer).toHaveCount(0);
      const layers = page.locator('[data-takeoff="layers-rail"]');
      if ((await layers.count()) === 0) await page.locator('[data-takeoff="toggle-panel"]').tap();
      await expect(layers).toBeVisible();
      expect(await layers.evaluate((n) => getComputedStyle(n).position), "below 1280 the layers panel is a drawer").toBe("fixed");
      await shot("layers-drawer");
    });

    test("7. the queue's keys are buttons on screen, and tapping them answers the group", async () => {
      await page.goto(`/takeoff/${jobId}?open=review`);
      await expect(queue()).toBeVisible({ timeout: 60_000 });
      // No keyboard on a tablet: the key hint is a mouse's only.
      await expect(queue().locator('[data-takeoff="queue-keys"]')).toBeHidden();
      for (const hook of ["queue-accept", "review-queue-next", "queue-height"]) await expect(queue().locator(`[data-takeoff="${hook}"]`)).toBeVisible();
      const left = queue().locator('[data-takeoff="review-queue-left"]');
      const before = Number((await left.innerText()).split(" ")[0]);
      await queue().locator('[data-takeoff="queue-accept"]').tap();
      await expect.poll(async () => Number((await left.innerText()).split(" ")[0]) || 0).toBeLessThan(before);
      // The group nothing names: its type by a tapped code, its height typed in the box.
      for (let i = 0; i < 4 && (await queue().locator('[data-takeoff="queue-type"]').innerText().catch(() => "")) !== "—"; i += 1) await queue().locator('[data-takeoff="review-queue-next"]').tap();
      await queue().locator('[data-takeoff="queue-code"]').first().tap();
      await queue().locator('[data-takeoff="queue-height"]').tap();
      await queue().locator('[data-takeoff="queue-height"]').fill("9");
      await queue().locator('[data-takeoff="queue-accept"]').tap();
      await expect.poll(async () => prisma.takeoffMeasurement.count({ where: { page: { planId }, item: { name: "Walls — untyped" } } }), { timeout: 30_000 }).toBeLessThan(4);
      await shot("queue-tapped");
    });

    test("8. nothing crashed", async () => {
      expect(monitor.crashes).toEqual([]);
    });
  });
}
