import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { dataTour } from "../lib/dataTour";
import { finishWizard, jobTab, landOnDashboard, settleAction, startJob } from "../lib/journey";

/**
 * MEASURE A DRAWING ON SCREEN, AND WATCH THE QUANTITY REACH AN ESTIMATE LINE.
 *
 * #476 shipped a 663-line canvas/SVG measuring surface, #502 the banner that
 * says when what was measured came off superseded paper, and nobody had
 * clicked either. This is the one feature in the estimating batch that cannot
 * be checked any other way at all: the unit suite runs in happy-dom, where
 * `getBoundingClientRect` returns zeros (CLAUDE.md, "Cancel inherits the
 * delete pixel"), so a tool that converts a click position into a fraction of
 * a page width is invisible to it.
 *
 * WHAT IS STUBBED, AND WHAT IS NOT. Two network stubs, both in the BROWSER,
 * and nothing in the app is told it is under test:
 *
 *   1. the blob upload (lib/blobStub.ts, exactly as the journey's executed
 *      subcontract uses it). The server under test holds a fake blob token,
 *      so a real PUT would fail — and `recordTakeoffPlan`'s own
 *      `documentUrlProblem` check still runs for real against the URL the
 *      stub returns, because that URL names this suite's store and the
 *      `plan-takeoff/<jobId>/` prefix.
 *   2. `GET /api/takeoff/plan/<id>`, answered with the fixture PDF's bytes.
 *      That route re-reads the row, re-checks the company and re-checks the
 *      capability and then proxies the blob — and the blob does not exist
 *      here, so it would answer 502 and the viewer would render its
 *      "couldn't be opened" message instead of a sheet. SAID PLAINLY: this
 *      spec therefore does NOT cover that route. It covers pdf.js opening a
 *      real PDF, the geometry, and every write behind it. The route's own
 *      tenancy checks are `route.ts`'s to prove and have no coverage yet.
 *
 * EVERYTHING ELSE IS REAL — the calibration is set by two clicks on the
 * overlay and a typed dimension, the measurement by two more, and the
 * quantity that lands on the estimate is computed on the SERVER from the
 * stored geometry. There is nowhere in that form for a number.
 *
 * SERIAL: step 5 cannot measure a sheet step 3 did not calibrate.
 */
