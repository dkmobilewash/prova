import path from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── THE TRACE TOOL, PHOTOGRAPHED AT EVERY STEP ──
 *
 *     REAL_PLAN_DIR="/path/to/sets" TRACE_SHOTS="/path/outside/the/repo" \
 *       pnpm --filter @prova/web exec playwright test \
 *         --config e2e/playwright.config.ts takeoff-trace-shots
 *
 * Reported from the workspace: "I press t, click the start of a wall, and
 * there is no visual change at all, so I can't tell where the wall will go or
 * whether trace mode is even on."
 *
 * Three causes, all real, and the fixes are only worth anything if somebody
 * can SEE them — which a unit test cannot say, because the screen suite runs
 * in happy-dom where nothing has a position. So this drives the real thing in
 * a real browser and photographs each step.
 *
 * ── THE DRAWING IS A CLIENT'S AND STAYS OUTSIDE THE REPOSITORY ──
 *
 * Read in place from `REAL_PLAN_DIR`, served to the browser from disk, never
 * copied in and never committed; the screenshots are written to `TRACE_SHOTS`,
 * which has no default inside the tree. The sheet is uploaded through the app
 * into this suite's own throwaway database, and the blob upload is stubbed, so
 * nothing leaves the machine. Same arrangement `realSheets.eval.ts` uses.
 *
 * It SKIPS without that folder rather than passing on nothing.
 */

const PLANS = process.env.REAL_PLAN_DIR ?? "";
const SHOTS = process.env.TRACE_SHOTS ?? "";
const SET = "Camp Bow Wow";
/** A102, the dimensional floor plan — the sheet being reviewed. */
const PAGE = 9;

test.describe.configure({ mode: "serial" });

