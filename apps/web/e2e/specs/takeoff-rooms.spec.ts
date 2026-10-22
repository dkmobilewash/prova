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
    // ── PUT THE COMPANY-WIDE SWITCH BACK ──
    //
    // This file turns `roomFinderOn` ON for a whole company and shares that
    // company with `takeoff-workspace.spec.ts`, which signs in as the same
    // persona. Leaving it on changed what every later spec rendered, and
    // produced three failures that looked unrelated:
    //
    //   · the workspace's chrome budget — the extra "Find the rooms" button
    //     put 176px above the canvas against a 170px budget at 1280 with the
    //     items rail open;
    //   · this file's own first test, "with the switch off", failing on a
    //     RETRY, because a retry re-runs the file from the start and by then
    //     the test below has turned the switch on;
    //   · and both of those appearing in some runs and not others, which is
    //     the spec ORDER rather than anything about the code.
    //
    // Best effort: a cleanup that throws would fail the file for a reason
    // that has nothing to do with rooms, and the state it is restoring is
    // the default every other spec expects anyway.
    try {
      if (page !== undefined && !page.isClosed()) {
        await page.goto("/settings?tab=estimating");
        const box = page.locator('[data-settings="room-finder"] input[name="roomFinderOn"]');
        if (await box.isVisible()) {
          if (await box.isChecked()) await box.uncheck();
          await page
            .locator('[data-settings="room-finder"]')
            .getByRole("button", { name: "Save" })
            .click();
          await page
            .locator('[data-settings="room-finder"]')
            .getByText("Saved.")
            .waitFor({ timeout: 30_000 });
        }
      }
    } catch {
      // Already closed, already off, or the settings page did not load.
    }
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

  test("with the switch off, the takeoff offers no room finder", async () => {
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: JOB, gcName: GC_NAME });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "S05.pdf"));
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    // S05 is 3/16" = 1'-0" on a 24-inch sheet: 128 ft across, so half of it is 64.
    await setScaleByClicking(64);
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
    // ── THE SHEET MUST HAVE RENDERED BEFORE THE CLICK ──
    //
    // The button is enabled as soon as the sheet has a SCALE, which can be
    // before its PDF has finished loading — and the find needs the document.
    // Pressing inside that window used to do nothing at all; it now says so,
    // and either way the press is wasted. A canvas with a real width is the
    // signal that the page is actually there.
    //
    // This is what the spec was missing, and CI is where it mattered: a
    // runner loads the PDF more slowly than a laptop, so the click landed
    // early there and never here.
    await expect
      .poll(
        async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width),
        { timeout: 60_000, message: "the sheet never rendered, so the find had no document" },
      )
      .toBeGreaterThan(0);
    await findWalls.click();
    // ── EITHER STILL RUNNING OR ALREADY DONE, BECAUSE BOTH ARE FINE ──
    //
    // "Find the walls" is also this button's RESTING text, so waiting for it
    // can pass before the find has begun — which is how this spec came to
    // poll `find-rooms` for 30 seconds against a `found` that was still null.
    //
    // My first attempt waited for the running state, "Reading the lines…",
    // and CI answered "the find never started". That may well have been MY
    // false negative rather than a finding: a find that completes in tens of
    // milliseconds can have its state batched by React and never paint that
    // label, and a poll every ~100ms would never catch it. An assertion that
    // a fast success can fail is not a diagnosis.
    //
    // So this waits on a condition true in both worlds — running, or already
    // finished. Neither a fast find nor a slow one can fail it, and a find
    // that genuinely never runs still does.
    // ── IF THE FIND REFUSES, SAY WHAT IT WAS MISSING ──
    //
    // "The find neither started nor produced a result" was true and useless.
    // CI produced it on a sheet that was VISIBLY DRAWN, with a scale line
    // reading a figure computed from the very value the refusal blames — so
    // the screenshot contradicted every branch of the guard and reading it
    // went in circles. The viewer now names the missing piece on its error
    // element, and this reports it, so the next failure arrives as a fact.
    const refusal = page.locator('[data-takeoff="find-error"]');
    await expect
      .poll(
        async () => {
          if (await findRooms.isEnabled()) return "started";
          if ((await findWalls.innerText()).includes("Reading the lines")) return "started";
          if (await refusal.isVisible()) {
            const missing = (await refusal.getAttribute("data-missing")) ?? "(not said)";
            return `the find refused, missing: ${missing}`;
          }
          return "nothing happened";
        },
        {
          timeout: 180_000,
          message: "the find neither started nor produced a result",
        },
      )
      .toBe("started");
    await expect(findWalls, "the find started and never finished").toHaveText("Find the walls", {
      timeout: 180_000,
    });
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
    // The areas are ordinary measurements now: after a reload the items panel
    // counts them under Unassigned, one per room. The label itself is not
    // printed anywhere on this screen; that the rename reaches the row is
    // `lib/actions/roomFinder.dbtest.ts`'s job.
    await page.reload();
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await expect(page.locator('[data-takeoff="unassigned"]')).toContainText(`${rowsBefore} measurement`, { timeout: 60_000 });
    await page.screenshot({ path: path.join(SHOTS, "03-rooms-saved.png") });
    expect(rowsBefore).toBeGreaterThanOrEqual(3);
    // The full-screen workspace has no app shell by design, like takeoff-workspace.spec.ts.
    await expectHealthy(page, "rooms saved", { monitor, signedIn: false });
  });
});