test.describe("on-screen plan takeoff", () => {
  test.describe.configure({ mode: "serial", retries: 0, timeout: 180_000 });

  const JOB_NAME = "ZZ-E2E Takeoff — Building E shell";
  const GC_NAME = "ZZ-E2E Takeoff GC";
  const PLAN_FIXTURE = path.resolve(__dirname, "../fixtures/plan-sheet.pdf");
  const MEASUREMENT_LABEL = "ZZ-E2E north corridor";
  /** What the posted lines are named — `createLineItemRows` prefixes every
   * derived line with it, which is how a bid with four takeoffs on it can say
   * which one each line came from. */
  const POST_LABEL = "ZZ-E2E Level 1";
  /** The calibration line spans 0.5 of the page width and is declared 50 ft,
   * so the sheet reads 100 ft across; the measured line spans 0.4 of the same
   * width, which is 40 ft. Both are this file's own arithmetic rather than a
   * figure read off the screen and blessed.
   *
   * WHY A TOLERANCE AND NOT AN EXACT FIGURE. A click lands on a device pixel,
   * so each fraction carries about +/-1/300 — the whole sheet is 300 CSS px
   * wide at this scale. The arithmetic is asserted to the precision a mouse
   * has, which is the honest form of the claim; an exact string here would be
   * a test that fails on a rounding nobody can control. What the figures
   * SHOULD be to the decimal is on the click-list for a person. */
  const DECLARED = "50'";
  const SHEET_FEET_ACROSS = 100;
  const EXPECTED_FEET = 40;
  const FEET_TOLERANCE = 1.5;

  let page: Page;
  let monitor: HealthMonitor;
  let jobId: string;
  /** What the overlay read while the shape was still a draft, carried into
   * step 5 so the stored row can be required to re-derive the same figure. */
  let drawnReading = "";

  const port = (): Locator => page.locator('[data-testid="takeoff-plan-port"]');
  const overlay = (): Locator => port().locator("svg");
  /** A tool in the viewer's toolbar, by the label `TOOLS` gives it
   * (lib/takeoff-plan-view.ts). Each name is unique on this page. */
  const tool = (label: string): Locator => page.getByRole("button", { name: label, exact: true });

  /** A click at a fraction of the sheet's WIDTH on both axes — which is the
   * contract the whole feature rests on (`pointAt` divides x AND y by the
   * rendered width, so a stored shape survives any zoom). */
  async function clickOverlay(fx: number, fy: number): Promise<void> {
    const box = await overlay().boundingBox();
    expect(box, "the measuring overlay must have a box before anything is clicked").not.toBeNull();
    await overlay().click({ position: { x: box!.width * fx, y: box!.width * fy } });
  }

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);

    // Answered in the browser, so the server never reaches for a blob that
    // does not exist. See the header for what this does and does not prove.
    const pdf = readFileSync(PLAN_FIXTURE);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
    });
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. an estimate-stage job with nothing measured on it yet", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: JOB_NAME, gcName: GC_NAME });
    await finishWizard(page, monitor, jobId);

    await jobTab(page, "Takeoff").click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await expectHealthy(page, "takeoff tab, nothing uploaded", { monitor });
    // `exact`, because the job's own h1 is its NAME and this job's name
    // contains the word — `getByRole` matches by substring unless told not to,
    // and two matches is a strict-mode violation rather than a pass.
    await expect(page.getByRole("heading", { name: "Takeoff", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No drawing on this job yet", exact: true })).toBeVisible();
    // The banner has nothing to say yet: no plan, so no plan can be stale.
    await expect(page.getByText(/came off drawings that have since been superseded/)).toHaveCount(0);
    await expect(page.getByText(/no issue date/)).toHaveCount(0);
  });

  test("2. upload a sheet, and the currency banner says it cannot date it (#502)", async () => {
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(PLAN_FIXTURE);
    await page.getByRole("button", { name: "Add a drawing" }).click();

    // The plan row exists, so the viewer and the revision prompt replace the
    // empty state.
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 30_000 });
    await expectHealthy(page, "takeoff tab after uploading a sheet", { monitor });

    // #502's honest answer for a sheet with no issue date: it does not claim
    // the measurements are current, and it does not claim they are stale.
    await expect(
      page.getByText(
        "1 plan here has no issue date, so nothing can tell whether its measurements came off current drawings.",
      ),
    ).toBeVisible();
  });

  test("3. the sheet renders, and two clicks plus a printed dimension set the scale (#476)", async () => {
    // pdf.js opened the document and drew a page. A canvas of zero width is
    // the shape a failed open takes, so this is the assertion that the viewer
    // works rather than merely mounts.
    await expect
      .poll(async () => port().locator("canvas").evaluate((node) => (node as HTMLCanvasElement).width), {
        timeout: 60_000,
        message: "pdf.js should render the sheet to a canvas with real pixels",
      })
      .toBeGreaterThan(0);
    await expect(page.getByText("Set the scale on this sheet before measuring.")).toBeVisible();

    // Every measuring tool is refused until there is a scale — the one rule
    // that keeps a quantity from existing without one.
    await expect(tool("Line"), "measuring is impossible before the scale is set").toBeDisabled();

    await tool("Set scale").click();
    await expect(page.getByText("Click once at each end of a dimension printed on the drawing.")).toBeVisible();
    await clickOverlay(0.2, 0.5);
    await clickOverlay(0.7, 0.5);

    const calibration = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await calibration.locator('input[name="declaredDistanceFeet"]').fill(DECLARED);
    await calibration.locator('input[name="pageLabel"]').fill("A-101 First Floor");
    // The readback is the safeguard: the dimension is repeated in the
    // estimator's own vocabulary and the sheet width is stated, while the
    // drawing is still on screen.
    await expect(page.getByText("Reading that back: 50'-0\".")).toBeVisible();
    const across = page.getByText(/^This sheet reads \d+ ft across\.$/);
    await expect(across).toBeVisible();
    const acrossFeet = Number((await across.innerText()).match(/(\d+) ft/)![1]);
    expect(
      Math.abs(acrossFeet - SHEET_FEET_ACROSS),
      `50 ft over half the sheet means the sheet reads about ${SHEET_FEET_ACROSS} ft across; it read ${acrossFeet}`,
    ).toBeLessThanOrEqual(3);

    await calibration.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 30_000 });
    await expectHealthy(page, "takeoff tab after setting the scale", { monitor });
    await expect(tool("Line"), "a scale makes the measuring tools available").toBeEnabled();
  });

  test("4. trace a run, and the length it reads is the geometry times the scale (#476)", async () => {
    await tool("Line").click();
    await clickOverlay(0.2, 0.6);
    await clickOverlay(0.6, 0.6);

    // 0.4 of a page width, on a sheet that reads 100 ft across.
    const readout = page.getByText(/^2 points · [\d.]+ ft$/);
    await expect(readout).toBeVisible();
    const reading = (await readout.innerText()).replace("2 points · ", "");
    drawnReading = reading;
    const feet = Number(reading.replace(" ft", ""));
    expect(
      Math.abs(feet - EXPECTED_FEET),
      `four fifths of a 50 ft dimension is about ${EXPECTED_FEET} ft; the overlay read ${reading}`,
    ).toBeLessThanOrEqual(FEET_TOLERANCE);

    const measurement = page.locator("form").filter({ has: page.getByRole("button", { name: /^Save \(/ }) });
    await measurement.locator('input[name="label"]').fill(MEASUREMENT_LABEL);
    // Waits for the action's answer, so the reload cannot race the write whose
    // stored geometry is about to be read back.
    await settleAction(page, () => measurement.getByRole("button", { name: `Save (${reading})` }).click());

    await page.reload();
    await expectHealthy(page, "takeoff tab after saving a measurement", { monitor });
    // Read back from the server through `measurementPrimitive`, the same pure
    // function the action re-ran before writing — not from the draft that was
    // drawn. The two must agree to the decimal, which is the claim that the
    // geometry survived the round trip.
    const row = page.locator("li").filter({ hasText: MEASUREMENT_LABEL }).first();
    await expect(row).toContainText("Line");
    await expect(row, "what the server stores must re-derive to what was drawn").toContainText(reading);
  });

  test("5. that measurement becomes estimate lines, priced by nobody (#476)", async () => {
    const row = page.locator("li").filter({ hasText: MEASUREMENT_LABEL }).first();
    await row.locator('input[type="checkbox"]').check();

    const post = page.locator("form").filter({ has: page.getByRole("button", { name: /to the estimate$/ }) });
    // "Wall (drywall)" is the first plan recipe and the default; named so a
    // reordered recipe list cannot silently change what is added.
    await post.getByRole("combobox", { name: "Add as" }).selectOption("wall");
    await post.locator('input[name="label"]').fill(POST_LABEL);
    // The height is the one thing a drawing cannot carry.
    await post.locator('input[name="heightFt"]').fill("9");

    await settleAction(page, () => post.getByRole("button", { name: "Add 1 to the estimate" }).click());

    await page.reload();
    await expectHealthy(page, "takeoff tab after adding to the estimate", { monitor });
    // Posting is not idempotent, so the row says it has gone and its checkbox
    // is closed — which is what stops a second press doubling a bid.
    const posted = page.locator("li").filter({ hasText: MEASUREMENT_LABEL }).first();
    await expect(posted).toContainText("already on the estimate");
    // Posting changes nothing about what the shape reads: the measurement is
    // the record, the line item is a copy taken from it.
    await expect(posted, "adding to the estimate must not move the measurement").toContainText(drawnReading);
    await expect(posted.locator('input[type="checkbox"]')).toBeDisabled();

    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "estimate tab after a plan takeoff", { monitor });
    const lines = page.locator(dataTour("job-line-items")).locator('input[name="description"]');
    const descriptions = await lines.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLInputElement).value),
    );
    expect(
      descriptions.filter((value) => value.startsWith(`${POST_LABEL} — `)).length,
      `a measured wall should land on the estimate named after where it was measured; got ${JSON.stringify(descriptions)}`,
    ).toBeGreaterThan(0);
    // Lines arrive UNPRICED — the takeoff supplies the quantity and nothing
    // else, which is the rule the page states in so many words.
    const unpriced = page
      .locator(dataTour("job-line-items"))
      .locator("form")
      .filter({ has: page.locator(`input[name="description"][value^="${POST_LABEL} — "]`) })
      .first();
    await expect(unpriced.locator('input[name="unitPrice"]')).toHaveValue("");
  });

  test("6. dating the sheet answers the currency question (#502)", async () => {
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expectHealthy(page, "takeoff tab", { monitor });

    await page.getByRole("button", { name: "Which revision is this?" }).click();
    const revision = page.locator("form").filter({ has: page.locator('input[name="revisionLabel"]') });
    await revision.locator('input[name="revisionLabel"]').fill("Rev 1");
    // ENTERED, not stamped: the date printed on the sheet is what later
    // revisions are compared against.
    await revision.locator('input[name="sheetIssuedOn"]').fill("2026-01-12");
    await settleAction(page, () => revision.getByRole("button", { name: "Save" }).click());

    await page.reload();
    await expectHealthy(page, "takeoff tab after dating the sheet", { monitor });
    await expect(page.getByRole("button", { name: "Rev 1 · 2026-01-12" })).toBeVisible();
    // Nothing has been issued since, so the banner has nothing to say and
    // does not render at all — no plan is described as stale, and none is
    // described as unknowable.
    await expect(page.getByText(/no issue date/)).toHaveCount(0);
    await expect(page.getByText(/came off drawings that have since been superseded/)).toHaveCount(0);
  });

  test("7. nothing crashed the browser, anywhere on the measuring surface", async () => {
    // A REAL CRASH FAILS THIS STEP; THE SHELL'S KNOWN HYDRATION RACE IS
    // RECORDED INSTEAD OF ASSERTED, AND THAT IS A DELIBERATE CALL.
    //
    // `monitor.crashes` is an uncaught exception — a page that fell over — and
    // nothing excuses one.
    //
    // `monitor.hydrationMismatches` is React #418 from the SIGNED-IN SHELL,
    // diagnosed in #501 with Diego's fix pending. It fires on roughly one
    // authenticated page load in three, on /jobs/new and on every job tab, and
    // `journey.spec.ts`'s step 11 ALREADY fails the whole run over it — by
    // name, listing every URL it happened on. Asserting it again here would
    // make four specs red for one defect that belongs to none of them, and
    // would bury whether the screens this file exists for actually work. It is
    // attached to this test's report instead: visible, counted, and not
    // pretending the defect is gone.
    //
    // The moment #501 lands this goes back to being an assertion. It is one
    // line, and it is this comment's job to make sure somebody does it.
    if (monitor.hydrationMismatches.length > 0) {
      test.info().annotations.push({
        type: "known-hydration-race-501",
        description:
          `${monitor.hydrationMismatches.length} React #418 hydration mismatch(es) on the signed-in shell — ` +
          `journey.spec.ts step 11 is what fails the run over this:\n${monitor.hydrationMismatches.join("\n")}`,
      });
    }
    expect(monitor.crashes, "an uncaught exception reached the browser").toEqual([]);
  });
});