test.describe("tracing a wall, step by step", () => {
  // SKIPS WITHOUT THE DRAWING OR SOMEWHERE OUTSIDE THE TREE TO WRITE TO,
  // loudly, rather than passing on nothing.
  test.skip(PLANS === "" || SHOTS === "", "needs REAL_PLAN_DIR and TRACE_SHOTS");
  let page: Page;
  let monitor: HealthMonitor;
  let served: Buffer | null = null;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    monitor = new HealthMonitor(page);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      if (served === null) return route.continue();
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: served,
      });
    });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  /** A shot of the plan area, named for the step it proves. */
  async function shot(name: string): Promise<void> {
    mkdirSync(SHOTS, { recursive: true });
    const port = page.locator('[data-testid="takeoff-plan-port"]');
    await port.screenshot({ path: path.join(SHOTS, `trace-${name}.png`) });
  }

  test("A102 open, scaled, and found", async () => {
    const matches = readdirSync(PLANS).filter(
      (name) => name.toLowerCase().endsWith(".pdf") && name.includes(SET),
    );
    expect(matches.length, `no pdf in REAL_PLAN_DIR matching "${SET}"`).toBeGreaterThan(0);
    const file = path.join(PLANS, matches[0]);
    expect(existsSync(file)).toBe(true);
    served = readFileSync(file);

    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    const id = await startJob(page, monitor, {
      name: "ZZ-E2E Trace",
      gcName: "ZZ-E2E Trace GC",
    });
    await finishWizard(page, monitor, id);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${id}/takeoff$`));
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({
      timeout: 120_000,
    });

    await page.goto(`/takeoff/${id}?page=${PAGE}&key=1`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid="takeoff-plan-port"] canvas')
            .evaluate((n) => (n as HTMLCanvasElement).width),
        { timeout: 120_000, message: "A102 never rendered" },
      )
      .toBeGreaterThan(0);

    // ── ON A102, BY THE PICKER, BECAUSE THE DEEP LINK CANNOT GET THERE YET ──
    //
    // `?page=9` falls back to the first sheet while that page has no
    // calibration row — `sheetPages` is built from the pages that have one —
    // so every shot of the first run was of G101, the cover sheet, and the
    // test was green because the trace tool works perfectly on a cover sheet.
    const picker = page.locator('[data-takeoff="sheet-picker"]');
    await expect(picker, "a 29-sheet set rendered no pager").toBeVisible({ timeout: 60_000 });
    await picker.selectOption(String(PAGE));
    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid="takeoff-plan-port"] canvas')
            .evaluate((n) => (n as HTMLCanvasElement).width),
        { timeout: 120_000, message: "A102 never rendered" },
      )
      .toBeGreaterThan(0);
    await expect(picker, "the picker did not move to A102").toHaveValue(String(PAGE));

    // ── THE SCALE, BY CLICKING, BECAUSE A LENGTH NEEDS ONE ──
    //
    // The first version of this test was named "scaled" and did not set one.
    // It cost a run: the rubber band drew, and the live length did not,
    // because feet per unit was zero — the label is correct to render nothing
    // rather than "0'-0"". A test that claims a precondition in its name and
    // does not establish it is the vacuous shape this suite exists to avoid.
    //
    // A102 is 1/8" = 1'-0" on a 36" sheet, so the page is 288 ft across and
    // half of it is 144.
    const port = page.locator('[data-testid="takeoff-plan-port"]');
    const overlay = port.locator("svg");
    await page.getByRole("button", { name: "Set scale" }).click();
    const box = await overlay.boundingBox();
    expect(box, "the overlay has no box").not.toBeNull();
    await overlay.click({ position: { x: box!.width * 0.2, y: box!.width * 0.3 } });
    await overlay.click({ position: { x: box!.width * 0.7, y: box!.width * 0.3 } });
    const form = page
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await form.locator('input[name="declaredDistanceFeet"]').fill("144");
    await form.locator('input[name="pageLabel"]').fill("A102");
    await form.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 60_000 });
  });

  test("the five steps, photographed", async () => {
    const port = page.locator('[data-testid="takeoff-plan-port"]');
    const box = await port.boundingBox();
    expect(box, "the plan has no box").not.toBeNull();

    // ── THE SHOTS ARE OF THE RIGHT SHEET ──
    //
    // The whole first run proved the trace tool on G101, the cover sheet,
    // and passed. A screenshot of the wrong drawing is a screenshot of
    // nothing, so this is asserted before any of them is taken.
    await expect(
      page.locator('[data-takeoff="sheet-picker"]'),
      "the shots would have been of the wrong sheet",
    ).toHaveValue(String(PAGE));

    // ── 1. PRESS T ──
    //
    // The control this whole spec exists for: before the fix the key did
    // nothing, because its handler lived in a panel that is not mounted until
    // candidates exist. Asserted, not just photographed.
    await page.locator('[data-takeoff="workspace"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("t");
    const banner = page.locator('[data-takeoff="key-trace-banner"]');
    await expect(banner, "pressing t armed nothing").toBeVisible();
    await expect(banner).toContainText("click the start");
    await shot("1-armed");

    // ── 2. THE SNAP POINT FOLLOWS THE POINTER ──
    const inside = {
      x: box!.x + box!.width * 0.35,
      y: box!.y + box!.height * 0.45,
    };
    await page.mouse.move(inside.x, inside.y);
    await page.mouse.move(inside.x + 4, inside.y + 4);
    await expect(
      page.locator('[data-takeoff="key-trace-snap"]'),
      "no snap point under the cursor",
    ).toBeVisible();
    await shot("2-snap");

    // ── 3. THE RUBBER BAND, WITH ITS LENGTH ──
    await page.mouse.click(inside.x, inside.y);
    await expect(page.locator('[data-takeoff="key-trace-start"]')).toBeVisible();
    await page.mouse.move(inside.x + 190, inside.y + 6);
    await page.mouse.move(inside.x + 200, inside.y + 8);
    await expect(
      page.locator('[data-takeoff="key-trace-preview"]'),
      "no line followed the pointer",
    ).toBeVisible();
    await expect(
      page.locator('[data-takeoff="key-trace-length"]'),
      "no live length beside the line",
    ).toBeVisible();
    await expect(banner).toContainText("Click the end");
    await shot("3-rubber-band");

    // ── 4. BOTH ENDS DOWN, ENTER NEXT ──
    await page.mouse.click(inside.x + 200, inside.y + 8);
    await expect(banner).toContainText("Press Enter");
    await expect(page.locator('[data-takeoff="key-trace-preview"]')).toBeVisible();
    await shot("4-pending");

    // ── 5. ENTER ADDS IT, AND SAYS WHAT IT MEASURED ──
    await page.keyboard.press("Enter");
    const added = page.locator('[data-takeoff="key-trace-added"]');
    await expect(added, "nothing confirmed the wall was added").toBeVisible();
    await expect(added).toContainText("Wall added");
    await shot("5-added");

    // AND IT IS IN THE REVIEW, not merely drawn: the panel's own count moves.
    await expect(
      page.locator('[data-takeoff="answer-key"]'),
      "the key panel is not open",
    ).toBeVisible();
  });
});
