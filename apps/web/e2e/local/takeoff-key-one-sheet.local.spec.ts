import path from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── ANSWER-KEY STATE BELONGS TO ONE SHEET ──
 *
 * Reported from the workspace, after a first fix that was supposed to have
 * covered it: find the walls on A102 in answer-key mode, switch sheet with the
 * PICKER, and A102's orange and blue candidates are drawn on the next sheet —
 * including its striped hatch box, on a drawing that has no such thing.
 *
 * The first fix keyed every piece of this state by page. It keyed it by the
 * WORKSPACE's `page`, which the viewer's own picker does not change: the
 * viewer owns `pageNumber`, the workspace owns `page`, and only the sheet TREE
 * and the overview keep them in step. So every lookup kept returning the sheet
 * the workspace still thought it was on.
 *
 * This walks the sequence it was reported from, exactly, and photographs each
 * step. Written to fail on the code that had the bug — the assertions below
 * are what "the other sheet is clean" means, and they were red before the fix.
 *
 * The drawing is a client's: read in place from `REAL_PLAN_DIR`, served from
 * disk, the blob upload stubbed, never copied in. Shots go to `TRACE_SHOTS`,
 * which has no default inside the tree. Skips without both.
 */

const PLANS = process.env.REAL_PLAN_DIR ?? "";
const SHOTS = process.env.TRACE_SHOTS ?? "";
const SET = "Camp Bow Wow";
/** A102 dimensional floor plan, A103 enlarged reception, G101 cover. */
const A102 = 9;
const RECEPTION = 10;
const COVER = 1;

test.describe.configure({ mode: "serial" });

