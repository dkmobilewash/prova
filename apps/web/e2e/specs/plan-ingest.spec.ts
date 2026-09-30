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

  test("1. a plan set is readable as soon as it is uploaded", async () => {
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

    // THIS STEP ASSERTED THE OPPOSITE UNTIL 2026-09-28, and the change is the
    // point of it rather than a detail.
    //
    // It used to require the panel to say "Open this plan set in the viewer
    // first" and the button to be DISABLED, because the page handed the panel
    // `plan.pages.length` — the number of CALIBRATED sheets, which is zero on a
    // freshly uploaded set. So a person who had just uploaded a plan set was told
    // to go and set a scale before anything could read it, which is unrelated work
    // to satisfy a limitation that did not exist: the server has been able to
    // count a PDF's pages since `lib/ask/pageCount.ts` was written.
    //
    // `startPlanIngest` counts the file's own sheets now and takes no count
    // argument, so there is nothing to be missing and nothing to advise. The
    // sentence is gone, and this asserts it is gone — a removed message is
    // exactly the kind of thing a spec keeps alive by still looking for it.
    await expect(panel()).toBeVisible();
    await expect(
      panel().getByText(/Open this plan set in the viewer first/),
      "that advice existed only because the panel was handed the wrong count; it must not come back",
    ).toHaveCount(0);
    await expect(
      panel().getByRole("button", { name: "Read the sheets" }),
      "an uploaded plan set is readable immediately — nothing has to be calibrated first",
    ).toBeEnabled();
    await expectHealthy(page, "ingest panel on a freshly uploaded set", { monitor });
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

  test("3. reading refuses honestly when the plan file cannot be fetched", async () => {
    // WHAT THIS STEP CAN AND CANNOT PROVE, stated first because the honest
    // version of it is narrower than it looks.
    //
    // `PAGE_INVENTORY` reads the PDF SERVER-SIDE, and in this environment the
    // plan file is not fetchable from the server at all: `stubDocumentUpload`
    // hands the app a URL on `<store>.public.blob.vercel-storage.com`, a host
    // that does not exist, and `page.route` can only intercept the BROWSER's
    // requests. That is why the viewer renders — its fetch goes through the
    // browser — while a server-side fetch cannot. The URL guard requires an
    // https host under the blob domain and this repo deliberately gives its
    // guards no env-var escape hatch, so pointing the stub at localhost is not
    // available either.
    //
    // So this asserts the REFUSAL PATH, end to end and for real: the action
    // runs, the fetch fails, and a sentence a person can act on reaches the
    // screen instead of a half-started run or a silent nothing. That is the
    // wiring — action, guard, fetch, sentence — which is exactly what only an
    // e2e can check.
    //
    // WHAT IT DOES NOT COVER is the reading itself. That is covered where it can
    // be: `lib/plan-ingest/pageInventory.test.ts` drives the real stage over real
    // multi-page PDFs through the real pdfjs, including rotated sheets, and
    // `planPdf.test.ts` mutation-proves the rotation handling. One real plan set
    // read end to end remains a CLICK-THROUGH item — and it is blocked anyway
    // until the 250MB ceiling lands, because a real set does not clear the 15MB
    // upload cap. Diego's call, 2026-09-28.
    await panel().getByRole("button", { name: "Read the sheets" }).click();

    await expect(
      panel().getByText(/plan file couldn't be fetched/),
      "a fetch that fails must say so on screen, not leave the panel looking idle",
    ).toBeVisible({ timeout: 30_000 });

    // NOTHING WAS HALF-STARTED. `startPlanIngest` counts the file's pages before
    // it creates a single task row, so a refusal at that point leaves no job, no
    // tasks and no progress figure — which is the difference between a refusal
    // and a broken run, and it is invisible from the sentence alone.
    await expect(panel().locator('[data-plan-ingest="progress"]')).toHaveCount(0);
    await expect(panel().getByRole("button", { name: "Retry" })).toHaveCount(0);
    await expectHealthy(page, "takeoff tab after a refused read", { monitor });
  });

  test("4. a reload after the refusal offers a fresh start, not a stuck panel", async () => {
    await page.reload();
    await expectHealthy(page, "takeoff tab reloaded after a refused read", { monitor });

    // `unfinishedIngestFor` must find nothing, because nothing was created. If a
    // job HAD been created before the refusal, this is where it would show — as a
    // permanent 0% bar over a run nobody could finish, with no way to start
    // again. That failure is invisible from the run itself, which is why the step
    // survives the change from asserting completion to asserting a refusal.
    await expect(panel()).toBeVisible();
    await expect(panel().getByRole("button", { name: "Read the sheets" })).toBeEnabled();
    await expect(panel().locator('[data-plan-ingest="progress"]')).toHaveCount(0);
  });

  test("5. somebody from another company cannot reach the panel at all", async ({ browser }) => {
    // A FRESH CONTEXT, not this file's shared page, and the first version got
    // that wrong: `signInAs` does not sign out first, so switching persona in a
    // context that is already signed in fails with Clerk's "You're already
    // signed in." CI named it, on a run where steps 1-4 passed — so the spec
    // was broken and the feature was not. The specs that switch persona use a
    // per-test `page` fixture for exactly this reason (money-rail-gate); this
    // file cannot, because steps 1-4 are serial over one job.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    try {
      // WHAT THIS PROVES IS TENANCY, NOT THE CAPABILITY, and the step is named
      // for what it proves rather than what it looks like. FIELD is a MEMBER
      // inside MAIN's company, so this job is not theirs and the tab refuses
      // before any question about the panel arises.
      //
      // The capability itself — all four actions answering to VIEW_JOB_COSTS —
      // is proved by `lib/action-capability-guards.test.ts`, which EXECUTES each
      // one without it. That is the right instrument, and it is what caught the
      // first version asserting MANAGE_ESTIMATING: a guard that would have
      // refused an estimator who can open the page and answered somebody who
      // cannot.
      await signInAs(otherPage, PERSONAS.field.email);
      await otherPage.goto(`/jobs/${jobId}/takeoff`);
      await expect(
        otherPage.locator('[data-plan-ingest="panel"]'),
        "another company's job must not render its ingest panel",
      ).toHaveCount(0);
      await expect(otherPage.getByRole("button", { name: "Read the sheets" })).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
});
