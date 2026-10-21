import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── THE ROOMS ON A REAL TRAINING SHEET, FOR SCREENSHOTS ──
 *
 * SKIPS unless `REAL_SET_PDF` names a plan set outside the repository and
 * `REAL_SET_PAGE` its floor-plan page. The one page is pulled out with pdf-lib
 * into `REAL_SHEET_OUT` (also outside), served to the viewer in place of the
 * blob, and the screenshots go to the same folder. Nothing of the drawing is
 * written under the tree; the pattern is `takeoff-workspace-real.spec.ts`'s.
 *
 *     REAL_SET_PDF="…/2025.07.08_Baker_EOC_BID.pdf" REAL_SET_PAGE=13 \
 *     REAL_SHEET_OUT="…/takeoff/shots/rooms-app" E2E_PORT=3110 …
 */
const SET = process.env.REAL_SET_PDF ?? "";
const PAGE = Number(process.env.REAL_SET_PAGE ?? "0");
const OUT = process.env.REAL_SHEET_OUT ?? "";
/** Feet across HALF the sheet's width: 144 for a 36-inch sheet at 1/8" = 1'-0". */
const HALF_FEET = Number(process.env.REAL_HALF_FEET ?? "144");

test.describe.configure({ mode: "serial" });

test.describe("find the rooms on a real sheet", () => {
  test.skip(SET === "" || PAGE === 0 || OUT === "" || !existsSync(SET), "no real set named in REAL_SET_PDF");
  test.setTimeout(600_000);
  let page: Page;
  let monitor: HealthMonitor;
  let served: Buffer = Buffer.alloc(0);

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(readFileSync(SET));
    const one = await PDFDocument.create();
    const [copied] = await one.copyPages(source, [PAGE - 1]);
    one.addPage(copied);
    const extract = path.join(OUT, `sheet-p${PAGE}.pdf`);
    writeFileSync(extract, await one.save());
    served = readFileSync(extract);
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: served });
    });
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  const port = () => page.locator('[data-testid="takeoff-plan-port"]');
  const overlay = () => port().locator("svg");
  async function settledOverlayBox(): Promise<{ width: number }> {
    let previous = -1;
    let steady = 0;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const box = await overlay().boundingBox();
      if (box && box.width > 0 && Math.abs(box.width - previous) < 0.5) {
        steady += 1;
        if (steady >= 3) return { width: box.width };
      } else {
        steady = 0;
      }
      previous = box?.width ?? -1;
      await page.waitForTimeout(100);
    }
    throw new Error("the sheet never stopped resizing, so no click on it can be trusted");
  }
  /** Two clicks half a sheet apart and the feet between them — exactly
   *  `takeoff-workspace.spec.ts`'s `setScaleByClicking`. */
  async function setScaleByClicking(halfSheetFeet: number): Promise<void> {
    await expect
      .poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 60_000 })
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Set scale", exact: true }).click();
    const box = await settledOverlayBox();
    await overlay().click({ position: { x: box.width * 0.2, y: box.width * 0.5 } });
    await overlay().click({ position: { x: box.width * 0.7, y: box.width * 0.5 } });
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await form.locator('input[name="declaredDistanceFeet"]').fill(String(halfSheetFeet));
    await form.locator('input[name="pageLabel"]').fill("sheet 1");
    await form.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 30_000 });
  }

  test("walls, then rooms, with the panel open", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    const jobId = await startJob(page, monitor, { name: `ZZ-E2E Rooms real p${PAGE}`, gcName: "ZZ-E2E Rooms real GC" });
    await finishWizard(page, monitor, jobId);
    await page.goto("/settings?tab=estimating");
    const form = page.locator('[data-settings="room-finder"]');
    await expect
      .poll(() => form.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))), { timeout: 30_000 })
      .toBe(true);
    await form.locator('input[name="roomFinderOn"]').check();
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText("Saved.")).toBeVisible({ timeout: 30_000 });
    await page.goto(`/jobs/${jobId}`);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(path.join(OUT, `sheet-p${PAGE}.pdf`));
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 120_000 });
    await setScaleByClicking(HALF_FEET);
    await page.goto(`/takeoff/${jobId}`);
    const findWalls = page.locator('[data-takeoff="find-walls"]');
    await expect(findWalls).toBeVisible({ timeout: 120_000 });
    await expect(findWalls, "the sheet never got a scale, so nothing can be found").toBeEnabled({ timeout: 120_000 });
    await findWalls.click();
    await expect(findWalls).toHaveText("Find the walls", { timeout: 540_000 });
    await page.screenshot({ path: path.join(OUT, `p${PAGE}-01-walls.png`), fullPage: false });
    const findRooms = page.locator('[data-takeoff="find-rooms"]');
    await expect(findRooms).toBeEnabled({ timeout: 30_000 });
    await findRooms.click();
    await expect(page.locator('[data-takeoff="rooms-panel"]')).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: path.join(OUT, `p${PAGE}-02-rooms.png`), fullPage: false });
    const rows = await page.locator('[data-takeoff="room-row"]').count();
    const named = await page.locator('[data-takeoff="room-row"][data-room-named="1"]').count();
    const sf = await page.locator('[data-takeoff="room-sf"]').allTextContents();
    console.log(`rooms on p${PAGE}: ${rows} rows, ${named} named, sf: ${sf.join(", ")}`);
    writeFileSync(path.join(OUT, `p${PAGE}-rooms.txt`), `${rows} rows, ${named} named\n${sf.join("\n")}\n`);
    expect(rows).toBeGreaterThan(0);
  });
});