test.describe("answer-key state belongs to one sheet", () => {
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

  const picker = () => page.locator('[data-takeoff="sheet-picker"]');
  const keyLines = () => page.locator('[data-takeoff="key-line"]');
  const tracedLines = () => page.locator('[data-takeoff="key-traced"]');

  async function shot(name: string): Promise<void> {
    mkdirSync(SHOTS, { recursive: true });
    await page
      .locator('[data-testid="takeoff-plan-port"]')
      .screenshot({ path: path.join(SHOTS, `keyleak-${name}.png`) });
  }

  /** Move to a sheet THROUGH THE PICKER, which is how this was reported. */
  async function toSheet(n: number): Promise<void> {
    await picker().selectOption(String(n));
    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid="takeoff-plan-port"] canvas')
            .evaluate((node) => (node as HTMLCanvasElement).width),
        { timeout: 120_000, message: `sheet ${n} never rendered` },
      )
      .toBeGreaterThan(0);
    await expect(picker()).toHaveValue(String(n));
    await page.waitForTimeout(600);
  }

  test("A102 reviewed: two accepted, two rejected, one traced", async () => {
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
      name: "ZZ-E2E Key One Sheet",
      gcName: "ZZ-E2E Key GC",
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

    await page.goto(`/takeoff/${id}?key=1`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await expect(picker()).toBeVisible({ timeout: 60_000 });
    await toSheet(A102);

    // The scale, by clicking: 1/8" = 1'-0" on a 36" sheet is 288 ft across.
    const overlay = page.locator('[data-testid="takeoff-plan-port"] svg');
    await page.getByRole("button", { name: "Set scale" }).click();
    const box = await overlay.boundingBox();
    expect(box).not.toBeNull();
    await overlay.click({ position: { x: box!.width * 0.2, y: box!.width * 0.3 } });
    await overlay.click({ position: { x: box!.width * 0.7, y: box!.width * 0.3 } });
    const form = page
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await form.locator('input[name="declaredDistanceFeet"]').fill("144");
    await form.locator('input[name="pageLabel"]').fill("A102");
    await form.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 60_000 });

    const find = page.locator('[data-takeoff="find-walls"]');
    await expect(find).toBeEnabled({ timeout: 60_000 });
    await find.click();
    await expect(find).toHaveText("Find the walls", { timeout: 240_000 });
    await page.waitForTimeout(1200);

    // ── THE CONTROL: THERE IS SOMETHING TO LEAK ──
    const found = await keyLines().count();
    expect(found, "A102 produced no candidates, so nothing could leak").toBeGreaterThan(0);

    // Two accepted and two rejected, by the keyboard, the way a review runs.
    await page.locator('[data-takeoff="workspace"]').click({ position: { x: 5, y: 5 } });
    for (const key of ["n", "a", "n", "a", "n", "r", "n", "r"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(120);
    }

    // And one traced wall.
    await page.keyboard.press("t");
    await expect(page.locator('[data-takeoff="key-trace-banner"]')).toBeVisible();
    // ── BOTH POINTS ON THE SHEET ITSELF, NOT THE SCROLLING BOX ──
    //
    // The first version measured from the port and offset by 180px. At Fit the
    // sheet is about 7% and only ~240px wide, so the second point landed on
    // empty paper outside the canvas, `pointAt` returned null, and the click
    // was ignored — the banner stayed on "click the end" and nothing said why.
    const sheet = await page
      .locator('[data-testid="takeoff-plan-port"] canvas')
      .boundingBox();
    expect(sheet, "the sheet has no box").not.toBeNull();
    const from = { x: sheet!.x + sheet!.width * 0.3, y: sheet!.y + sheet!.height * 0.5 };
    const to = { x: sheet!.x + sheet!.width * 0.6, y: sheet!.y + sheet!.height * 0.5 };
    await page.mouse.click(from.x, from.y);
    await expect(
      page.locator('[data-takeoff="key-trace-start"]'),
      "the first click did not land on the sheet",
    ).toBeVisible();
    await page.mouse.move(to.x, to.y);
    await page.mouse.click(to.x, to.y);
    await expect(
      page.locator('[data-takeoff="key-trace-banner"]'),
      "the second click did not land on the sheet",
    ).toContainText("Press Enter");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-takeoff="key-trace-added"]')).toBeVisible();
    await shot("1-a102-reviewed");
  });

  test("ANOTHER SHEET SHOWS NOTHING OF A102'S", async () => {
    await toSheet(RECEPTION);
    await shot("2-reception");
    expect(await keyLines().count(), "A102's candidates are on the reception sheet").toBe(0);
    expect(await tracedLines().count(), "A102's traced wall is on the reception sheet").toBe(0);

    await toSheet(COVER);
    await shot("3-cover");
    expect(await keyLines().count(), "A102's candidates are on the cover sheet").toBe(0);
    expect(await tracedLines().count(), "A102's traced wall is on the cover sheet").toBe(0);
  });

  test("AND A102 COMES BACK EXACTLY AS IT WAS", async () => {
    await toSheet(A102);
    await shot("4-a102-again");
    expect(await keyLines().count(), "A102 lost its candidates").toBeGreaterThan(0);
    expect(await tracedLines().count(), "A102 lost the traced wall").toBe(1);
    // The marks survive: the panel's own progress is the reviewer's count.
    await expect(
      page.locator('[data-takeoff="answer-key"]'),
      "the key panel did not come back",
    ).toBeVisible();
    await expect(page.locator('[data-takeoff="key-progress"]')).toContainText("4");
  });

  test("THE SAVED KEY IS A102'S, AND NAMED FOR A102", async () => {
    // ── POINT OF THE WHOLE FIX, IN THE ONE PLACE IT REACHES A FILE ──
    //
    // The key's sheet number, its page and the scale its lengths are in all
    // come from the workspace's idea of the current sheet. While that could
    // disagree with the drawing on screen, a key saved after a detour through
    // another sheet would have carried that sheet's number and its scale —
    // silently, into the file everything else is graded against.
    await toSheet(A102);
    const panel = page.locator('[data-takeoff="answer-key"]');
    await expect(panel).toBeVisible();
    await panel.locator('input[name="reviewedBy"]').fill("e2e");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: /save/i }).click(),
    ]);
    expect(
      download.suggestedFilename(),
      "the key is named for the wrong sheet",
    ).toBe("A102.key.json");

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const key = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(key.sheet.number, "the key says it is another sheet").toBe("A102");
    expect(key.sheet.page, "the key says it is another page").toBe(A102);
    // Two accepted plus one traced, and nothing from anywhere else.
    expect(key.walls.length, "the key does not hold what was accepted").toBe(3);
    expect(key.feetPerUnit, "the key carries no scale, so its lengths mean nothing")
      .toBeGreaterThan(0);
  });

  test("a sheet nobody reviewed offers no key to save", async () => {
    // The other half of point 4: no Save at all rather than a Save that would
    // write another sheet's work under this sheet's name.
    await toSheet(RECEPTION);
    await expect(
      page.getByText("Press Find the walls to load this sheet.", { exact: false }),
      "the reception sheet offers a key it has no review for",
    ).toBeVisible();
    expect(await page.locator('[data-takeoff="answer-key"]').count()).toBe(0);
  });
});
