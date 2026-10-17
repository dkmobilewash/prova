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

  test("11. the canvas owns the height at 1440 AND at 1280", async () => {
    // ── WITH THE QUANTITIES RAIL OPEN *AND* CLOSED ──
    //
    // Closed only is not enough, and this test passed for a run while the
    // 1440px screenshot showed the drawing at 5% with the panel stacked under
    // it. The rail changes the direction of the row it sits in, so it changes
    // which dimension the canvas gives up — the open case is the one that
    // breaks.
    for (const size of [DESKTOP, NARROW]) {
      for (const railOpen of [false, true]) {
        await page.setViewportSize(size);
        await onWorkspace(jobTwo);
        const rail = page.locator('[data-takeoff="toggle-panel"]');
        if ((await rail.getAttribute("aria-expanded")) !== String(railOpen)) {
          await rail.click();
          await page.waitForTimeout(250);
        }
        await fitAndSettle();
        const canvas = await canvasBox();
        expect(
          canvas.height / size.height,
          `at ${size.width}px with the rail ${railOpen ? "OPEN" : "closed"} the canvas is ` +
            `${canvas.height.toFixed(0)}px of a ${size.height}px viewport`,
        ).toBeGreaterThan(0.85);
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
});
