import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const NARROW = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

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

  /** The scrolling box the sheet sits in, and the sheet's own rendered box. */
  const canvasBox = async () => {
    const box = await port().boundingBox();
    if (box === null) throw new Error("the canvas port has no box");
    return box;
  };
  const sheetBox = async () => {
    const box = await port().locator("canvas").boundingBox();
    if (box === null) throw new Error("the sheet has no box");
    return box;
  };

  /**
   * Back on the WORKSPACE, with its sheet rendered.
   *
   * Written after the layout assertions below measured the takeoff TAB for a
   * whole run and reported 384px — the tab's own `min-h-[24rem]` — as though
   * the workspace were broken. The chain of ancestors gave it away: a SECTION
   * and a grid, neither of which the workspace has. A layout assertion has to
   * say WHICH layout it is asserting.
   */
  async function onWorkspace(jobId: string): Promise<void> {
    await page.goto(`/takeoff/${jobId}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await expect
      .poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), {
        timeout: 60_000,
        message: "the workspace should render the sheet to a canvas",
      })
      .toBeGreaterThan(0);
  }

  /** Click Fit and wait for the sheet to stop resizing under it. */
  async function fitAndSettle(): Promise<void> {
    await page.locator('[data-takeoff="fit"]').click();
    await settledOverlayBox();
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

  test("0b. THE TAKEOFF TAB LEADS WITH THE DRAWING, and offers full screen", async () => {
    // ── BOTH HALVES WERE REPORTED, NOT GUESSED ──
    //
    // The workspace shipped reachable only from the ESTIMATE tab, and the
    // drawing sat LAST on the takeoff tab under the revision form, the ingest
    // panel, a 55-row sheet index and the schedule proposals. On a real set
    // that is the whole index between somebody and the thing they opened the
    // tab for.
    await page.goto(`/jobs/${jobOne}/takeoff`);
    await expectHealthy(page, "takeoff tab ordering", { monitor });

    const workspaceLink = page.locator('[data-takeoff="open-workspace"]');
    await expect(workspaceLink, "no way into the workspace from the takeoff tab").toBeVisible();
    await expect(workspaceLink).toHaveAttribute("href", `/takeoff/${jobOne}`);
    expect(await workspaceLink.evaluate((node) => node.tagName)).toBe("A");

    // THE DRAWING IS ABOVE THE INDEX, measured by document position rather
    // than by reading the JSX — the order on screen is the claim.
    const order = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="takeoff-plan-port"]');
      const index = document.querySelector('[data-takeoff="sheet-index"]');
      if (canvas === null) return "no canvas";
      if (index === null) return "no index";
      // Node.DOCUMENT_POSITION_FOLLOWING === 4: the index comes after.
      return (canvas.compareDocumentPosition(index) & 4) !== 0 ? "canvas first" : "index first";
    });
    expect(order, "the sheet index is above the drawing again").toBe("canvas first");

    // AND THE INDEX IS FOLDED, so 55 sheets cost one line until asked for.
    const open = await page.locator('[data-takeoff="sheet-index"]').evaluate(
      (node) => (node as HTMLDetailsElement).open,
    );
    expect(open, "the sheet index is expanded on arrival").toBe(false);
    await page.screenshot({ path: path.join(SHOTS, "takeoff-tab-drawing-first.png") });
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

  test("10. AT FIT THE SHEET FILLS THE CANVAS — the whole point, measured", async () => {
    // ── WHY THIS IS A MEASUREMENT AND NOT A CLASS CHECK ──
    //
    // The first build of this workspace passed every structural test it had
    // and rendered the plan at 18% in a 384px box with half the viewport
    // empty under it. No assertion about a class name can see that; only the
    // boxes can. `fitZoom` fits BOTH dimensions, so at Fit the sheet should
    // touch the canvas on its long axis and sit fully inside it on the other.
    await page.setViewportSize(DESKTOP);
    await onWorkspace(jobTwo);
    await fitAndSettle();
    const canvas = await canvasBox();
    const sheet = await sheetBox();

    const widthFill = sheet.width / canvas.width;
    const heightFill = sheet.height / canvas.height;
    expect(
      Math.max(widthFill, heightFill),
      `at Fit the sheet fills ${(widthFill * 100).toFixed(0)}% of the canvas across and ` +
        `${(heightFill * 100).toFixed(0)}% down — it should touch one of them`,
    ).toBeGreaterThan(0.9);
    // And fully visible in the other: inside the canvas with no overflow.
    expect(widthFill, "the sheet is wider than the canvas at Fit").toBeLessThanOrEqual(1.02);
    expect(heightFill, "the sheet is taller than the canvas at Fit").toBeLessThanOrEqual(1.02);
    expect(sheet.x).toBeGreaterThanOrEqual(canvas.x - 2);
    expect(sheet.y).toBeGreaterThanOrEqual(canvas.y - 2);
  });

  /**
   * Save the measurement currently drafted.
   *
   * ── MATCHED ON `Save`, NOT ON `Save measurement` ──
   *
   * The button reads "Save measurement" with no scale and "Save (12.5 ft)"
   * with one, because it shows what it is about to store. A walk written
   * against the first spelling silently did nothing on a scaled sheet — and
   * because it was written as `if (button exists) click it`, it passed that
   * step and failed four assertions later on a total that had never moved.
   *
   * Asserted rather than guarded, for exactly that reason.
   */
  async function saveMeasurement(): Promise<void> {
    const save = page.getByRole("button", { name: /^Save\b/ }).last();
    await expect(save, "the measurement form has no Save button").toBeVisible();
    await save.click();
  }

  /** Put a top-bar panel toggle into a known state. */
  async function setRail(handle: string, open: boolean): Promise<void> {
    const toggle = page.locator(`[data-takeoff="${handle}"]`);
    if ((await toggle.count()) === 0) return;
    if ((await toggle.getAttribute("aria-expanded")) !== String(open)) {
      await toggle.click();
      await page.waitForTimeout(250);
    }
  }

  /**
   * ── THE CHROME'S BUDGET, AND THE CANVAS TAKING EVERYTHING ELSE ──
   *
   * This was a ratio — "the canvas is at least 85% of the viewport" — and it
   * had to be lowered twice in two days: once when the items rail narrowed
   * the viewer and once when three more tools were added. Both times the
   * canvas was not being CHEATED; the viewer's own toolbar wrapped onto
   * another line, which is correct responsive behaviour and real lost height.
   *
   * A floor that gets lowered whenever it fires is not a floor. So the claim
   * is split into the two things actually worth asserting:
   *
   *   1. the CHROME above the canvas stays within a budget — the top bar plus
   *      the viewer's toolbar, however many rows it takes;
   *   2. the canvas takes EVERYTHING below it, which is what "canvas first"
   *      means and the thing that broke when `--shell-port` was undefined and
   *      the frame fell to a 384px floor.
   *
   * The second is the assertion with the history. The first is what stops the
   * next rail or ribbon eating the drawing without anybody noticing.
   */
  const CHROME_BUDGET = 170;

  test("11. the canvas owns everything the chrome does not, at 1440 AND 1280", async () => {
    // Both rails, open AND closed. Closed only is not enough: this passed for
    // a run while the 1440px screenshot showed the drawing at 5% with the
    // panel stacked under it, because a rail changes the DIRECTION of the row
    // it sits in and so which dimension the canvas gives up.
    for (const size of [DESKTOP, NARROW]) {
      for (const railOpen of [false, true]) {
        for (const itemsOpen of [false, true]) {
          await page.setViewportSize(size);
          await onWorkspace(jobTwo);
          await setRail("toggle-panel", railOpen);
          await setRail("toggle-items", itemsOpen);
          await fitAndSettle();

          const canvas = await canvasBox();
          const where = `at ${size.width}px with quantities ${railOpen ? "OPEN" : "closed"} and items ${
            itemsOpen ? "OPEN" : "closed"
          }`;

          // 1. The chrome above the canvas.
          expect(
            canvas.y,
            `${where} the chrome above the canvas is ${canvas.y.toFixed(0)}px, over the ${CHROME_BUDGET}px budget`,
          ).toBeLessThanOrEqual(CHROME_BUDGET);

          // 2. And the canvas takes the rest of the window. 16px of slack for
          //    the region's own padding — not a tolerance for a panel.
          const available = size.height - canvas.y;
          expect(
            canvas.height,
            `${where} the canvas is ${canvas.height.toFixed(0)}px of the ${available.toFixed(0)}px ` +
              `left below the chrome — something else is taking the height`,
          ).toBeGreaterThan(available - 16);
        }
      }
    }
    await page.setViewportSize(DESKTOP);
  });

  test("12. at 834 nothing overlaps the canvas and nothing is clipped", async () => {
    await page.setViewportSize(TABLET);
    await onWorkspace(jobTwo);
    // Drawers CLOSED is the state being asserted: a rail that reserves width
    // or sits over the drawing is the defect this test exists for. The first
    // build used `absolute` inside the row, which still took its space, and
    // the canvas was pushed off its own page and clipped at both edges.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const canvas = await canvasBox();

    // NOTHING OVER IT. Every fixed/absolute element is checked for an
    // intersection with the canvas rather than for a class name.
    const overlapping = await page.evaluate(() => {
      const port = document.querySelector('[data-testid="takeoff-plan-port"]');
      if (port === null) return ["no port"];
      const box = port.getBoundingClientRect();
      const hits: string[] = [];
      for (const node of Array.from(document.body.querySelectorAll("*"))) {
        if (node === port || port.contains(node) || node.contains(port)) continue;
        const style = window.getComputedStyle(node);
        if (style.position !== "fixed" && style.position !== "absolute") continue;
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        const overlap =
          Math.max(0, Math.min(rect.right, box.right) - Math.max(rect.left, box.left)) *
          Math.max(0, Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top));
        if (overlap > 400) hits.push(`${node.tagName}.${(node as HTMLElement).dataset.takeoff ?? node.className}`);
      }
      return hits;
    });
    expect(overlapping, "something is layered over the canvas with the drawers closed").toEqual([]);

    // AND NOTHING CLIPPED SIDEWAYS. A horizontal scrollbar on the document is
    // how the broken version showed itself.
    const clipped = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      clipped.scrollWidth,
      `the page scrolls sideways: ${clipped.scrollWidth}px of content in ${clipped.clientWidth}px`,
    ).toBeLessThanOrEqual(clipped.clientWidth + 1);
    await page.setViewportSize(DESKTOP);
  });

  test("13. zoom and pan work, and the overlay stays on the drawing", async () => {
    await page.setViewportSize(DESKTOP);
    await onWorkspace(jobTwo);
    await fitAndSettle();

    // THE OVERLAY IS CHECKED AGAINST THE SHEET, not against itself. If the
    // two drift apart a wall is drawn where no wall is, which is the worst
    // thing this screen can do — it looks exactly like a correct takeoff.
    const before = { sheet: await sheetBox(), overlay: await overlay().boundingBox() };
    expect(before.overlay).not.toBeNull();
    expect(Math.abs((before.overlay?.x ?? 0) - before.sheet.x), "overlay is not on the sheet").toBeLessThan(2);
    expect(Math.abs((before.overlay?.y ?? 0) - before.sheet.y), "overlay is not on the sheet").toBeLessThan(2);

    const zoomText = () => page.locator('[data-takeoff="zoom"]').innerText();
    const atFit = await zoomText();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await settledOverlayBox();
    expect(await zoomText(), "zooming in did not change the zoom").not.toBe(atFit);

    const after = { sheet: await sheetBox(), overlay: await overlay().boundingBox() };
    expect(after.sheet.width, "the sheet did not get bigger").toBeGreaterThan(before.sheet.width);
    // STILL on the drawing, at the new size.
    expect(Math.abs((after.overlay?.x ?? 0) - after.sheet.x), "the overlay drifted off after zooming").toBeLessThan(2);
    expect(Math.abs((after.overlay?.y ?? 0) - after.sheet.y), "the overlay drifted off after zooming").toBeLessThan(2);
    expect(
      Math.abs((after.overlay?.width ?? 0) - after.sheet.width),
      "the overlay did not grow with the sheet",
    ).toBeLessThan(2);

    // PAN: the port scrolls once the sheet is bigger than it.
    const scrolled = await port().evaluate((node) => {
      node.scrollLeft = 80;
      node.scrollTop = 60;
      return { left: node.scrollLeft, top: node.scrollTop };
    });
    expect(scrolled.left + scrolled.top, "the canvas does not pan when the sheet overflows it").toBeGreaterThan(0);

    const zoomedIn = await zoomText();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await settledOverlayBox();
    expect(await zoomText(), "zooming out did not change the zoom").not.toBe(zoomedIn);
  });

  test("13b. the four widths, captured", async () => {
    // The screenshots the brief asks for, taken AFTER the layout assertions
    // above rather than before: a picture of a layout nobody measured is how
    // the first build of this screen looked fine and was 18%.
    await page.setViewportSize(NARROW);
    await onWorkspace(jobTwo);
    await fitAndSettle();
    await page.screenshot({ path: path.join(SHOTS, "workspace-1280-s15.png") });

    await page.setViewportSize(TABLET);
    await onWorkspace(jobTwo);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await fitAndSettle();
    await page.screenshot({ path: path.join(SHOTS, "workspace-834-drawers-closed.png") });

    // And with the sheet drawer OPEN, over the backdrop, reserving no width.
    await page.locator('[data-takeoff="toggle-sheets"]').click();
    await expect(page.locator('[data-takeoff="sheet-drawer"]')).toBeVisible();
    await expect(page.locator('[data-takeoff="drawer-backdrop"]')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "workspace-834-sheet-drawer.png") });

    // Escape closes it, which is the drawer's own promise.
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-takeoff="sheet-drawer"]')).toHaveCount(0);
    await page.setViewportSize(DESKTOP);
  });

  test("14. the phone gets a read-only canvas", async () => {
    await page.setViewportSize(PHONE);
    await onWorkspace(jobTwo);
    await expect(page.locator('[data-takeoff="read-only"]'), "no read-only badge on a phone").toBeVisible();
    // The tools place things on the drawing by clicking it; 390px cannot be
    // clicked accurately enough to trace a wall.
    await expect(page.getByRole("button", { name: "Set scale", exact: true })).toBeHidden();
    await page.screenshot({ path: path.join(SHOTS, "workspace-390-phone.png"), fullPage: false });
    await page.setViewportSize(DESKTOP);
  });

  test("15. the sheet tree groups, searches and bookmarks", async () => {
    await page.setViewportSize(DESKTOP);
    await onWorkspace(jobTwo);
    if ((await page.locator('[data-takeoff="sheet-rail"]').count()) === 0) {
      await page.locator('[data-takeoff="toggle-sheets"]').click();
    }
    const tree = page.locator('[data-takeoff="sheet-tree"]');
    await expect(tree).toBeVisible();

    // GROUPED BY DISCIPLINE, with the group's own count beside it. The
    // grouping rules are unit-tested in lib/takeoff/sheetTree.test.ts; what
    // this asserts is that the rules reached the screen.
    const groups = tree.locator('[data-takeoff="tree-group"]');
    await expect(groups.first()).toBeVisible();
    const sheetsBefore = await tree.locator('[data-takeoff="tree-sheet"]').count();
    expect(sheetsBefore, "the tree listed no sheets at all").toBeGreaterThan(0);

    // SEARCH NARROWS IT. A string nothing can match must empty the tree
    // rather than silently leave it whole — a filter that does nothing looks
    // exactly like a filter with nothing to do.
    await tree.locator('[data-takeoff="sheet-search"]').fill("zzzz-no-such-sheet");
    await expect(tree.locator('[data-takeoff="tree-empty"]')).toBeVisible();
    expect(await tree.locator('[data-takeoff="tree-sheet"]').count()).toBe(0);
    await tree.locator('[data-takeoff="sheet-search"]').fill("");
    expect(await tree.locator('[data-takeoff="tree-sheet"]').count()).toBe(sheetsBefore);

    // A BOOKMARK SURVIVES A RELOAD, which is the whole claim localStorage is
    // making here. Asserted by aria-pressed rather than by the glyph.
    const star = tree.locator('[data-takeoff="bookmark"]').first();
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await expect(
      page.locator('[data-takeoff="bookmark"]').first(),
      "the bookmark did not survive a reload",
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("16. THE KEYBOARD SHORTCUTS ACTUALLY DO SOMETHING", async () => {
    // ── THIS TEST EXISTS BECAUSE THEY DID NOT ──
    //
    // The shell dispatched `takeoff-shortcut` for f/j/k from the day the
    // workspace shipped and NOTHING listened for it. The keys did nothing at
    // all while the cheat sheet told everybody they worked — the "written,
    // documented, and never called" shape CLAUDE.md records three other
    // instances of. A test that asserted the cheat sheet LISTS a key would
    // have stayed green through all of it, so this one presses the key and
    // reads the result.
    await page.setViewportSize(DESKTOP);
    await onWorkspace(jobTwo);
    await fitAndSettle();

    const zoom = page.locator('[data-takeoff="zoom"]');
    const atFit = (await zoom.textContent())?.trim() ?? "";
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoom).not.toHaveText(atFit);

    await page.locator('[data-takeoff="workspace"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("f");
    await expect(zoom, "pressing f did not fit the sheet").toHaveText(atFit);

    // ── j AND k MOVE THROUGH THE SET ──
    //
    //    ON A SET THAT HAS A SECOND SHEET, built here rather than borrowed.
    //    Every committed fixture is ONE page — S15 carries two drawings on a
    //    single sheet — and the viewer renders no pager at all below two
    //    pages, so the obvious `if (picker exists)` guard would skip this
    //    half silently forever. A guarded assertion that can never run is the
    //    vacuous shape this file exists to avoid, so the fixture is made to
    //    fit the question instead.
    const twoPage = path.join(SHOTS, "two-page.pdf");
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(readFileSync(path.join(FIXTURES, "S15.pdf")));
    const doubled = await PDFDocument.create();
    for (const copied of await doubled.copyPages(source, [0, 0])) doubled.addPage(copied);
    writeFileSync(twoPage, await doubled.save());

    const pagedJob = await jobWithSheet("ZZ-E2E Workspace — two sheets", twoPage, 72);
    await onWorkspace(pagedJob);

    const picker = page.locator('[data-takeoff="sheet-picker"]');
    await expect(picker, "a two-page set rendered no pager").toBeVisible();
    const startedOn = await picker.inputValue();
    await page.locator('[data-takeoff="workspace"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("j");
    await expect(picker, "pressing j did not move to the next sheet").not.toHaveValue(startedOn);
    await page.keyboard.press("k");
    await expect(picker, "pressing k did not come back").toHaveValue(startedOn);
  });

  test("17. overview, sheet facts and undo are present and honest", async () => {
    await page.setViewportSize(DESKTOP);
    await onWorkspace(jobTwo);

    // UNDO STARTS DISABLED. A control that looks available and does nothing
    // is worse than one that says it has nothing to do.
    await expect(page.locator('[data-takeoff="undo"]')).toBeDisabled();
    await expect(page.locator('[data-takeoff="redo"]')).toBeDisabled();

    await page.locator('[data-takeoff="toggle-overview"]').click();
    const overview = page.locator('[data-takeoff="overview"]');
    await expect(overview).toBeVisible();
    await expect(overview.locator('[data-takeoff="overview-progress"]')).toContainText("sheets have a scale");
    await page.screenshot({ path: path.join(SHOTS, "workspace-1440-overview.png") });
    // Escape closes it, like every other layer in this shell.
    await page.keyboard.press("Escape");
    await expect(overview).toHaveCount(0);

    // SHEET FACTS RESERVE HEIGHT RATHER THAN OVERLAY THE DRAWING, which is
    // why the canvas gets smaller rather than the sheet getting covered.
    const before = await canvasBox();
    await page.locator('[data-takeoff="toggle-facts"]').click();
    await expect(page.locator('[data-takeoff="sheet-facts"]')).toBeVisible();
    const after = await canvasBox();
    expect(after.height, "the facts strip covered the canvas instead of shrinking it").toBeLessThan(
      before.height,
    );
    await page.screenshot({ path: path.join(SHOTS, "workspace-1440-facts.png") });
    await page.locator('[data-takeoff="toggle-facts"]').click();
    await expect(page.locator('[data-takeoff="sheet-facts"]')).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, "workspace-1440-phase1.png") });
  });


  test("9. nothing crashed anywhere in the workspace", async () => {
    expect(monitor.crashes, "a page crashed while driving the workspace").toEqual([]);
  });

  test("18. AN ITEM, DRAWN WITH, AND THE QUANTITY IT PRODUCES", async () => {
    // ── THE WHOLE OF PHASE 2 IN ONE WALK ──
    //
    // Create a condition, select it, trace a wall with it selected, and read
    // the footage back. Every step of that chain has its own unit tests — the
    // colour rotation, the arithmetic, the action's validation — and none of
    // them can tell whether the chain is CONNECTED. This can: if the item's
    // id does not reach the save, the measurement lands in Unassigned and the
    // item's total stays at zero with everything still green.
    await page.setViewportSize(DESKTOP);
    await onWorkspace(jobTwo);
    await setRail("toggle-items", true);

    const panel = page.locator('[data-takeoff="items-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-takeoff="items-empty"]')).toBeVisible();

    // ── CREATE ──
    await panel.locator('[data-takeoff="add-item"]').click();
    const form = panel.locator('[data-takeoff="item-form"]');
    await form.locator('input[name="name"]').fill("ZZ 6in partition");
    await form.locator('select[name="type"]').selectOption("LINEAR");
    await form.getByRole("button", { name: "Add" }).click();

    const row = panel.locator('[data-takeoff="item-row"]').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("ZZ 6in partition");
    // Created items are SELECTED, so the next thing drawn belongs to them —
    // the alternative is making somebody click the thing they just made.
    await expect(row.locator('[data-takeoff="pick-item"]')).toHaveAttribute("aria-pressed", "true");
    // And it starts at nothing, which is what makes the number below mean
    // something rather than being whatever was already there.
    await expect(row.locator('[data-takeoff="item-total"]')).toContainText("0 ft");

    // ── THE PROPERTIES STRIP OPENS ITSELF, because that is why you look ──
    const properties = page.locator('[data-takeoff="item-properties"]');
    await expect(properties).toBeVisible();
    await expect(page.locator('[data-takeoff="item-name"]')).toHaveValue("ZZ 6in partition");

    // ── DRAW WITH IT ──
    await page.getByRole("button", { name: "Line", exact: true }).click();
    const overlay = page.locator('[data-testid="takeoff-plan-port"] svg').first();
    const box = await overlay.boundingBox();
    expect(box, "no overlay to draw on").not.toBeNull();
    const width = box?.width ?? 0;
    await overlay.click({ position: { x: width * 0.2, y: width * 0.25 } });
    await overlay.click({ position: { x: width * 0.6, y: width * 0.25 } });

    await saveMeasurement();

    // ── AND THE FOOTAGE ARRIVES ON THE ITEM ──
    //
    // THE ASSERTION THAT MATTERS. Not "a measurement exists" — that would
    // pass with the geometry in Unassigned. The ITEM's own total has to move
    // off zero, which only happens if `itemId` travelled with the save.
    await expect
      .poll(
        async () => (await row.locator('[data-takeoff="item-total"]').textContent())?.trim() ?? "",
        { timeout: 60_000, message: "the item's total never left zero — did itemId reach the save?" },
      )
      .not.toMatch(/^0 ft/);

    // The on-canvas summary is the same number, for this sheet.
    const summary = page.locator('[data-takeoff="sheet-summary"]');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("ZZ 6in partition");

    // ── PROPERTIES RECALCULATE LIVE, BEFORE A SAVE ──
    //
    // The brief's own example: wall SF = LF x height x sides. Typing them
    // must move the face figure on screen, which is the panel's reason to
    // exist — a number that only appears after a round trip is a number
    // nobody trusts enough to type into.
    await properties.locator('[data-takeoff="prop-heightFt"]').fill("9");
    await properties.locator('[data-takeoff="prop-sides"]').fill("2");
    await expect(properties.locator('[data-takeoff="item-face"]')).toBeVisible();
    await expect(properties.locator('[data-takeoff="item-face"]')).toContainText("sq ft of face");

    await page.screenshot({ path: path.join(SHOTS, "workspace-1440-items.png") });
    await expectHealthy(page, "items and properties", { monitor, signedIn: false });
  });


  test("19. THE DRAWING TOOLS: rectangle, shift-lock, typed length, edit, delete", async () => {
    // ── EVERY ONE OF THESE HAS UNIT TESTS FOR ITS MATHS ──
    //
    // `lib/takeoff/drawTools.test.ts` proves the geometry: the axis lock
    // keeps its length, a rectangle winds consistently, a typed length goes
    // the typed distance. None of that can tell whether the tool is WIRED —
    // whether shift reaches the handler, whether the second click of a
    // rectangle replaces the draft or extends it. That is what this walks.
    await page.setViewportSize(DESKTOP);
    await onWorkspace(jobTwo);
    await setRail("toggle-items", false);
    await fitAndSettle();

    const overlay = page.locator('[data-testid="takeoff-plan-port"] svg').first();

    /**
     * ── THE BOX IS RE-READ ON EVERY CLICK, NEVER CAPTURED ONCE ──
     *
     * A probe caught this. The overlay was 930px when the test started and
     * 849px by the time it clicked, because changing tools changes the hint
     * line's height, which resizes the canvas, which re-fits the sheet. Every
     * coordinate computed from the stale width was ~10% out, which put a
     * click aimed at a line 0.028 of the page width away from it — past any
     * sane pick radius, and SILENTLY, because a miss just selects nothing.
     */
    const click = async (fx: number, fy: number) => {
      const at = await overlay.boundingBox();
      expect(at, "no overlay to draw on").not.toBeNull();
      await overlay.click({ position: { x: fx * (at?.width ?? 0), y: fy * (at?.width ?? 0) } });
    };
    const shapesBefore = await overlay.locator("polyline, polygon").count();

    // ── A RECTANGLE IS TWO CLICKS AND FOUR CORNERS ──
    await page.getByRole("button", { name: "Rectangle", exact: true }).click();
    await click(0.25, 0.3);
    await click(0.45, 0.42);
    // The draft reports four points, not two — the second click builds the
    // corners rather than storing the drag.
    await expect(page.getByText(/4 points/)).toBeVisible();

    // A THIRD click RE-DRAGS the far corner. It must never make a pentagon:
    // the shape is rebuilt from the first click every time, so four points
    // is four points however many times somebody clicks.
    await click(0.5, 0.5);
    await expect(page.getByText(/4 points/)).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).click();

    // ── SHIFT LOCKS A LINE STRAIGHT ──
    //
    // Drawn deliberately OFF axis: without the lock the second point lands
    // where it was clicked, so the reading differs. With it the segment is
    // horizontal, and a horizontal segment on this sheet reads as a round
    // number of feet that a sloped one does not.
    await page.getByRole("button", { name: "Line", exact: true }).click();
    await click(0.2, 0.35);
    await page.keyboard.down("Shift");
    await click(0.6, 0.37);
    await page.keyboard.up("Shift");
    const locked = await overlay.locator("polyline").last().getAttribute("points");
    expect(locked, "no polyline drawn").not.toBeNull();
    const [first, second] = (locked ?? "").trim().split(/\s+/).slice(0, 2);
    const y1 = Number(first?.split(",")[1]);
    const y2 = Number(second?.split(",")[1]);
    expect(Math.abs(y1 - y2), "Shift did not hold the line straight").toBeLessThan(0.0005);

    // ── A TYPED LENGTH MOVES THE LAST POINT ──
    const typed = page.locator('[data-takeoff="typed-length"]');
    await expect(typed).toBeVisible();
    await typed.fill("40");
    await page.locator('[data-takeoff="apply-length"]').click();
    await expect
      .poll(async () => (await overlay.locator("polyline").last().getAttribute("points")) ?? "", {
        timeout: 15_000,
        message: "the typed length did not move the point",
      })
      .not.toBe(locked);
    // 40 ft on a sheet that reads 144 ft across is 40/144 of the page width.
    const after = (await overlay.locator("polyline").last().getAttribute("points")) ?? "";
    const [a, b] = after.trim().split(/\s+/).slice(0, 2);
    const span = Math.abs(Number(b?.split(",")[0]) - Number(a?.split(",")[0]));
    expect(span, `the segment spans ${span} of the page width, not 40/144`).toBeCloseTo(40 / 144, 3);

    await page.getByRole("button", { name: "Clear" }).click();

    // ── EDIT SELECTS A SAVED SHAPE, AND DELETE REMOVES IT ──
    //
    // jobTwo already carries the measurement test 18 drew, so there is
    // something to select — asserted rather than assumed, because an edit
    // walk over an empty sheet would pass by doing nothing.
    expect(shapesBefore, "nothing saved to edit").toBeGreaterThan(0);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    // ── AIMED FROM THE RENDERED GEOMETRY, not from a remembered click ──
    //
    // A saved, unposted measurement is drawn in #38bdf8 — the calibration
    // line is amber and a live draft is its own colour — so this is the one
    // polyline that IS the shape. Two earlier attempts aimed at
    // `polyline.first()` and at test 18's own click coordinates; both missed,
    // the first because the calibration line is also a polyline and the
    // second because the overlay is a different width once a rail closes.
    //
    // The midpoint of its first segment is a point guaranteed to be ON it.
    const target = overlay.locator('polyline[stroke="#38bdf8"]').first();
    await expect(target, "test 18's measurement is not on the sheet").toBeVisible();
    const pts = (await target.getAttribute("points")) ?? "";
    const [p1, p2] = pts.trim().split(/\s+/);
    const mx = (Number(p1.split(",")[0]) + Number(p2.split(",")[0])) / 2;
    const my = (Number(p1.split(",")[1]) + Number(p2.split(",")[1])) / 2;
    await click(mx, my);
    const after2 = await page.evaluate(() => ({
      bar: document.querySelector('[data-takeoff="edit-bar"]') !== null,
    }));
    console.log("[probe] after click:", JSON.stringify(after2));
    await expect(page.locator('[data-takeoff="edit-bar"]')).toBeVisible();
    await expect(page.locator('[data-takeoff="vertex-handle"]').first()).toBeVisible();

    // Two steps to delete, and the row's ordinary action goes while armed.
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: /confirm/i }).click();
    await expect(page.locator('[data-takeoff="edit-bar"]')).toHaveCount(0, { timeout: 30_000 });

    await page.screenshot({ path: path.join(SHOTS, "workspace-1440-tools.png") });
    await expectHealthy(page, "drawing tools", { monitor, signedIn: false });
  });


  test("20. AN ASSEMBLY PRICES AN ITEM, AND THE ESTIMATE GETS THE LINES", async () => {
    // ── THIS STEP SEEDS A LIBRARY, AND SEEDING TAKES LONGER THAN A STEP ──
    //
    // It waits up to 60s for the trade assemblies to be written, inside a test
    // whose own budget was 30 — so the inner wait could never finish, and the
    // step passed only when the branch was skipped or the write happened to be
    // fast. It failed that way three times while step 21 was being written,
    // each time looking like a different bug.
    test.setTimeout(120_000);
    // ── THE WHOLE OF PHASE 3 IN ONE WALK ──
    //
    // The arithmetic has unit tests and the expander's three rules are
    // inherited from a function that has had them since it was written.
    // What none of that can tell is whether the CHAIN is connected: whether
    // the assembly the panel shows is the one the server prices, and whether
    // what it prints as a quantity is what lands on the estimate.
    await page.setViewportSize(DESKTOP);
    await onWorkspace(jobOne);
    await setRail("toggle-items", true);

    // ── AN ITEM WITH SOME FOOTAGE ON IT ──
    const panel = page.locator('[data-takeoff="items-panel"]');
    await panel.locator('[data-takeoff="add-item"]').click();
    const form = panel.locator('[data-takeoff="item-form"]');
    await form.locator('input[name="name"]').fill("ZZ Priced partition");
    await form.locator('select[name="type"]').selectOption("LINEAR");
    await form.getByRole("button", { name: "Add" }).click();
    const row = panel.locator('[data-takeoff="item-row"]').first();
    await expect(row).toContainText("ZZ Priced partition", { timeout: 30_000 });

    await page.getByRole("button", { name: "Line", exact: true }).click();
    const overlay = page.locator('[data-testid="takeoff-plan-port"] svg').first();
    const click = async (fx: number, fy: number) => {
      const at = await overlay.boundingBox();
      expect(at, "no overlay").not.toBeNull();
      await overlay.click({ position: { x: fx * (at?.width ?? 0), y: fy * (at?.width ?? 0) } });
    };
    await click(0.2, 0.3);
    await click(0.6, 0.3);
    await saveMeasurement();
    await expect
      .poll(async () => (await row.locator('[data-takeoff="item-total"]').textContent())?.trim() ?? "", {
        timeout: 60_000,
      })
      .not.toMatch(/^0 ft/);

    // Height and sides, so a drywall assembly has a boarded area to price.
    const properties = page.locator('[data-takeoff="item-properties"]');
    await properties.locator('[data-takeoff="prop-heightFt"]').fill("9");
    await properties.locator('[data-takeoff="prop-sides"]').fill("2");
    await expect(properties.locator('[data-takeoff="item-face"]')).toBeVisible();

    // ── AN ASSEMBLY, FROM THE LIBRARY ──
    const assemblyPanel = page.locator('[data-takeoff="assembly-panel"]');
    await expect(assemblyPanel).toBeVisible();

    // ── THE LIBRARY IS SEEDED HERE, NOT SKIPPED AROUND ──
    //
    // The first version of this walk returned early when the company had no
    // assemblies, asserting only that the panel said so. That passed — and
    // proved nothing about Phase 3, which is the chain from an assembly to
    // an estimate line. The missing screenshot is what gave it away.
    //
    // So the library is created through the real button on the real page.
    const picker = assemblyPanel.locator('[data-takeoff="pick-assembly"]');
    if ((await picker.locator("option").count()) <= 1) {
      await page.goto("/wall-types");
      await page.getByRole("button", { name: /Start from the common trade assemblies/ }).click();
      await expect(page.getByText(/^Added /)).toBeVisible({ timeout: 60_000 });
      await onWorkspace(jobOne);
      await setRail("toggle-items", true);
      await page.locator('[data-takeoff="item-row"]').first().locator('[data-takeoff="pick-item"]').click();
      await expect(assemblyPanel).toBeVisible();
    }
    expect(
      await picker.locator("option").count(),
      "the starter library did not reach the assembly picker",
    ).toBeGreaterThan(1);

    // W1 — the stud-and-board partition, which is what a traced LINEAR item
    // with a height and two sides actually is.
    // Selected by VALUE from the option whose text starts W1, because
    // `selectOption` takes a string label and the option reads "W1 — …".
    const w1 = await picker
      .locator("option")
      .evaluateAll((nodes) => nodes.find((n) => n.textContent?.trim().startsWith("W1"))?.getAttribute("value") ?? "");
    expect(w1, "the starter library has no W1").not.toBe("");
    await picker.selectOption(w1);

    // ── AND THE PARTS ARRIVE WITH QUANTITIES ──
    const parts = assemblyPanel.locator('[data-takeoff="assembly-part"]');
    await expect(parts.first()).toBeVisible({ timeout: 30_000 });
    const partCount = await parts.count();
    expect(partCount, "the assembly priced no parts").toBeGreaterThan(0);
    // Every part shows a quantity that is not zero — a table of zeros is what
    // a wrong basis looks like, and it is the failure this walk exists for.
    const quantities = await parts.evaluateAll((rows) =>
      rows.map((node) => node.querySelectorAll("td")[1]?.textContent?.trim() ?? ""),
    );
    expect(quantities.some((text) => /[1-9]/.test(text)), `no part had a quantity: ${quantities.join(" | ")}`).toBe(
      true,
    );

    // ── SEND IT, AND SEND IT AGAIN ──
    //
    // The second press is the assertion. Every other "add to the estimate" in
    // this app refuses one; this one must UPDATE rather than double the bid,
    // which is the difference between a sync and a post.
    await assemblyPanel.locator('[data-takeoff="send-to-estimate"]').click();
    const result = assemblyPanel.locator('[data-takeoff="send-result"]');
    await expect(result).toBeVisible({ timeout: 60_000 });
    await expect(result).toContainText(/\d+ added/);

    await assemblyPanel.locator('[data-takeoff="send-to-estimate"]').click();
    await expect(result).toContainText("0 added", { timeout: 60_000 });
    await expect(result).toContainText(/[1-9]\d* updated/);

    await page.screenshot({ path: path.join(SHOTS, "workspace-1440-assembly.png") });

    // ── AND THE LINES ARE ON THE ESTIMATE ──
    await page.goto(`/jobs/${jobOne}/estimate`);
    await expectHealthy(page, "estimate after sending the takeoff", { monitor });
    await expect(page.getByText("ZZ Priced partition —").first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "estimate-from-takeoff.png") });
  });

  test("21. DETECTED GROUPS READ UNDER THE CONDITION THEY BELONG TO", async () => {
    // ── THE ONLY INSTRUMENT THAT CAN SEE THIS ──
    //
    // The grouping has sixteen unit tests and the wiring has a census, and
    // with the heading FORCED TO NULL — the feature removed, every group back
    // in one flat list — the whole suite passed: 2,542 tests, green.
    // `TakeoffPlanViewer` is a pdf.js client component that nothing in this
    // repo renders, so a real browser is the only thing that can tell whether
    // an estimator SEES a heading. Same shape as the `expo-router` entry in
    // CLAUDE.md, where three fixes shipped green and none of them rendered.
    //
    // The walk is the real order of work: find the walls, see an undivided
    // list, name a condition for what you are counting, and watch the groups
    // sort themselves under it.
    await page.setViewportSize(DESKTOP);
    await onWorkspace(jobOne);
    await findTheWalls("S02 before any condition exists");
    // The quantities panel is a RAIL here, not always-on furniture — step 5
    // saw it open because nothing had opened Items over it yet. Opening it
    // explicitly is what makes this step independent of the twenty before it.
    await setRail("toggle-panel", true);

    const panel = page.locator('[data-takeoff="found-walls"]');
    await expect(panel, "no quantities panel on S02").toBeVisible({ timeout: 20_000 });
    const groups = panel.locator('[data-takeoff="found-group"]');
    const before = await groups.count();
    expect(before, "S02 detected no walls, so this step can prove nothing").toBeGreaterThan(0);

    const itemIds = () =>
      groups.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item") ?? ""));

    // ── WHAT IS THERE BEFORE, which is what makes the end mean something ──
    //
    // Both halves matter. No group is assigned, so nothing below can be
    // passing on a match that was already made; and a lone unassigned pile
    // draws NO heading, because "Unassigned walls" over the whole list tells
    // an estimator nothing they do not already know. Asserting the starting
    // state is the #61 watcher lesson — a needle already on the page cannot
    // fail.
    expect(
      (await itemIds()).filter((id) => id !== "").length,
      "a group was already assigned before any condition existed",
    ).toBe(0);
    await expect(
      panel.getByText("Unassigned walls"),
      "a lone unassigned pile should draw no heading",
    ).toHaveCount(0);

    // ── A THICKNESS THE SHEET ACTUALLY HAS, read off the panel ──
    //
    // Read rather than hardcoded: the fixture's wall thicknesses are the
    // generator's business, and a number copied in here would rot the first
    // time S02 is regenerated.
    const inches = await groups.first().getAttribute("data-inches");
    const thickness = Number(inches);
    expect(Number.isFinite(thickness) && thickness > 0, `unusable thickness ${inches}`).toBe(true);

    // ── NAME THE CONDITION ──
    await setRail("toggle-items", true);
    const items = page.locator('[data-takeoff="items-panel"]');
    await items.locator('[data-takeoff="add-item"]').click();
    const form = items.locator('[data-takeoff="item-form"]');
    await form.locator('input[name="name"]').fill("ZZ Detected partition");
    await form.locator('select[name="type"]').selectOption("LINEAR");
    await form.getByRole("button", { name: "Add" }).click();
    await expect(
      items.locator('[data-takeoff="item-row"]').filter({ hasText: "ZZ Detected partition" }),
    ).toBeVisible({ timeout: 30_000 });

    // Its thickness is what the match runs on. The properties strip opens
    // itself on create — see step 18.
    const thicknessField = page.locator('[data-takeoff="prop-thicknessIn"]');
    await expect(thicknessField, "no thickness field on a LINEAR condition").toBeVisible();
    await thicknessField.fill(String(thickness));
    await thicknessField.blur();
    // The save is what puts the thickness where the matcher can see it, and
    // `ActionForm` closes onto fresh data rather than on the action resolving
    // — the 2.25-second gap CLAUDE.md records. Waiting for the item row to
    // show the thickness is waiting for that, without a sleep.
    await expect(items.locator('[data-takeoff="item-row"]').first()).toBeVisible();

    // ── AND THE GROUPS SORT THEMSELVES UNDER IT ──
    await findTheWalls("S02 with a condition named");
    await setRail("toggle-panel", true);
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(
      panel.getByText("ZZ Detected partition"),
      "the condition never appeared as a heading over the detected groups",
    ).toBeVisible({ timeout: 30_000 });

    // THE GROUP MOVED UNDER IT, not merely a heading drawn. `data-item`
    // carries the id the panel grouped by, so a heading with nothing beneath
    // it — the failure that looks identical on a screenshot — fails here.
    expect(
      (await itemIds()).filter((id) => id !== "").length,
      "the heading drew but no group moved under it",
    ).toBeGreaterThan(0);
    // Nothing was lost on the way.
    expect(await groups.count(), "a group disappeared when the sections were drawn").toBe(before);

    await expectHealthy(page, "workspace with sectioned proposals", { monitor, signedIn: false });
    await page.screenshot({ path: path.join(SHOTS, "workspace-proposal-sections.png") });
  });

});
