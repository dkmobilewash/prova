import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── A RESULT MUST NOT APPEAR ON A SHEET IT HAS NOTHING TO DO WITH ──
 *
 * Reported from the workspace: Find the walls was pressed on A120, and the
 * same orange runs then appeared on A130 (PARTITION TYPES) and A140 (PLAN
 * DETAILS), in identical positions, on drawings with no walls on them at all.
 *
 * The viewer had already been through this with the wall GROUPS and fixed it
 * — `wallsOnThisSheet` keeps the page beside the result — and four states
 * added later did not follow the rule: the answer-key review, the check's
 * labels, its missed-wall list, and the name of the view the quantities are
 * about. `lib/takeoff/perSheet.ts` is now the one place that decides, and
 * `perSheet.test.ts` proves the decision.
 *
 * THIS SPEC EXISTS BECAUSE THAT UNIT TEST CANNOT SEE THE WIRING. It proves
 * the function; it cannot prove that both components ask it, which is exactly
 * the half that was broken. `wallGroups.ts` says in its own header why no
 * rendered test can reach this: the viewer opens on page 1 and its pager only
 * appears once a real PDF reports `numPages`, which never happens in
 * happy-dom. A real browser with a real multi-page PDF is the only instrument
 * for it.
 *
 * ── THE FIXTURE IS BUILT, NOT BORROWED ──
 *
 * Every committed fixture is ONE page, and a guarded assertion that can never
 * run is the vacuous shape this suite exists to avoid. So three DIFFERENT
 * drawings are stitched into one set here: different, because three copies of
 * one sheet would make "the same runs appear" indistinguishable from "this
 * sheet genuinely has those runs".
 */

const SHOTS = path.resolve(__dirname, "../artifacts");
const FIXTURES = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans");
const GC_NAME = "ZZ-E2E One Sheet GC";

test.describe.configure({ mode: "serial" });

