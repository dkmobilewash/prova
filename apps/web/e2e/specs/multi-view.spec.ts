import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── STEPS 6-17 OF THE CLICK-LIST, DRIVEN RATHER THAN DESCRIBED ──
 *
 *     pnpm test:e2e -- specs/multi-view.spec.ts
 *
 * The one thing no unit test in this repo can answer: whether the caution the
 * census proves is WIRED actually REACHES A SCREEN. `sheetViews.ts` is read in
 * the browser from the page's own text, inside an effect, so there is no prop
 * to drive and no PDF in happy-dom — which is why `takeoffWallFinder.test.tsx`
 * says its multi-view block asserts the wiring and not the render.
 *
 * ── THE SHAPE IS COPIED FROM `takeoff-plan.spec.ts` ON PURPOSE ──
 *
 * A from-scratch version of this did not upload at all: the file attached, the
 * button was enabled, the click landed and NO REQUEST WAS EVER MADE. Five runs
 * went into finding the difference by reasoning about it and none of them did.
 * The working spec's sequence is proven, so this follows it exactly and varies
 * only the sheet — the cheaper way round, and the one this repo's own rule
 * about fixing the harness rather than reading its result points at.
 *
 * Screenshots land in `e2e/artifacts/multi-view/` so a failure can be looked at
 * rather than argued about.
 */
const SHOTS = path.resolve(__dirname, "../artifacts/multi-view");
const FIXTURES = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans");
const BENCH = path.resolve(__dirname, "../../../../reports/takeoff-bench/fixtures/pdf");
const CAUTION = '[data-takeoff="duplicate-walls-caution"]';

