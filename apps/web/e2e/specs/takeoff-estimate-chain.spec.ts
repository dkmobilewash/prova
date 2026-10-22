import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── ROOMS AND CEILINGS REACH THE ESTIMATE, ON INVENTED DATA ──
 *
 * Saving the rooms used to leave them in "Unassigned", so 1,675 sf of floor
 * and 872 sf of acoustic ceiling sat on the Rooms panel and nowhere else.
 * Now the save lands every room in a "Rooms" item and each room with a
 * ceiling in "Ceiling — ACT" / "Ceiling — GYP", AREA_WITH_PERIMETER items
 * that a starter assembly (ACT2, GYPC1) prices off the area and perimeter.
 * This walks it in a browser: switch on, starters added, S05 found and
 * roomed, two ceilings typed, saved; the items rail names the three items
 * with their square feet; the ACT item prices tile, tees and wall angle;
 * Send to estimate lands them; the estimate page shows the lines.
 */
const SHOTS = path.resolve(__dirname, "../artifacts/estimate-chain");
const FIXTURES = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans");
const GC_NAME = "ZZ-E2E Estimate chain GC";
const JOB = "ZZ-E2E Estimate chain — S05";

test.describe.configure({ mode: "serial" });

async function hydrated(page: Page, selector: string): Promise<void> {
  await expect
    .poll(() => page.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))), { timeout: 30_000, message: `${selector} never hydrated` })
    .toBe(true);
}

test.describe("rooms and ceilings reach the estimate", () => {
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

  test("the owner turns the room finder on, adds the starter assemblies, and a job with the fixture gets its scale", async () => {
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
    // The starter library carries ACT2 and GYPC1, which the save links a
    // ceiling item to when the company has them. Added here so the chain is
    // the common case; a company without them gets an unpriced item and a
    // sentence saying so.
    await page.goto("/wall-types");
    await expectHealthy(page, "wall types", { monitor, signedIn: false });
    const starters = page.getByRole("button", { name: /Start from the common trade assemblies/ });
    if (await starters.isVisible()) {
      await starters.click();
      await expect(page.getByText(/^Added |already have every starter/)).toBeVisible({ timeout: 60_000 });
    }
    await expect(page.getByText("ACT2", { exact: true }).first()).toBeVisible();
    jobId = await startJob(page, monitor, { name: JOB, gcName: GC_NAME });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "S05.pdf"));
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    await setScaleByClicking(64);
    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "estimate before", { monitor, signedIn: false });
    await page.screenshot({ path: path.join(SHOTS, "01-estimate-before.png"), fullPage: true });
  });

  test("find the rooms, type two ceilings, save: the items rail names Rooms and one item per ceiling family, with square feet", async () => {
    await page.goto(`/takeoff/${jobId}`);
    await findTheWalls();
    await page.locator('[data-takeoff="find-rooms"]').click();
    await expect(page.locator('[data-takeoff="rooms-panel"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-takeoff="room-ceiling-from"]').first()).toHaveText("nothing read", { timeout: 60_000 });
    const rows = page.locator('[data-takeoff="room-row"]');
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
    const sfOf = async (i: number) => Number((await rows.nth(i).locator('[data-takeoff="room-sf"]').textContent())!.replace(/,/g, ""));
    const actSf = await sfOf(0);
    const gypSf = await sfOf(1);
    let allSf = 0;
    for (let i = 0; i < (await rows.count()); i += 1) allSf += await sfOf(i);
    await rows.nth(0).locator('[data-takeoff="room-ceiling"]').selectOption("ACT");
    await rows.nth(0).locator('[data-takeoff="room-ceiling-height"]').fill("9");
    await rows.nth(1).locator('[data-takeoff="room-ceiling"]').selectOption("GYP");
    await page.locator('[data-takeoff="save-rooms"]').click();
    await expect(page.locator('[data-takeoff="rooms-panel"]')).toHaveCount(0, { timeout: 60_000 });
    await page.reload();
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    const rail = page.locator('[data-takeoff="items-rail"]');
    const item = (name: string) => rail.locator('[data-takeoff="item-row"]').filter({ hasText: name });
    await expect(item("Rooms")).toHaveCount(1, { timeout: 30_000 });
    await expect(item("Ceiling — ACT")).toHaveCount(1);
    await expect(item("Ceiling — GYP")).toHaveCount(1);
    // "1,674.7 sq ft · 1,674.7 sq ft here" — the first figure is the item's total.
    const totalOf = async (name: string) => Number((/[\d,]+(?:\.\d+)?/.exec((await item(name).locator('[data-takeoff="item-total"]').textContent()) ?? "")?.[0] ?? "").replace(/,/g, ""));
    const within = (got: number, want: number) => Math.abs(got - want) <= Math.max(2, 0.03 * want);
    expect(within(await totalOf("Rooms"), allSf), `Rooms reads ${await totalOf("Rooms")} sf against the panel's ${allSf}`).toBe(true);
    expect(within(await totalOf("Ceiling — ACT"), actSf), `ACT reads ${await totalOf("Ceiling — ACT")} sf against ${actSf}`).toBe(true);
    expect(within(await totalOf("Ceiling — GYP"), gypSf), `GYP reads ${await totalOf("Ceiling — GYP")} sf against ${gypSf}`).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, "02-items-after-save.png") });
    await expectHealthy(page, "items after save", { monitor, signedIn: false });
  });

  test("the ACT ceiling item prices tile, tees and wall angle off the starter, and Send to estimate lands the lines", async () => {
    const rail = page.locator('[data-takeoff="items-rail"]');
    await rail.locator('[data-takeoff="item-row"]').filter({ hasText: "Ceiling — ACT" }).locator('[data-takeoff="pick-item"]').click();
    const assemblyPanel = page.locator('[data-takeoff="assembly-panel"]');
    await expect(assemblyPanel).toBeVisible();
    const picker = assemblyPanel.locator('[data-takeoff="pick-assembly"]');
    await expect(picker).toHaveValue(/.+/, { timeout: 30_000 });
    const picked = await picker.locator("option:checked").textContent();
    expect(picked, "the ceiling item was not linked to the ACT2 starter").toMatch(/ACT2/);
    const parts = assemblyPanel.locator('[data-takeoff="assembly-part"]');
    await expect(parts.first()).toBeVisible({ timeout: 30_000 });
    const text = (await parts.allTextContents()).join(" | ");
    expect(text).toMatch(/2x2 acoustic tile/);
    expect(text).toMatch(/Main tee/);
    expect(text).toMatch(/Wall angle/);
    expect(text, `no part had a quantity: ${text}`).toMatch(/[1-9]/);
    await page.screenshot({ path: path.join(SHOTS, "03-act-assembly-parts.png") });
    await assemblyPanel.locator('[data-takeoff="send-to-estimate"]').click();
    const result = assemblyPanel.locator('[data-takeoff="send-result"]');
    await expect(result).toBeVisible({ timeout: 60_000 });
    await expect(result).toContainText(/\d+ added/);
    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "estimate after", { monitor, signedIn: false });
    await expect(page.getByText("2x2 acoustic tile").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Wall angle").first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "04-estimate-after.png"), fullPage: true });
  });
});
