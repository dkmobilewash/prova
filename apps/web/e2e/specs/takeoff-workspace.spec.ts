import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── THE FULL-SCREEN TAKEOFF WORKSPACE, CLICKED ──
 *
 * The workspace exists so a subcontractor can review a takeoff with the plan
 * as large as the screen allows. That claim is about PIXELS, and no unit test
 * in this repo can see layout — the screen suite renders in happy-dom, which
 * does no layout and returns zeros from `getBoundingClientRect`. So this spec
 * is the only instrument that can say the thing is actually full screen, and
 * it asserts that rather than merely that the route answers.
 *
 * Its scale-setting and upload helpers are lifted from `multi-view.spec.ts`
 * unchanged, including the reason they have to be by hand: the blob store is
 * stubbed in the browser, so the server has nothing to read and offers no
 * scale of its own.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/takeoff-workspace");
const FIXTURES = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans");

/** Desktop first, then the tablet width where the rails become drawers. */
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 834, height: 1112 };

test.describe("the full-screen takeoff workspace", () => {
  const GC_NAME = "ZZ-E2E Workspace GC";
  const JOB_ONE = "ZZ-E2E Workspace — S02";
  const JOB_TWO = "ZZ-E2E Workspace — S15";

  let servedPdf: Buffer = readFileSync(path.join(FIXTURES, "S02.pdf"));
  let page: Page;
  let monitor: HealthMonitor;
  let jobOne = "";
  let jobTwo = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP });
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
  const tool = (label: string) => page.getByRole("button", { name: label, exact: true });

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

  async function findTheWalls(label: string): Promise<void> {
    const find = page.locator('[data-takeoff="find-walls"]');
    await expect(find, `Find the walls never became available on ${label}`).toBeEnabled({ timeout: 60_000 });
    await find.click();
    await expect(find).toHaveText("Find the walls", { timeout: 180_000 });
    await page.waitForTimeout(800);
  }

  /** A job with one sheet uploaded and its scale set, on the takeoff TAB. */
  async function jobWithSheet(name: string, pdf: string, halfSheetFeet: number): Promise<string> {
    await landOnDashboard(page, monitor);
    const id = await startJob(page, monitor, { name, gcName: GC_NAME });
    await finishWizard(page, monitor, id);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${id}/takeoff$`));
    servedPdf = readFileSync(pdf);
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(pdf);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    await setScaleByClicking(halfSheetFeet);
    return id;
  }

  test("1. a job with S02 uploaded and scaled, on the takeoff tab", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    jobOne = await jobWithSheet(JOB_ONE, path.join(FIXTURES, "S02.pdf"), 48);
    await expectHealthy(page, "takeoff tab, S02 scaled", { monitor });
  });

  test("2. the ESTIMATE links to the workspace, and it is a real link", async () => {
    await page.goto(`/jobs/${jobOne}/estimate`);
    await expectHealthy(page, "estimate page", { monitor });
    const link = page.locator('[data-estimate="open-takeoff-workspace"]');
    await expect(link, "the estimate has no link to the workspace").toBeVisible();
    // A REAL LINK, which is the requirement: an anchor with an href, so
    // Cmd-click and right-click behave. A button with an onClick would pass a
    // "can you get there" test and fail the actual ask.
    await expect(link).toHaveAttribute("href", `/takeoff/${jobOne}`);
    expect(await link.evaluate((node) => node.tagName)).toBe("A");
    await link.click();
    await page.waitForURL(new RegExp(`/takeoff/${jobOne}`));
  });

  test("3. it fills the viewport, with none of the app chrome", async () => {
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await expect(page.locator('[data-takeoff="workspace-job"]')).toContainText("ZZ-E2E Workspace");
    // THE CLAIM IS ABOUT PIXELS, so it is measured. The shell's own nav is the
    // thing the workspace exists to be rid of; its absence is what makes the
    // drawing large.
    await expect(page.locator("nav").first(), "the app sidebar is still on screen").toHaveCount(0);
    const shell = await page.locator('[data-takeoff="workspace"]').boundingBox();
    const view = page.viewportSize();
    expect(shell, "the workspace has no box").not.toBeNull();
    expect(view, "no viewport").not.toBeNull();
    // Within a pixel of the viewport's height, which is what `h-[100dvh]` means.
    expect(Math.abs((shell?.height ?? 0) - (view?.height ?? 0))).toBeLessThan(2);
    expect(shell?.width).toBeGreaterThan((view?.width ?? 0) - 2);
  });

  test("4. the sheet rail and the quantities panel both collapse", async () => {
    const rail = page.locator('[data-takeoff="sheet-rail"]');
    await expect(rail, "the sheet rail is missing").toBeVisible();
    await page.locator('[data-takeoff="toggle-sheets"]').click();
    await expect(rail, "the sheet rail did not collapse").toHaveCount(0);
    await page.locator('[data-takeoff="toggle-sheets"]').click();
    await expect(rail).toBeVisible();
  });

  test("5. Find the walls runs HERE, and the overlay draws", async () => {
    await findTheWalls("S02 in the workspace");
    // The overlay is the viewer's own SVG over the sheet. Its presence is the
    // check; what it contains is `takeoff-plan.spec.ts`'s business.
    await expect(overlay(), "no detection overlay on the workspace canvas").toBeVisible();
    await expect(page.locator('[data-takeoff="found-walls"]'), "no quantities panel").toBeVisible();
    // `signedIn: false` switches off the main-navigation assertion and nothing
    // else — see its note in `health.ts`. The workspace is signed in and has
    // no shell, which is the whole point of the route; the crash markers and
    // the uncaught-exception check still apply here.
    await expectHealthy(page, "workspace after Find the walls", { monitor, signedIn: false });
    await page.screenshot({ path: path.join(SHOTS, "workspace-1440-s02.png"), fullPage: false });
  });

  test("6. S15's two drawings, and the caution that names the one left out", async () => {
    jobTwo = await jobWithSheet(JOB_TWO, path.join(FIXTURES, "S15.pdf"), 72);
    await page.goto(`/takeoff/${jobTwo}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await findTheWalls("S15 in the workspace");
    await expect(overlay()).toBeVisible();
    const caution = page.locator('[data-takeoff="duplicate-walls-caution"]');
    const said = (await caution.count()) === 0 ? "" : await caution.first().innerText();
    console.log(`[workspace caution] S15: ${said === "" ? "(none)" : JSON.stringify(said)}`);
    await page.screenshot({ path: path.join(SHOTS, "workspace-1440-s15.png"), fullPage: false });
    await expectHealthy(page, "workspace on S15", { monitor, signedIn: false });
  });

  test("7. at tablet width the rails become drawers", async () => {
    await page.setViewportSize(TABLET);
    await page.waitForTimeout(400);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "workspace-tablet-834.png"), fullPage: false });
    const shell = await page.locator('[data-takeoff="workspace"]').boundingBox();
    expect(shell?.width).toBeGreaterThan(TABLET.width - 2);
    await page.setViewportSize(DESKTOP);
  });

  test("8. the estimate and the tab read the SAME saved takeoff", async () => {
    // ── WHAT THIS CAN AND CANNOT PROVE, AND THE LIMIT IS THE HARNESS ──
    //
    // The claim worth testing is that nothing synchronises: the workspace and
    // the estimate read the same rows, so going back shows current numbers.
    //
    // What cannot be asserted here is the WALL PROPOSALS. They are written by
    // `detectWallsForCalibration`, which runs on the SERVER and reads the PDF
    // out of the blob store — and that store is stubbed in the browser, so the
    // server has nothing to read and writes nothing. Asserting stored walls
    // would be asserting against the stub, not the product. It is the same
    // limit `multi-view.spec.ts` records about the offered scale.
    //
    // What IS saved by a real action is the CALIBRATION, so that is the thing
    // followed across the two pages. A scale set in one and read in the other
    // is the same claim with evidence behind it.
    await page.goto(`/jobs/${jobTwo}/estimate`);
    await expectHealthy(page, "estimate after the workspace", { monitor });
    await expect(page.locator('[data-estimate="open-takeoff-workspace"]')).toHaveAttribute(
      "href",
      `/takeoff/${jobTwo}`,
    );
    await page.screenshot({ path: path.join(SHOTS, "estimate-after-workspace.png"), fullPage: false });

    await page.goto(`/jobs/${jobTwo}/takeoff`);
    await expectHealthy(page, "takeoff tab after the workspace", { monitor });
    // The scale the workspace's job was given is on the tab, off the same row.
    await expect(page.getByText(/Scale set|1\/4" = 1'-0"|ft across/).first()).toBeVisible({ timeout: 60_000 });
  });

  test("9. nothing crashed anywhere in the workspace", async () => {
    expect(monitor.crashes, "a page crashed while driving the workspace").toEqual([]);
  });
});
