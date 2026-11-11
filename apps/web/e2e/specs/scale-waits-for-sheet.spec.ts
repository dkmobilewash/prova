import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── "THE CANVAS HAS A WIDTH" MEANS THE SHEET IS DRAWN ──
 *
 * Nineteen specs wait for `canvas.width > 0` before clicking the sheet. A canvas is 300 × 150
 * by default, so that was true before the PDF had loaded: on a busy gate machine the two
 * clicks of Set scale landed on an empty box, ~250 ms before the PDF arrived, and the scale
 * form never opened (takeoff-estimate-chain, takeoff-workspace, plan-ingest, multi-view;
 * Playwright trace, 2026-11-11). The plan canvas now starts 0 × 0 until the sheet is drawn.
 *
 * Here the PDF is held back 4 s — the slow machine, on purpose — and the same wait-then-click
 * those specs use sets the scale: the canvas reads 0 until the sheet is on screen, and the
 * two clicks open the form.
 *
 * The shoot persona: its one spec never sets a scale on a sheet of its own.
 */
test.describe.configure({ mode: "serial" });

const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const HOLD_MS = 4_000;

test.describe("the sheet's canvas has no size until the sheet is drawn", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    const pdf = readFileSync(S02);
    // The slow machine, on purpose: the sheet's PDF arrives 4 s after it is asked for.
    await context.route("**/api/takeoff/plan/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      await route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
    });
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  const port = () => page.locator('[data-testid="takeoff-plan-port"]');
  const overlay = () => port().locator("svg");
  const canvasWidth = () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width);

  test("1. a job with S02 uploaded, its PDF slow to arrive", async () => {
    test.setTimeout(120_000);
    await signInAs(page, PERSONAS.shoot.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Scale waits — slow sheet", gcName: "ZZ-E2E Scale waits GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(S02);
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
  });

  test("2. the canvas reads 0 while the PDF is held back, and the wait-then-click those specs use sets the scale", async () => {
    test.setTimeout(120_000);
    await page.reload();
    await expect(port()).toBeVisible({ timeout: 60_000 });
    // Before the PDF arrives: nothing to click, and the canvas says so.
    expect(await canvasWidth(), "the canvas has a size before the sheet is drawn").toBe(0);
    // The helper the other specs use, unchanged.
    await expect.poll(canvasWidth, { timeout: 60_000 }).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Set scale", exact: true }).click();
    let box = await overlay().boundingBox();
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(100);
      const next = await overlay().boundingBox();
      if (next && box && Math.abs(next.width - box.width) < 0.5) break;
      box = next;
    }
    await overlay().click({ position: { x: box!.width * 0.2, y: box!.width * 0.5 } });
    await overlay().click({ position: { x: box!.width * 0.7, y: box!.width * 0.5 } });
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await form.locator('input[name="declaredDistanceFeet"]').fill("48", { timeout: 15_000 });
    await form.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 30_000 });
    expect(await prisma.takeoffScaleCalibration.count({ where: { page: { plan: { jobId } } } })).toBe(1);
  });
});
