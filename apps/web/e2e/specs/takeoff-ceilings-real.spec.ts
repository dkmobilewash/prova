import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── CEILINGS READ OFF A REAL TRAINING SET, FOR SCREENSHOTS ──
 *
 * SKIPS unless `REAL_SET_PDF` names a plan set outside the repository,
 * `REAL_SET_PAGES` its floor plan AND its reflected ceiling plan (e.g.
 * `13,14` for Baker's A101 and A111) and `REAL_SHEET_OUT` a folder outside
 * too. The pages are pulled into one two-page PDF with pdf-lib, uploaded,
 * the rooms found on page 1, and the ceilings read from page 2 the way the
 * app does it — from the open PDF's text, in the browser. Writes one
 * line per room: name, number, ceiling, height, where it came from.
 */
const SET = process.env.REAL_SET_PDF ?? "";
const PAGES = (process.env.REAL_SET_PAGES ?? "").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
const OUT = process.env.REAL_SHEET_OUT ?? "";
const HALF_FEET = Number(process.env.REAL_HALF_FEET ?? "144");

test.describe.configure({ mode: "serial" });

test.describe("ceilings on a real set", () => {
  test.skip(SET === "" || PAGES.length < 2 || OUT === "" || !existsSync(SET), "no real set named in REAL_SET_PDF / REAL_SET_PAGES");
  test.setTimeout(600_000);
  let page: Page;
  let monitor: HealthMonitor;
  let served: Buffer = Buffer.alloc(0);

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(readFileSync(SET));
    const two = await PDFDocument.create();
    const copied = await two.copyPages(source, PAGES.map((p) => p - 1));
    for (const c of copied) two.addPage(c);
    const extract = path.join(OUT, `sheets-p${PAGES.join("-")}.pdf`);
    writeFileSync(extract, await two.save());
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
      } else steady = 0;
      previous = box?.width ?? -1;
      await page.waitForTimeout(100);
    }
    throw new Error("the sheet never stopped resizing, so no click on it can be trusted");
  }
  async function setScaleByClicking(halfSheetFeet: number): Promise<void> {
    await expect.poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 60_000 }).toBeGreaterThan(0);
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

  test("rooms on the floor plan, ceilings from the ceiling plan beside it", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    const jobId = await startJob(page, monitor, { name: `ZZ-E2E Ceilings real p${PAGES.join("-")}`, gcName: "ZZ-E2E Ceilings real GC" });
    await finishWizard(page, monitor, jobId);
    await page.goto("/settings?tab=estimating");
    const form = page.locator('[data-settings="room-finder"]');
    await expect.poll(() => form.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))), { timeout: 30_000 }).toBe(true);
    const box = form.locator('input[name="roomFinderOn"]');
    if (!(await box.isChecked())) {
      await box.check();
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form.getByText("Saved.")).toBeVisible({ timeout: 30_000 });
    }
    await page.goto(`/jobs/${jobId}`);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(path.join(OUT, `sheets-p${PAGES.join("-")}.pdf`));
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 120_000 });
    await setScaleByClicking(HALF_FEET);
    await page.goto(`/takeoff/${jobId}`);
    await expect.poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 300_000 }).toBeGreaterThan(0);
    await settledOverlayBox();
    const findWalls = page.locator('[data-takeoff="find-walls"]');
    await expect(findWalls, "the sheet never got a scale").toBeEnabled({ timeout: 120_000 });
    await findWalls.click();
    await expect(findWalls).toHaveText("Find the walls", { timeout: 540_000 });
    await page.locator('[data-takeoff="find-rooms"]').click();
    await expect(page.locator('[data-takeoff="rooms-panel"]')).toBeVisible({ timeout: 60_000 });
    // Reading the other page's text takes a moment; wait until no row still says reading.
    await expect.poll(async () => (await page.locator('[data-takeoff="room-ceiling-from"]').allTextContents()).filter((t) => /reading/.test(t)).length, { timeout: 120_000 }).toBe(0);
    const rows = page.locator('[data-takeoff="room-row"]');
    const n = await rows.count();
    const lines: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const r = rows.nth(i);
      const name = await r.getByLabel("Room name").inputValue();
      const number = await r.getByLabel("Room number").inputValue();
      const sf = await r.locator('[data-takeoff="room-sf"]').textContent();
      const family = await r.locator('[data-takeoff="room-ceiling"]').inputValue();
      const height = await r.locator('[data-takeoff="room-ceiling-height"]').inputValue();
      const from = await r.locator('[data-takeoff="room-ceiling-from"]').textContent();
      lines.push(`${number || "—"} ${name || "(unnamed)"}: ${sf} sf, ceiling ${family || "—"}, ${height || "—"} ft, ${from?.trim()}`);
    }
    const summary = (await page.locator('[data-takeoff="ceiling-summary-sheet"]').textContent()) ?? "";
    lines.push(summary);
    console.log(lines.join("\n"));
    writeFileSync(path.join(OUT, `p${PAGES.join("-")}-ceilings.txt`), lines.join("\n") + "\n");
    // The rooms panel sits below the walls panel, so the page shot alone shows walls; shoot the panel itself too.
    const panel = page.locator('[data-takeoff="rooms-panel"]');
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, `p${PAGES.join("-")}-01-rooms-with-ceilings.png`) });
    await panel.screenshot({ path: path.join(OUT, `p${PAGES.join("-")}-02-rooms-panel.png`) });
    expect(n).toBeGreaterThan(0);
    expect(lines.some((l) => /ceiling plan tag/.test(l)), "no room took its ceiling from the ceiling plan's tags").toBe(true);
  });
});
