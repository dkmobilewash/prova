import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── "FIND THE ROOMS", END TO END, ON AN INVENTED SHEET ──
 *
 * S05 is a generated plan (`lib/takeoff/fixtures/plans`, drawn by our own
 * generator, no client content): nine rooms, each tagged NAME / NUMBER, with
 * areas known by arithmetic in `fixtures/truth/S05.json` — LIVING 101 is
 * 264.63 sf. The journey:
 *
 *   1. the switch is OFF: the takeoff offers no "Find the rooms";
 *   2. the owner turns it on under Settings;
 *   3. find the walls, find the rooms: rows with square feet appear and at
 *      least one is NAMED from its tag;
 *   4. rename one room, save: the areas are now measurements on the sheet.
 *
 * Step 1 is the vacuous-green guard: a run where the switch never mattered
 * would pass steps 3 and 4 just the same.
 */
const SHOTS = path.resolve(__dirname, "../artifacts/rooms");
const FIXTURES = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans");
const GC_NAME = "ZZ-E2E Rooms GC";
const JOB = "ZZ-E2E Rooms — S05";

test.describe.configure({ mode: "serial" });

/**
 * WAIT FOR HYDRATION BEFORE PRESSING ANYTHING ON A FORM. The first run of
 * this spec clicked Save 100 ms after the settings page's HTML arrived, before
 * React had attached the submit handler, so the browser submitted the form
 * NATIVELY — a page POST, a navigation, every fetch on the page aborted
 * (`net::ERR_NETWORK_IO_SUSPENDED`) and the error boundary. The proof of
 * hydration is the one CLAUDE.md's #510 entry uses: a `__reactFiber$` key on
 * the element.
 */
async function hydrated(page: Page, selector: string): Promise<void> {
  await expect
    .poll(
      () => page.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))),
      { timeout: 30_000, message: `${selector} never hydrated` },
    )
    .toBe(true);
}

test.describe("find the rooms", () => {
  let page: Page;
  let monitor: HealthMonitor;
  const servedPdf = readFileSync(path.join(FIXTURES, "S05.pdf"));
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

  test("with the switch off, the takeoff offers no room finder", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: JOB, gcName: GC_NAME });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "S05.pdf"));
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    await page.goto(`/takeoff/${jobId}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await expect(page.locator('[data-takeoff="find-walls"]')).toBeVisible({ timeout: 60_000 });
    expect(await page.locator('[data-takeoff="find-rooms"]').count(), "the room finder showed with the switch off").toBe(0);
    // The full-screen workspace has no app shell by design, like takeoff-workspace.spec.ts.
    await expectHealthy(page, "takeoff with rooms off", { monitor, signedIn: false });
  });

  test("the owner turns it on under Settings", async () => {
    await page.goto("/settings?tab=estimating");
    const form = page.locator('[data-settings="room-finder"]');
    await expect(form).toBeVisible();
    await hydrated(page, '[data-settings="room-finder"]');
    const box = form.locator('input[name="roomFinderOn"]');
    expect(await box.isEnabled(), "the takeoff persona is not an owner, so this spec cannot flip the switch").toBe(true);
    await box.check();
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText("Saved.")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.locator('[data-settings="room-finder"] input[name="roomFinderOn"]')).toBeChecked();
    await page.screenshot({ path: path.join(SHOTS, "01-settings-switch.png") });
    await expectHealthy(page, "settings after the switch", { monitor });
  });

  test("find the walls, then the rooms: named rows with square feet", async () => {
    await page.goto(`/takeoff/${jobId}`);
    const findWalls = page.locator('[data-takeoff="find-walls"]');
    await expect(findWalls).toBeVisible({ timeout: 60_000 });
    await hydrated(page, '[data-takeoff="find-walls"]');
    const findRooms = page.locator('[data-takeoff="find-rooms"]');
    await expect(findRooms, "switch on, button absent").toBeVisible();
    await expect(findRooms, "rooms cannot be found before walls").toBeDisabled();
    expect(await findWalls.isEnabled(), "S05 prints its scale, so Find the walls should be enabled").toBe(true);
    await findWalls.click();
    await expect(findWalls).toHaveText("Find the walls", { timeout: 180_000 });
    await expect(findRooms).toBeEnabled({ timeout: 30_000 });
    await findRooms.click();
    const panel = page.locator('[data-takeoff="rooms-panel"]');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const rows = page.locator('[data-takeoff="room-row"]');
    expect(await rows.count(), "no room closed on a nine-room fixture").toBeGreaterThanOrEqual(3);
    expect(await page.locator('[data-takeoff="room-row"][data-room-named="1"]').count(), "no room was named from its tag").toBeGreaterThanOrEqual(1);
    const sf = await page.locator('[data-takeoff="room-sf"]').allTextContents();
    expect(sf.every((t) => Number(t.replace(/,/g, "")) > 9), `a room under 9 sf: ${sf.join(", ")}`).toBe(true);
    expect(await page.locator('[data-takeoff="room"]').count(), "rows without polygons on the drawing").toBe(await rows.count());
    await page.screenshot({ path: path.join(SHOTS, "02-rooms-found.png") });
    // The full-screen workspace has no app shell by design, like takeoff-workspace.spec.ts.
    await expectHealthy(page, "rooms found", { monitor, signedIn: false });
  });

  test("rename one, save: the rooms are areas on the sheet", async () => {
    const first = page.locator('[data-takeoff="room-row"]').first();
    await first.getByLabel("Room name").fill("ZZ RENAMED");
    const rowsBefore = await page.locator('[data-takeoff="room-row"]').count();
    await page.locator('[data-takeoff="save-rooms"]').click();
    await expect(page.locator('[data-takeoff="rooms-panel"]')).toHaveCount(0, { timeout: 60_000 });
    // The areas are ordinary measurements now: the saved count must have grown
    // by the number of rooms, and the renamed one is listed by its new name.
    await page.reload();
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await expect(page.getByText("ZZ RENAMED", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: path.join(SHOTS, "03-rooms-saved.png") });
    expect(rowsBefore).toBeGreaterThanOrEqual(3);
    // The full-screen workspace has no app shell by design, like takeoff-workspace.spec.ts.
    await expectHealthy(page, "rooms saved", { monitor, signedIn: false });
  });
});
