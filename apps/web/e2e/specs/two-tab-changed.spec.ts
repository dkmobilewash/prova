import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, settleAction, startJob } from "../lib/journey";

/**
 * ── A SAVE IN ANOTHER TAB SAYS SO; THIS TAB'S OWN SAVE DOES NOT (#1222) ──
 *
 * #1222 took the wall proposals out of the takeoff's saved signature, so a tab's own scale save
 * stopped tripping its own "changed in another tab" banner. Chrome then could not see the other
 * half in a real browser: tab 2 set a scale, tab 1 stayed focused, no banner. Not counted as
 * verified until this exists (Diego, 2026-11-19).
 *
 * Two browser CONTEXTS, one person signed into each, on the same workspace: B is the other tab.
 * A "comes back" through its window `focus` event (see `aComesBack` for why it is not a browser-made
 * visibilitychange). What this proves is the rest of the chain: a save in B changes the saved
 * signature, A's listener fetches it, compares, and shows the banner; and A's own save does not.
 */
test.describe.configure({ mode: "serial" });

const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const BANNER = '[data-takeoff="changed-elsewhere"]';

test.describe("two tabs on one takeoff", () => {
  let a: Page;
  let b: Page;
  let contexts: BrowserContext[] = [];
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    const pdf = readFileSync(S02);
    for (let i = 0; i < 2; i += 1) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
      contexts.push(context);
    }
    a = await contexts[0]!.newPage();
    b = await contexts[1]!.newPage();
    monitor = new HealthMonitor(a);
  });
  test.afterAll(async () => {
    for (const context of contexts) await context.close();
    contexts = [];
  });

  const port = (page: Page) => page.locator('[data-testid="takeoff-plan-port"]');
  const tool = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });

  async function settledBox(page: Page): Promise<{ width: number }> {
    let previous = -1;
    let steady = 0;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const box = await port(page).locator("svg").boundingBox();
      if (box && box.width > 0 && Math.abs(box.width - previous) < 0.5) {
        steady += 1;
        if (steady >= 3) return { width: box.width };
      } else steady = 0;
      previous = box?.width ?? -1;
      await page.waitForTimeout(100);
    }
    throw new Error("the sheet never stopped resizing");
  }

  async function drawn(page: Page): Promise<void> {
    await expect.poll(async () => port(page).locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 60_000 }).toBeGreaterThan(0);
  }

  async function setScale(page: Page, feet: number): Promise<void> {
    await drawn(page);
    await tool(page, "Set scale").click();
    const box = await settledBox(page);
    await port(page).locator("svg").click({ position: { x: box.width * 0.2, y: box.width * 0.5 } });
    await port(page).locator("svg").click({ position: { x: box.width * 0.7, y: box.width * 0.5 } });
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await form.locator('input[name="declaredDistanceFeet"]').fill(String(feet));
    const label = form.locator('input[name="pageLabel"]');
    if (await label.count()) await label.fill("sheet 1");
    await form.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 30_000 });
  }

  async function openWorkspace(page: Page): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      await page.goto(`/takeoff/${jobId}`);
      const shown = await page.locator('[data-takeoff="workspace"]').waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
      if (shown) break;
      if (attempt >= 2) throw new Error(`the workspace did not open (the browser is on ${new URL(page.url()).pathname})`);
    }
    await drawn(page);
  }

  /**
   * A leaves its tab and comes back. Headed, that is a real tab switch in A's own window: A goes
   * hidden, then visible, and the browser fires visibilitychange. HEADLESS CHROMIUM DOES NOT MODEL
   * TAB VISIBILITY (measured: bringing another tab to the front left A "visible" for 10 s), so there
   * the browser's own window `focus` event is fired on A instead — the same listener, the same
   * fetch, the same comparison. Which one ran is recorded on the test.
   */
  /**
   * A comes back to its window: the browser's own window `focus` event on A, which is what the
   * check listens to beside visibilitychange. Fired by hand because a browser-made one cannot be had
   * here, measured three ways on 2026-11-19: Playwright opens pages as WINDOWS, not tabs, so bringing
   * another page forward hides nothing; headless Chromium does not model visibility; and headed,
   * minimizing A's window through the DevTools protocol still left it "visible" for 3 s.
   */
  async function aComesBack(): Promise<void> {
    await a.bringToFront();
    await a.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
  }

  test("1. one job, S02 uploaded and scaled; both tabs open its workspace", async () => {
    test.setTimeout(240_000);
    await signInAs(a, PERSONAS.twoTab.email);
    await landOnDashboard(a, monitor);
    jobId = await startJob(a, monitor, { name: "ZZ-E2E Two tabs", gcName: "ZZ-E2E Two tabs GC" });
    await finishWizard(a, monitor, jobId);
    await openJobTab(a, "Takeoff");
    await a.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await stubDocumentUpload(a);
    await a.locator('input[type="file"]').setInputFiles(S02);
    await expect(a.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    await setScale(a, 48);
    await signInAs(b, PERSONAS.twoTab.email);
    await openWorkspace(a);
    await openWorkspace(b);
    await expect(a.locator(BANNER)).toBeHidden();
  });

  test("2. THIS TAB'S OWN SCALE SAVE: coming back to it shows no banner", async () => {
    test.setTimeout(120_000);
    const before = await prisma.takeoffScaleCalibration.count({ where: { page: { plan: { jobId } } } });
    await setScale(a, 50);
    expect(await prisma.takeoffScaleCalibration.count({ where: { page: { plan: { jobId } } } })).toBe(before + 1);
    // Let the finder that a scale save queues write its proposals, the case #1222 was about.
    await a.waitForTimeout(6_000);
    await aComesBack();
    await a.waitForTimeout(3_000);
    await expect(a.locator(BANNER), "a tab's own save tripped its own 'changed in another tab'").toBeHidden();
  });

  test("3. THE OTHER TAB SETS A SCALE: coming back to this one says it changed", async () => {
    test.setTimeout(120_000);
    await b.bringToFront();
    await setScale(b, 52);
    await aComesBack();
    await expect(a.locator(BANNER), "a scale set in the other tab did not reach this one").toBeVisible({ timeout: 10_000 });
  });

  test("4. THE OTHER TAB SAVES A MEASUREMENT: coming back says it changed", async () => {
    test.setTimeout(120_000);
    await openWorkspace(a);
    await expect(a.locator(BANNER)).toBeHidden();
    await b.bringToFront();
    await openWorkspace(b);
    const before = await prisma.takeoffMeasurement.count({ where: { page: { plan: { jobId } } } });
    await tool(b, "Line").click();
    const box = await settledBox(b);
    await port(b).locator("svg").click({ position: { x: box.width * 0.2, y: box.width * 0.6 } });
    await port(b).locator("svg").click({ position: { x: box.width * 0.6, y: box.width * 0.6 } });
    const save = b.locator("form").filter({ has: b.getByRole("button", { name: /^Save \(/ }) });
    await save.locator('input[name="label"]').fill("ZZ-E2E other tab's line");
    await settleAction(b, () => save.getByRole("button", { name: /^Save \(/ }).click(), { formSubmission: true });
    await expect.poll(() => prisma.takeoffMeasurement.count({ where: { page: { plan: { jobId } } } })).toBe(before + 1);
    await aComesBack();
    await expect(a.locator(BANNER), "a measurement saved in the other tab did not reach this one").toBeVisible({ timeout: 10_000 });
  });
});
