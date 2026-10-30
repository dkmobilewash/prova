import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { test, expect, type Page, type Response } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── DEMOTE, DON'T HIDE, IN A REAL BROWSER ──
 *
 * "Check these are walls" asks a model, and the e2e runner strips the key on
 * purpose, so the real check REFUSES here — which this spec proves first,
 * because a refusal must leave the sheet exactly as it was. What the panel
 * does with a verdict is then driven by REPLAYING the check's own response:
 * the refusal is captured once, and the one JSON row carrying the result is
 * swapped for a canned verdict (two runs demoted, by id) before the browser
 * sees it. Nothing about the page is mocked — the request, the headers and
 * the React Flight framing are the real ones; only the verdict is invented.
 *
 * `expectHealthy` runs on every step, and the demoted count is asserted
 * against the found count BEFORE and AFTER, so a replay that silently did
 * nothing cannot pass (the vacuous-green rule).
 *
 * THE TRAINED MODEL IS AN INVENTED ONE: `TAKEOFF_WALL_MODEL` must name
 * `e2e/fixtures/wall-model.invented.json` for this run — one stump on
 * lengthPercentile, so the shortest runs of the fixture score 0.119 and the
 * rest 0.88, against the default cut of 0.3. It proves the wiring (a model
 * file is read, runs are scored at Find time, the panel and the total
 * follow), not that any trained model is right about anything.
 *
 * NOT COVERED HERE: `?key=1` labelling mode. The workspace enters it only
 * when the server says labelling is available (`labellingAvailable`, the
 * labelling server's own build), which the e2e build never does — a first
 * draft of this spec visited `?key=1`, got the ordinary workspace, and would
 * have passed a "never demotes in key mode" assertion about a page that was
 * not in key mode. The gate is one line in the viewer,
 * `demotedWalls && answerKey === undefined`; read it rather than this.
 */
const SHOTS = path.resolve(__dirname, "../artifacts/demoted");
const FIXTURES = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans");
const GC_NAME = "ZZ-E2E Demoted GC";
const JOB = "ZZ-E2E Demoted — S05";

const VERDICT = {
  labels: [
    { id: 1, label: "CASEWORK", reason: "a counter" },
    { id: 2, label: "REFERENCE", reason: "a dimension line" },
  ],
  missing: [],
  model: "replayed-in-e2e",
};
/** Every run in view called a wall (ids past the last run are ignored by the viewer). */
const ALL_WALLS = {
  labels: Array.from({ length: 200 }, (_, i) => ({ id: i + 1, label: "WALL", reason: "a wall" })),
  missing: [],
  model: "replayed-in-e2e",
};

test.describe.configure({ mode: "serial" });

async function hydrated(page: Page, selector: string): Promise<void> {
  await expect
    .poll(
      () => page.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))),
      { timeout: 30_000, message: `${selector} never hydrated` },
    )
    .toBe(true);
}

const isActionPost = (r: Response) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined;