test.describe("a sheet that carries more than one drawing", () => {
  test.describe.configure({ mode: "serial", retries: 0, timeout: 300_000 });

  const JOB_NAME = "ZZ-E2E Multi-view — two drawings, two scales";
  const GC_NAME = "ZZ-E2E Multi-view GC";

  /** Which sheet the viewer gets back when it asks for what was uploaded. The
   *  blob write is stubbed, so the real URL holds nothing. Three different
   *  sheets go up in one run, so this is read at request time rather than
   *  fixed, which is the one way this differs from the spec it copies. */
  let servedPdf: Buffer = readFileSync(path.join(FIXTURES, "S02.pdf"));

  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: servedPdf });
    });
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  const port = () => page.locator('[data-testid="takeoff-plan-port"]');
  const overlay = () => port().locator("svg");
  const tool = (label: string) => page.getByRole("button", { name: label, exact: true });

  /** The overlay's box once it has stopped resizing, so a click lands where
   *  it was asked to. Copied from `takeoff-plan.spec.ts` for the same reason. */
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

  /**
   * ── SETTING THE SCALE BY HAND, AND WHY IT HAS TO BE BY HAND ──
   *
   * The viewer's offered scale comes from the SERVER, out of the plan-ingest
   * stage, which reads the PDF out of the blob store. That store is stubbed in
   * the BROWSER here, so the server has nothing to read and offers nothing —
   * `Find the walls` stays disabled and no "Use this dimension" ever appears.
   * That is the harness's limit, not a defect: the same two clicks an estimator
   * makes set the scale, which is what `takeoff-plan.spec.ts` does too.
   *
   * The pair spans exactly half the sheet, so the declared distance is half the
   * sheet's true width in feet — its paper width in inches times the feet each
   * inch stands for at the PRIMARY view's scale. Getting this wrong would scale
   * every figure below, which is why it is computed per sheet rather than
   * reused.
   */
  async function setScaleByClicking(halfSheetFeet: number): Promise<void> {
    await expect
      .poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), {
        timeout: 60_000,
        message: "pdf.js should render the sheet to a canvas with real pixels",
      })
      .toBeGreaterThan(0);
    await tool("Set scale").click();
    const box = await settledOverlayBox();
    await overlay().click({ position: { x: box.width * 0.2, y: box.width * 0.5 } });
    await overlay().click({ position: { x: box.width * 0.7, y: box.width * 0.5 } });
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await form.locator('input[name="declaredDistanceFeet"]').fill(String(halfSheetFeet));
    await form.locator('input[name="pageLabel"]').fill("sheet 1");
    await form.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 30_000 });
  }

  /**
   * A JOB OF ITS OWN FOR EACH SHEET.
   *
   * Uploading a second sheet onto the same job leaves two plans on the page,
   * and the run then hung for the full five-minute timeout rather than failing
   * with a reason. One sheet per job keeps each check about one sheet, which is
   * what the click-list asks anyway.
   */
  async function freshJob(name: string): Promise<void> {
    await landOnDashboard(page, monitor);
    const id = await startJob(page, monitor, { name, gcName: GC_NAME });
    await finishWizard(page, monitor, id);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${id}/takeoff$`));
  }

  /** Upload one sheet, find its walls, screenshot, and return the caution. */
  async function takeOff(pdf: string, label: string, halfSheetFeet: number): Promise<string> {
    servedPdf = readFileSync(pdf);
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(pdf);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({
      timeout: 60_000,
    });
    await expectHealthy(page, `takeoff tab after uploading ${label}`, { monitor });

    await setScaleByClicking(halfSheetFeet);

    const find = page.locator('[data-takeoff="find-walls"]');
    await expect(find, "Find the walls never became available").toBeEnabled({ timeout: 60_000 });
    await find.click();
    await expect(find).toHaveText("Find the walls", { timeout: 180_000 });
    await page.waitForTimeout(800);

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${label}.png`), fullPage: true });
    const caution = page.locator(CAUTION);
    const said = (await caution.count()) === 0 ? "" : await caution.first().innerText();
    console.log(`[caution] ${label}: ${said === "" ? "(none)" : JSON.stringify(said)}`);
    return said;
  }

  test("1. an estimate-stage job with nothing measured on it yet", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: JOB_NAME, gcName: GC_NAME });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await expectHealthy(page, "takeoff tab, nothing uploaded", { monitor });
    await expect(
      page.getByRole("heading", { name: "No drawing on this job yet", exact: true }),
    ).toBeVisible();
  });

  test("steps 6-8: an ordinary single-view sheet says NOTHING", async () => {
    // 19 of the 20 fixtures are single-view and must take exactly the path they
    // took before any of this existed. A caution here would nag on every sheet
    // in the product, which is how a real one stops being read.
    const said = await takeOff(path.join(FIXTURES, "S02.pdf"), "step6-8-S02-single-view", 48);
    expect(said, `a single-view sheet showed a caution: "${said}"`).toBe("");
  });

  test("steps 9-12: S15 splits, and the caution names the other drawing AND its footage", async () => {
    await freshJob(`${JOB_NAME} — S15`);
    const said = await takeOff(path.join(FIXTURES, "S15.pdf"), "step9-12-S15-split", 72);
    expect(said, "no caution appeared on a two-view sheet").not.toBe("");
    expect(said).toContain("ENLARGED BATH PLAN");
    expect(said).toContain("1/2\" = 1'-0\"");
    expect(said).toMatch(/\b28 ft\b/);
    expect(said).toContain("NOT included");
    expect(said).toContain("FLOOR PLAN");
    expect(said).toContain("1/4\" = 1'-0\"");
  });

  test("steps 13-17: A-401 excludes the NTS detail AND NAMES IT", async () => {
    await freshJob(`${JOB_NAME} — A401`);
    const said = await takeOff(path.join(BENCH, "A-401__clean.pdf"), "step13-17-A401-nts", 72);
    expect(said, "no caution appeared on a three-view sheet").not.toBe("");
    expect(said).toContain("ENLARGED STAIR PLAN");
    expect(said).toContain("1/2\" = 1'-0\"");
    // 17 — Diego's rule: nothing is excluded silently.
    expect(said).toContain("HEAD OF WALL DETAIL");
    expect(said).toMatch(/not to scale/i);
    expect(said).toContain("Left out of the quantities");
  });

  test("the browser threw nothing across all three sheets", async () => {
    expect(monitor.crashes, "a page crashed while driving the three sheets").toEqual([]);
  });
});