test.describe("a find belongs to the sheet it was run on", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let servedPdf: Buffer | null = null;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    monitor = new HealthMonitor(page);
    // The viewer fetches the plan through the app; the blob does not exist in
    // this suite, so the bytes are served from the fixture. Exactly the stub
    // `takeoff-workspace.spec.ts` uses, and for the reason its header gives.
    await page.route("**/api/takeoff/plan/**", async (route) => {
      if (servedPdf === null) return route.continue();
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: servedPdf,
      });
    });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  /** How many marks of each kind are on the sheet right now. */
  async function overlayCounts(): Promise<{ runs: number; candidates: number }> {
    return {
      runs: await page.locator("[data-found-wall]").count(),
      candidates: await page.locator('[data-takeoff="key-line"]').count(),
    };
  }

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

  /** Move to a sheet by its number in the set, and wait for it to render. */
  async function goToSheet(n: number): Promise<void> {
    await page.locator('[data-takeoff="sheet-picker"]').selectOption(String(n));
    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid="takeoff-plan-port"] canvas')
            .evaluate((node) => (node as HTMLCanvasElement).width),
        { timeout: 60_000, message: `sheet ${n} never rendered` },
      )
      .toBeGreaterThan(0);
    await page.waitForTimeout(500);
  }

  test("three different drawings in one set, the first one scaled", async () => {
    await signInAs(page, PERSONAS.takeoff.email);

    mkdirSync(SHOTS, { recursive: true });
    const threePage = path.join(SHOTS, "three-sheets.pdf");
    const { PDFDocument } = await import("pdf-lib");
    const set = await PDFDocument.create();
    for (const name of ["S02.pdf", "S15.pdf", "S10.pdf"]) {
      const source = await PDFDocument.load(readFileSync(path.join(FIXTURES, name)));
      const [copied] = await set.copyPages(source, [0]);
      set.addPage(copied);
    }
    writeFileSync(threePage, await set.save());
    servedPdf = readFileSync(threePage);

    await landOnDashboard(page, monitor);
    const id = await startJob(page, monitor, { name: "ZZ-E2E One Sheet", gcName: GC_NAME });
    await finishWizard(page, monitor, id);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${id}/takeoff$`));
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(threePage);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({
      timeout: 60_000,
    });
    // ── THE FIRST SHEET IS SCALED BY THE APP'S OWN FLOW, NOT HOPED FOR ──
    //
    // The two tests below need Find the walls on sheet 1, and Find is disabled
    // without a scale. They used to SKIP when sheet 1 had none, which in CI was
    // every run — so neither ever ran there. Sheet 1 is S02, and the viewer
    // opens on page 1: set its scale here the way `takeoff-workspace.spec.ts`
    // sets S02's (half the sheet is 48 ft), so the precondition is guaranteed
    // and the tests below assert it instead of skipping on it.
    await setScaleByClicking(48);

    await page.goto(`/takeoff/${id}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await expect(
      page.locator('[data-takeoff="sheet-picker"]'),
      "a three-page set rendered no pager, so this spec would prove nothing",
    ).toBeVisible({ timeout: 60_000 });
    // `signedIn: false` because `/takeoff/[id]` is authenticated and
    // deliberately OUTSIDE the `(app)` route group — it has no sidebar and no
    // top bar, so that the drawing gets every pixel. `health.ts` documents
    // the exemption and every other workspace assertion in the suite passes
    // it; this one call omitted it and looked for a main navigation the route
    // is designed not to have. Everything else the check does — crash
    // markers, uncaught exceptions, the rendered-next-to-nothing floor —
    // still applies, which is what makes it safe to pass.
    await expectHealthy(page, "workspace, three-sheet set", { monitor, signedIn: false });
  });

  test("RUNS FOUND ON SHEET 1 DO NOT APPEAR ON SHEET 2 OR SHEET 3", async () => {
    await goToSheet(1);

    // The scale, set by the viewer's own two clicks, so Find the walls can run.
    const find = page.locator('[data-takeoff="find-walls"]');
    await expect(find, "sheet 1 was scaled in the first test, so Find the walls should be enabled").toBeEnabled({
      timeout: 60_000,
    });
    await find.click();
    await expect(find).toHaveText(/^(Find the walls|Run takeoff)$/, { timeout: 180_000 });
    await page.waitForTimeout(800);

    // ── THE CONTROL: THERE IS SOMETHING TO LEAK ──
    //
    // Without this the two assertions below pass on a sheet where nothing was
    // found at all, which is the vacuous green this suite exists to end.
    const onOne = await overlayCounts();
    expect(onOne.runs, "nothing was found on sheet 1, so nothing could leak").toBeGreaterThan(0);

    for (const sheet of [2, 3]) {
      await goToSheet(sheet);
      const here = await overlayCounts();
      expect(here.runs, `sheet 1's runs are drawn on sheet ${sheet}`).toBe(0);
      expect(
        here.candidates,
        `sheet 1's answer-key candidates are drawn on sheet ${sheet}`,
      ).toBe(0);
    }

    // ── AND THE WORK IS NOT THROWN AWAY BY LOOKING ELSEWHERE ──
    //
    // The fix keys results by page rather than clearing them on a page change,
    // deliberately: an answer-key review is an hour of somebody's judgement.
    await goToSheet(1);
    const back = await overlayCounts();
    expect(back.runs, "paging away and back lost sheet 1's result").toBe(onOne.runs);
    await expectHealthy(page, "after paging across three sheets", { monitor });
  });

  test("THE QUANTITIES PANEL IS EMPTY ON A SHEET NOBODY HAS RUN", async () => {
    // The overlay is what was reported; this is the half that would reach a
    // bid. A total from one drawing shown against another is the failure
    // worth being loudest about.
    await goToSheet(1);
    // ── THE SAME PRECONDITION THE TEST ABOVE ASSERTS ──
    //
    // This test counts the groups a FIND produced, and the find is run by
    // "RUNS FOUND ON SHEET 1 DO NOT APPEAR ON SHEET 2 OR SHEET 3" above. That
    // test used to skip when sheet 1 had no scale, because the Find button is
    // disabled without one — and this one did not, so it ran with nothing
    // found and reported 0 groups against its own control. The first test now
    // sets the scale, so both assert it rather than skip on it.
    //
    // Which is the control doing its job: zero groups really does mean
    // nothing could leak. The bug was that the two tests disagreed about
    // whether the sheet was usable. They share the condition now.
    //
    // It surfaced today because the test BEFORE both of them was failing on
    // an unrelated assertion, so execution never reached here.
    const find = page.locator('[data-takeoff="find-walls"]');
    await expect(find, "sheet 1 was scaled in the first test, so the find above ran").toBeEnabled({
      timeout: 60_000,
    });
    const groups = page.locator('[data-takeoff="found-group"]');
    // ── THE CONTROL, AGAIN, AND NOT A GUARD ──
    //
    // The first version of this wrapped the assertion in `if (hadPanel)`,
    // which would have skipped silently for ever if the panel's handle ever
    // changed — the vacuous shape this file's header complains about, written
    // into the file by the same hand. A count that must be positive HERE is
    // the control; the assertion below is then about something.
    const listedOnOne = await groups.count();
    expect(listedOnOne, "sheet 1 listed no wall groups, so nothing could leak").toBeGreaterThan(0);

    await goToSheet(2);
    expect(await groups.count(), "sheet 1's wall quantities are listed on sheet 2").toBe(0);
    expect(
      await page.locator('[data-takeoff="check-missing"]').count(),
      "sheet 1's missed-wall list is shown on sheet 2",
    ).toBe(0);
    await expectHealthy(page, "quantities on an unrun sheet", { monitor });
  });
});
