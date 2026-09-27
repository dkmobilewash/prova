import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, jobTab, landOnDashboard, startJob } from "../lib/journey";

/**
 * THE INGESTION RUNNER, DRIVEN BY A BROWSER — because the browser IS the worker.
 *
 * This is not a progress bar with a spec pointed at it. `PlanIngestPanel` calls
 * `advancePlanIngest` in a loop and that loop is what moves a run along: the
 * cron cannot, because this project is on Vercel's Hobby plan where a cron runs
 * ONCE PER DAY (measured — a `*​/5` schedule failed the deployment outright, and
 * Vercel's own error link resolves to its cron pricing page). So a run advancing
 * at all is a claim about the browser, and only a browser can check it.
 *
 * ── WHAT THIS FILE COVERS, AND WHAT IT DELIBERATELY DOES NOT ──
 *
 * It covers: the panel appears for somebody who may see job costs; the run
 * completes and reports 100% with the finished sentence; a reload afterwards
 * offers a fresh start rather than a stale bar; and the honest refusal when a
 * plan set has no sheet on file yet.
 *
 * It does NOT cover resumability — the property the whole design exists for —
 * and that omission is deliberate rather than an oversight. Catching a run
 * mid-flight needs the work to be slow, and `PAGE_INVENTORY` is a no-op that
 * finishes a handful of sheets inside one slice. A spec that tried would be a
 * race against itself, green or red by luck, which is worse than no spec.
 *
 * Resumability is proved in `lib/plan-ingest/claim.dbtest.ts` against a real
 * Postgres, where it can be set up exactly: a lapsed lease IS reclaimed, a live
 * one is NOT, a partially finished job reports its real counts, and a page at
 * the attempt ceiling is never claimed again. That is the right instrument for
 * it — the claim is a WHERE clause, and its correctness is a fact about Postgres
 * rather than about a screen.
 *
 * SAID PLAINLY so nobody reads this file as covering more than it does: if the
 * claim column stopped working tomorrow, `claim.dbtest.ts` goes red and this
 * file stays green.
 *
 * SERIAL: step 3 runs the job step 2 uploaded a sheet to.
 */