test.describe("demote, don't hide", () => {
  // The first step is the whole journey — sign-in, a job, an upload, a scale,
  // a find — and on a cold build it passed Playwright's 30s default by a few
  // seconds once. The real-sheet spec beside this one sets the same.
  test.setTimeout(240_000);
  let page: Page;
  let monitor: HealthMonitor;
  const servedPdf = readFileSync(path.join(FIXTURES, "S05.pdf"));
  let jobId = "";
  /** The real refusal's body and content type, captured once and replayed with the verdict swapped in. */
  let captured: { body: string; contentType: string } | null = null;
  /** Found with the switch OFF: every paired run, nothing demoted. The invariant below is found + demoted = this. */
  let baseline = 0;

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

  const port = () => page.locator('[data-testid="takeoff-plan-port"]');
  const overlay = () => port().locator("svg");
  const foundCount = async () => {
    const text = await page.locator('[data-takeoff="found-walls"]').textContent();
    const m = /Found (\d+) runs? of wall/.exec(text ?? "");
    expect(m, `no "Found N runs of wall" sentence in: ${text?.slice(0, 120)}`).not.toBeNull();
    return Number(m![1]);
  };

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
  async function findTheWalls(): Promise<number> {
    const findWalls = page.locator('[data-takeoff="find-walls"]');
    await expect(findWalls).toBeVisible({ timeout: 60_000 });
    // The button is enabled before the sheet has rendered, and a click then is
    // answered "The sheet is still loading" — wait for the drawing itself.
    await expect.poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 60_000 }).toBeGreaterThan(0);
    await settledOverlayBox();
    await hydrated(page, '[data-takeoff="find-walls"]');
    await findWalls.click();
    await expect(findWalls).toHaveText("Find the walls", { timeout: 180_000 });
    await expect(page.locator('[data-takeoff="check-runs"]')).toBeVisible({ timeout: 30_000 });
    return foundCount();
  }
  /** Route every later check through the captured refusal with the verdict swapped in. */
  async function replayVerdict(verdict: object = VERDICT): Promise<void> {
    await page.unroute(() => true);
    expect(captured, "the real check's response was never captured").not.toBeNull();
    const { body, contentType } = captured!;
    const at = body.indexOf('{"ok":false');
    expect(at, `no refusal row in the captured response: ${body.slice(0, 200)}`).toBeGreaterThanOrEqual(0);
    const end = body.indexOf("\n", at);
    const replaced =
      body.slice(0, at) + JSON.stringify({ ok: true, value: verdict }) + (end === -1 ? "" : body.slice(end));
    await page.route(
      (url) => url.pathname.startsWith("/takeoff/"),
      async (route) => {
        const req = route.request();
        if (req.method() === "POST" && req.headers()["next-action"] !== undefined) {
          await route.fulfill({ status: 200, contentType, body: replaced });
        } else {
          await route.fallback();
        }
      },
    );
  }

  test("switch off: the real check refuses without a model and the sheet is untouched", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);

    // ── MAKE THE SWITCH OFF, DO NOT ASSUME IT ──
    //
    // The grey-out is ON for every company now, so this case has to turn it
    // off to be about anything. It used to rely on the default being off,
    // which is how it failed the day the default moved — with a message that
    // read like a product defect rather than a stale premise.
    //
    // IDEMPOTENT, because retries share this database: an earlier attempt may
    // already have unticked and saved, so only the END state is asserted.
    //
    // HERE, before the job exists, because this is a COMPANY setting and
    // `openJobTab` asserts the job stage nav is on screen — a settings detour
    // in the middle of the job flow leaves the browser somewhere that
    // assertion cannot hold.
    await page.goto("/settings?tab=estimating");
    await hydrated(page, '[data-settings="demoted-walls"]');
    const offForm = page.locator('[data-settings="demoted-walls"]');
    const offBox = offForm.locator('input[name="demotedWallsOn"]');
    if (await offBox.isChecked()) {
      await offBox.uncheck();
      await offForm.getByRole("button", { name: "Save" }).click();
      await expect(offForm.getByText("Saved.")).toBeVisible({ timeout: 30_000 });
      await page.reload();
      await hydrated(page, '[data-settings="demoted-walls"]');
    }
    await expect(
      page.locator('[data-settings="demoted-walls"] input[name="demotedWallsOn"]'),
      "the grey-out is still on, so this case cannot be about the switch being off",
    ).not.toBeChecked();

    jobId = await startJob(page, monitor, { name: JOB, gcName: GC_NAME });
    await finishWizard(page, monitor, jobId);

    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "S05.pdf"));
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    await setScaleByClicking(64);
    await page.goto(`/takeoff/${jobId}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    const before = await findTheWalls();
    expect(before, "S05 should pair more than two runs").toBeGreaterThan(2);
    baseline = before;
    expect(await page.locator('[data-takeoff="demoted"]').count(), "the switch was turned off above, yet the model demoted at find").toBe(0);
    const [response] = await Promise.all([
      page.waitForResponse(isActionPost, { timeout: 60_000 }),
      page.locator('[data-takeoff="check-runs"]').click(),
    ]);
    captured = { body: await response.text(), contentType: response.headers()["content-type"] ?? "text/x-component" };
    await expect(page.locator('[data-takeoff="check-error"]')).toBeVisible({ timeout: 30_000 });
    expect(await foundCount(), "a refused check changed the total").toBe(before);
    expect(await page.locator('[data-takeoff="demoted"]').count()).toBe(0);
    expect(await page.locator('[data-takeoff="demoted-wall"]').count()).toBe(0);
    await expectHealthy(page, "check refused, switch off", { monitor, signedIn: false });
  });

  test("switch off, a verdict: the two runs are HIDDEN and only a re-find brings them back", async () => {
    await replayVerdict();
    const before = await foundCount();
    await page.locator('[data-takeoff="check-runs"]').click();
    await expect(page.locator('[data-takeoff="check-done"]')).toContainText("2 run(s) set aside", { timeout: 30_000 });
    expect(await foundCount()).toBe(before - 2);
    expect(await page.locator('[data-takeoff="demoted"]').count(), "the switch is off, yet a demoted panel showed").toBe(0);
    expect(await page.locator('[data-takeoff="demoted-wall"]').count()).toBe(0);
    await page.screenshot({ path: path.join(SHOTS, "01-switch-off-hidden.png") });
    await expectHealthy(page, "verdict, switch off", { monitor, signedIn: false });
  });

  test("the owner turns it on under Settings", async () => {
    await page.unroute(() => true);
    await page.goto("/settings?tab=estimating");
    const form = page.locator('[data-settings="demoted-walls"]');
    await expect(form).toBeVisible();
    await hydrated(page, '[data-settings="demoted-walls"]');
    const box = form.locator('input[name="demotedWallsOn"]');
    expect(await box.isEnabled(), "the takeoff persona is not an owner, so this spec cannot flip the switch").toBe(true);
    await box.check();
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText("Saved.")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.locator('[data-settings="demoted-walls"] input[name="demotedWallsOn"]')).toBeChecked();
    await page.screenshot({ path: path.join(SHOTS, "02-settings-switch.png") });
    await expectHealthy(page, "settings after the switch", { monitor });
  });

  test("switch on: Find the walls demotes by the model at once, no check pressed", async () => {
    // The PDF stub goes back BEFORE the navigation: `replayVerdict` unroutes
    // everything, and a viewer that fetches the sheet before the stub is
    // re-installed says "The sheet is still loading" to the click that follows.
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: servedPdf });
    });
    await page.goto(`/takeoff/${jobId}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    const found = await findTheWalls();
    const demoted = page.locator('[data-takeoff="demoted"]');
    await expect(demoted, "the model demoted nothing on the fixture, so the wiring is unproved").toBeVisible({ timeout: 30_000 });
    await expect(demoted).toContainText("the wall model doubts this one (score 0.11)");
    const rows = await page.locator('[data-takeoff="demoted-row"]').count();
    expect(rows).toBeGreaterThanOrEqual(1);
    expect(rows, "the invented model must leave some runs standing").toBeLessThan(baseline);
    expect(await page.locator('[data-takeoff="demoted-wall"]').count(), "rows without grey lines on the drawing").toBe(rows);
    expect(found, "found + demoted must equal the switch-off count").toBe(baseline - rows);
    expect(await page.locator('[data-takeoff="check-error"]').count(), "no check ran, so no check error").toBe(0);
    await page.screenshot({ path: path.join(SHOTS, "03-model-demoted-at-find.png") });
    await expectHealthy(page, "model demotion at find", { monitor, signedIn: false });
  });

  test("the check is the second opinion: its verdicts join the list, and one click puts a run back", async () => {
    await replayVerdict();
    await page.locator('[data-takeoff="check-runs"]').click();
    const demoted = page.locator('[data-takeoff="demoted"]');
    await expect(demoted).toContainText("casework: a counter", { timeout: 30_000 });
    await expect(demoted).toContainText("reference line: a dimension line");
    const rows = await page.locator('[data-takeoff="demoted-row"]').count();
    expect(await page.locator('[data-takeoff="demoted-wall"]').count()).toBe(rows);
    expect(await foundCount(), "found + demoted must equal the switch-off count").toBe(baseline - rows);
    await page.screenshot({ path: path.join(SHOTS, "04-model-and-check-demoted.png") });

    await page.locator('[data-takeoff="accept-demoted"]').first().click();
    await expect(page.locator('[data-takeoff="demoted-row"]')).toHaveCount(rows - 1);
    expect(await page.locator('[data-takeoff="demoted-wall"]').count()).toBe(rows - 1);
    expect(await foundCount(), "accepting did not put the run back in the total").toBe(baseline - rows + 1);
    await page.screenshot({ path: path.join(SHOTS, "05-one-accepted.png") });
    await expectHealthy(page, "verdict, switch on", { monitor, signedIn: false });
  });

  test("a check that calls every run a wall overrides the model: nothing left demoted", async () => {
    await replayVerdict(ALL_WALLS);
    await page.locator('[data-takeoff="check-runs"]').click();
    await expect(page.locator('[data-takeoff="check-done"]')).toContainText("Every run checked looks like a wall", { timeout: 30_000 });
    expect(await page.locator('[data-takeoff="demoted"]').count()).toBe(0);
    expect(await page.locator('[data-takeoff="demoted-wall"]').count()).toBe(0);
    expect(await foundCount(), "with every run a wall, the total is the switch-off count again").toBe(baseline);
    await expectHealthy(page, "all walls", { monitor, signedIn: false });
  });
});
