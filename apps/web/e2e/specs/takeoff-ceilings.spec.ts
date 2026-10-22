import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── CEILINGS IN THE ROOMS PANEL, ON INVENTED DATA ──
 *
 * The S05 fixture has rooms and no reflected ceiling plan, so what is proved
 * here is the estimator's half: each room row carries a ceiling type, a
 * height and where they came from ("nothing read" on this fixture); a type
 * and height typed in change the sheet summary at once; saving stores them
 * on the room's area and the job summary reads them back after a reload.
 * What the drawings say is proved by the evals and by
 * `takeoff-ceilings-real.spec.ts` on a training sheet.
 */
const SHOTS = path.resolve(__dirname, "../artifacts/ceilings");
const FIXTURES = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans");
const GC_NAME = "ZZ-E2E Ceilings GC";
const JOB = "ZZ-E2E Ceilings — S05";

test.describe.configure({ mode: "serial" });

async function hydrated(page: Page, selector: string): Promise<void> {
  await expect
    .poll(() => page.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))), { timeout: 30_000, message: `${selector} never hydrated` })
    .toBe(true);
}

test.describe("ceilings in the rooms panel", () => {
  test.setTimeout(240_000);
  let page: Page;
  let monitor: HealthMonitor;
  const servedPdf = readFileSync(path.join(FIXTURES, "S05.pdf"));
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: servedPdf });
    });
    mkdirSync(SHOTS, { recursive: true });
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

  /** Find the walls, and PROVE the find ran: the button reads "Find the walls" before a click too, so
   *  the only evidence is Find the rooms becoming enabled. A click that lands before the handler is
   *  attached does nothing, so it is retried. */
  async function findTheWalls(): Promise<void> {
    await expect.poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 60_000 }).toBeGreaterThan(0);
    await settledOverlayBox();
    const findWalls = page.locator('[data-takeoff="find-walls"]');
    const findRooms = page.locator('[data-takeoff="find-rooms"]');
    await hydrated(page, '[data-takeoff="find-walls"]');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await findWalls.click();
      try {
        await expect(findRooms).toBeEnabled({ timeout: 60_000 });
        return;
      } catch {
        // the click did not start a find; try once more
      }
    }
    throw new Error("Find the walls never enabled Find the rooms after three clicks");
  }

  test("the owner turns the room finder on, and a job with the fixture gets its scale", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    await page.goto("/settings?tab=estimating");
    const form = page.locator('[data-settings="room-finder"]');
    await hydrated(page, '[data-settings="room-finder"]');
    const box = form.locator('input[name="roomFinderOn"]');
    expect(await box.isEnabled(), "the takeoff persona must own the company to flip the switch").toBe(true);
    if (!(await box.isChecked())) {
      await box.check();
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form.getByText("Saved.")).toBeVisible({ timeout: 30_000 });
    }
    jobId = await startJob(page, monitor, { name: JOB, gcName: GC_NAME });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "S05.pdf"));
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    await setScaleByClicking(64);
    await expectHealthy(page, "scale set", { monitor, signedIn: false });
  });

  test("every room row shows a ceiling type, a height and where they came from", async () => {
    await page.goto(`/takeoff/${jobId}`);
    await findTheWalls();
    await page.locator('[data-takeoff="find-rooms"]').click();
    await expect(page.locator('[data-takeoff="rooms-panel"]')).toBeVisible({ timeout: 30_000 });
    const rows = await page.locator('[data-takeoff="room-row"]').count();
    expect(rows).toBeGreaterThanOrEqual(3);
    expect(await page.locator('[data-takeoff="room-ceiling"]').count(), "a ceiling select per room").toBe(rows);
    expect(await page.locator('[data-takeoff="room-ceiling-height"]').count(), "a height input per room").toBe(rows);
    await expect(page.locator('[data-takeoff="room-ceiling-from"]').first()).toHaveText(/nothing read|reading/, { timeout: 30_000 });
    await expect(page.locator('[data-takeoff="room-ceiling-from"]').first()).toHaveText("nothing read", { timeout: 60_000 });
    await expect(page.locator('[data-takeoff="ceiling-summary-sheet"]')).toContainText("no ceiling read");
    expect(await page.locator('[data-takeoff="ceiling-guess"]').count(), "nothing is a guess when nothing was read").toBe(0);
    await page.screenshot({ path: path.join(SHOTS, "01-rooms-with-ceiling-columns.png") });
    await expectHealthy(page, "rooms with ceiling columns", { monitor, signedIn: false });
  });

  test("typing a type and a height moves the sheet summary at once, and says the estimator did it", async () => {
    const first = page.locator('[data-takeoff="room-row"]').first();
    const sf = Number((await first.locator('[data-takeoff="room-sf"]').textContent())!.replace(/,/g, ""));
    await first.locator('[data-takeoff="room-ceiling"]').selectOption("ACT");
    await first.locator('[data-takeoff="room-ceiling-height"]').fill("9");
    await expect(first.locator('[data-takeoff="room-ceiling-from"]')).toHaveText("typed by you");
    await expect(page.locator('[data-takeoff="ceiling-summary-sheet"]')).toContainText(`acoustical tile: ${Math.round(sf).toLocaleString()} sf`);
    const second = page.locator('[data-takeoff="room-row"]').nth(1);
    await second.locator('[data-takeoff="room-ceiling"]').selectOption("GYP");
    await expect(page.locator('[data-takeoff="ceiling-summary-sheet"]')).toContainText("gypsum board:");
    await page.locator('[data-takeoff="rooms-panel"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "02-ceilings-typed.png") });
    await page.locator('[data-takeoff="rooms-panel"]').screenshot({ path: path.join(SHOTS, "02b-rooms-panel.png") });
    await expectHealthy(page, "ceilings typed", { monitor, signedIn: false });
  });

  test("save: the ceilings are on the rooms' areas, and the job summary reads them back", async () => {
    const first = page.locator('[data-takeoff="room-row"]').first();
    const sf = Number((await first.locator('[data-takeoff="room-sf"]').textContent())!.replace(/,/g, ""));
    await page.locator('[data-takeoff="save-rooms"]').click();
    await expect(page.locator('[data-takeoff="rooms-panel"]')).toHaveCount(0, { timeout: 60_000 });
    await page.reload();
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    // Find the rooms again: the panel's job line reads the SAVED rooms, whatever is on screen.
    await findTheWalls();
    await page.locator('[data-takeoff="find-rooms"]').click();
    const job = page.locator('[data-takeoff="ceiling-summary-job"]');
    await expect(job).toBeVisible({ timeout: 30_000 });
    await expect(job).toContainText("acoustical tile:");
    await expect(job).toContainText("gypsum board:");
    const text = (await job.textContent()) ?? "";
    const act = /acoustical tile: ([\d,]+) sf/.exec(text);
    expect(act, `no acoustical tile figure in: ${text}`).not.toBeNull();
    expect(Math.abs(Number(act![1].replace(/,/g, "")) - sf), "the saved area's square feet do not match the room's").toBeLessThanOrEqual(Math.max(2, 0.02 * sf));
    await page.screenshot({ path: path.join(SHOTS, "03-job-summary-after-save.png") });
    await expectHealthy(page, "job summary", { monitor, signedIn: false });
  });
});