test.describe("plan-ingestion runner", () => {
  test.describe.configure({ mode: "serial", retries: 0, timeout: 180_000 });

  const JOB_NAME = "ZZ-E2E Ingest — Tower B fit-out";
  const GC_NAME = "ZZ-E2E Ingest GC";
  const PLAN_FIXTURE = path.resolve(__dirname, "../fixtures/plan-sheet.pdf");
  /** The same half-sheet-over-50-feet calibration `takeoff-plan.spec.ts` uses.
   *  The figures do not matter here — the calibration exists only because a
   *  `TakeoffPlanPage` row is what a saved scale creates, and the panel runs
   *  over the sheets ON FILE. */
  const DECLARED = "50'";

  let page: Page;
  let monitor: HealthMonitor;
  let jobId: string;

  const panel = (): Locator => page.locator('[data-plan-ingest="panel"]');
  const port = (): Locator => page.locator('[data-testid="takeoff-plan-port"]');
  const overlay = (): Locator => port().locator("svg");
  const tool = (label: string): Locator => page.getByRole("button", { name: label, exact: true });

  async function clickOverlay(fx: number, fy: number): Promise<void> {
    const box = await overlay().boundingBox();
    expect(box, "the measuring overlay must have a box before anything is clicked").not.toBeNull();
    await overlay().click({ position: { x: box!.width * fx, y: box!.width * fy } });
  }

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);

    // Answered in the browser so the server never reaches for a blob that does
    // not exist — the same stub `takeoff-plan.spec.ts` documents at length.
    const pdf = readFileSync(PLAN_FIXTURE);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
    });
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. a plan set with no sheet on file refuses honestly rather than starting", async () => {
    await signInAs(page, PERSONAS.planIngest.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: JOB_NAME, gcName: GC_NAME });
    await finishWizard(page, monitor, jobId);

    await jobTab(page, "Takeoff").click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await expectHealthy(page, "takeoff tab, nothing uploaded", { monitor });

    // No plan at all: the panel has nothing to be about and must not appear.
    await expect(panel(), "no plan set means no ingest panel").toHaveCount(0);

    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(PLAN_FIXTURE);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 30_000 });
    await expectHealthy(page, "takeoff tab after uploading a sheet", { monitor });

    // A plan with NO calibrated sheet: the panel appears, says what is missing,
    // and the button is DISABLED rather than clickable-then-refusing.
    //
    // THIS ASSERTION CHANGED AFTER A PERSON CLICKED IT on 2026-09-27. The first
    // version set that sentence as an `error` when the button was pressed, and
    // nothing cleared it — so after they went and set a scale, the panel still
    // told them to open the plan set in the viewer first. The advice was stale
    // and the app looked like it had not noticed. Derived from the prop it can
    // only be true while it is true, and the spec asserts the shape that cannot
    // go stale rather than the one that could.
    await expect(panel()).toBeVisible();
    await expect(
      panel().getByText(/Open this plan set in the viewer first/),
      "the panel should say what is missing before anybody presses anything",
    ).toBeVisible();
    await expect(
      panel().getByRole("button", { name: "Read the sheets" }),
      "with no sheet on file there is nothing to run over, so the button is refused up front",
    ).toBeDisabled();
    await expectHealthy(page, "ingest panel with no sheets on file", { monitor });
  });

  test("2. set a scale, which is what puts a sheet on file", async () => {
    // The calibration is setup, not the subject: `takeoffPlanPage` is upserted
    // when a scale is saved, and the panel runs over those rows. The geometry
    // itself is `takeoff-plan.spec.ts`'s to prove.
    await expect
      .poll(async () => port().locator("canvas").evaluate((node) => (node as HTMLCanvasElement).width), {
        timeout: 60_000,
        message: "pdf.js should render the sheet before anything is clicked on it",
      })
      .toBeGreaterThan(0);

    await tool("Set scale").click();
    await clickOverlay(0.2, 0.5);
    await clickOverlay(0.7, 0.5);
    const calibration = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await calibration.locator('input[name="declaredDistanceFeet"]').fill(DECLARED);
    await calibration.locator('input[name="pageLabel"]').fill("A-101 First Floor");
    await calibration.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 30_000 });
    await expectHealthy(page, "takeoff tab after setting the scale", { monitor });
  });

  test("3. the run advances to completion, driven by the page itself", async () => {
    await page.reload();
    await expectHealthy(page, "takeoff tab with one sheet on file", { monitor });

    await expect(panel()).toBeVisible();
    // The guidance from step 1 is GONE now a sheet exists, and the button is
    // live. This is the other half of the staleness fix: the sentence tracks
    // the prop in both directions, not just on first render.
    await expect(panel().getByText(/Open this plan set in the viewer first/)).toHaveCount(0);
    await expect(panel().getByRole("button", { name: "Read the sheets" })).toBeEnabled();
    await panel().getByRole("button", { name: "Read the sheets" }).click();

    // THE ASSERTION THIS FILE EXISTS FOR. Nothing polls on a timer and nothing
    // interpolates: the panel reaches 100% only because it asked the server for
    // slices until the server said there was nothing left. A cron could not
    // have done this — it runs once a day on this plan.
    await expect(panel().getByText("Every sheet read.")).toBeVisible({ timeout: 60_000 });

    // The figure is the two numbers, and they agree with each other. One sheet
    // is on file, so "1 of 1 sheet (100%)" — singular, because a progress line
    // that says "1 sheets" is the kind of thing a person reads as a bug.
    await expect(panel().locator('[data-plan-ingest="progress"]')).toContainText("1 of 1");
    await expect(panel().locator('[data-plan-ingest="progress"]')).toContainText("100%");
    await expect(panel().locator('[data-plan-ingest="progress"]')).toContainText("sheet (100%)");

    // Nothing failed, so no retry list and no amber count.
    await expect(panel().getByRole("button", { name: "Retry" })).toHaveCount(0);
    await expect(panel().getByText(/couldn't be read/)).toHaveCount(0);
    await expectHealthy(page, "takeoff tab after a completed run", { monitor });
  });

  test("4. a reload after completion offers a fresh start, not a stale bar", async () => {
    await page.reload();
    await expectHealthy(page, "takeoff tab reloaded after a completed run", { monitor });

    // `unfinishedIngestFor` must return null for a FINISHED job. If it returned
    // the finished run instead, the panel would render a permanent 100% bar and
    // the set could never be read again — which is the failure this step exists
    // to catch, and it is invisible from the run itself.
    await expect(panel()).toBeVisible();
    await expect(panel().getByRole("button", { name: "Read the sheets" })).toBeVisible();
    await expect(panel().locator('[data-plan-ingest="progress"]')).toHaveCount(0);
  });

  test("5. a field-function member sees no panel at all", async () => {
    // The panel and all four of its actions answer to VIEW_JOB_COSTS, which is
    // what this tab withholds — and the first version of those actions asserted
    // MANAGE_ESTIMATING instead, which would have refused an estimator who can
    // open the page and answered somebody who cannot.
    //
    // FIELD is a MEMBER inside MAIN's company, not this one, so it cannot reach
    // this job at all — which is the stronger check: the tab itself refuses
    // before any question about the panel arises.
    await signInAs(page, PERSONAS.field.email);
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expect(panel(), "a field-function member must not see the ingest panel").toHaveCount(0);
    await expect(page.getByRole("button", { name: "Read the sheets" })).toHaveCount(0);
  });
});
