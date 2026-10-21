import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page, type Response } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── "DEMOTE, DON'T HIDE" ON A REAL TRAINING SHEET, FOR SCREENSHOTS ──
 *
 * SKIPS unless `REAL_SET_PDF` names a plan set outside the repository and
 * `REAL_SET_PAGE` its floor-plan page; one page is pulled out with pdf-lib
 * into `REAL_SHEET_OUT` (also outside) and served in place of the upload.
 * Same harness as `takeoff-rooms-real.spec.ts`.
 *
 * THE VERDICT IS INVENTED. The e2e runner strips the model key, so the real
 * check refuses; its response is captured once and replayed with the first
 * `REAL_DEMOTE_N` runs in view (default 3) marked casework/reference. The
 * screenshots show what the panel and the drawing look like with runs
 * demoted — not which runs a model would actually demote on this sheet.
 * Every file written says so in its name.
 */
const SET = process.env.REAL_SET_PDF ?? "";
const PAGE = Number(process.env.REAL_SET_PAGE ?? "0");
const OUT = process.env.REAL_SHEET_OUT ?? "";
const HALF_FEET = Number(process.env.REAL_HALF_FEET ?? "144");
const DEMOTE_N = Number(process.env.REAL_DEMOTE_N ?? "3");

const isActionPost = (r: Response) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined;

test.describe.configure({ mode: "serial" });

test.describe("demote, don't hide, on a real sheet", () => {
  test.skip(SET === "" || PAGE === 0 || OUT === "" || !existsSync(SET), "no real set named in REAL_SET_PDF");
  test.setTimeout(600_000);
  let page: Page;
  let monitor: HealthMonitor;
  let served: Buffer = Buffer.alloc(0);

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(readFileSync(SET));
    const one = await PDFDocument.create();
    const [copied] = await one.copyPages(source, [PAGE - 1]);
    one.addPage(copied);
    const extract = path.join(OUT, `sheet-p${PAGE}.pdf`);
    writeFileSync(extract, await one.save());
    served = readFileSync(extract);
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: served });
    });
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  const port = () => page.locator('[data-testid="takeoff-plan-port"]');
  const overlay = () => port().locator("svg");
  const foundCount = async () => {
    const text = (await page.locator('[data-takeoff="found-walls"]').textContent()) ?? "";
    const m = /Found (\d+) runs? of wall/.exec(text);
    expect(m, `no "Found N runs of wall" sentence in: ${text.slice(0, 120)}`).not.toBeNull();
    return Number(m![1]);
  };
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

  test("walls, a replayed verdict, one run taken back", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    const jobId = await startJob(page, monitor, { name: `ZZ-E2E Demoted real p${PAGE}`, gcName: "ZZ-E2E Demoted real GC" });
    await finishWizard(page, monitor, jobId);
    await page.goto("/settings?tab=estimating");
    const form = page.locator('[data-settings="demoted-walls"]');
    await expect
      .poll(() => form.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))), { timeout: 30_000 })
      .toBe(true);
    await form.locator('input[name="demotedWallsOn"]').check();
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText("Saved.")).toBeVisible({ timeout: 30_000 });
    await page.goto(`/jobs/${jobId}`);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(path.join(OUT, `sheet-p${PAGE}.pdf`));
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 120_000 });
    await setScaleByClicking(HALF_FEET);
    await page.goto(`/takeoff/${jobId}`);
    await expect
      .poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 300_000 })
      .toBeGreaterThan(0);
    await settledOverlayBox();
    const findWalls = page.locator('[data-takeoff="find-walls"]');
    await expect(findWalls).toBeVisible({ timeout: 120_000 });
    await expect(findWalls, "the sheet never got a scale, so nothing can be found").toBeEnabled({ timeout: 120_000 });
    await findWalls.click();
    await expect(findWalls).toHaveText("Find the walls", { timeout: 540_000 });
    const before = await foundCount();
    await page.screenshot({ path: path.join(OUT, `p${PAGE}-01-walls-found.png`) });

    // The real check, refused (no key in e2e): captured for the replay.
    const check = page.locator('[data-takeoff="check-runs"]');
    const [response] = await Promise.all([page.waitForResponse(isActionPost, { timeout: 60_000 }), check.click()]);
    const body = await response.text();
    const contentType = response.headers()["content-type"] ?? "text/x-component";
    await expect(page.locator('[data-takeoff="check-error"]')).toBeVisible({ timeout: 30_000 });
    const at = body.indexOf('{"ok":false');
    expect(at, `no refusal row in the captured response: ${body.slice(0, 200)}`).toBeGreaterThanOrEqual(0);
    const end = body.indexOf("\n", at);
    const labels = Array.from({ length: DEMOTE_N }, (_, i) => ({
      id: i + 1,
      label: i % 2 === 0 ? "CASEWORK" : "REFERENCE",
      reason: i % 2 === 0 ? "INVENTED verdict for the screenshot" : "INVENTED verdict for the screenshot",
    }));
    const replaced =
      body.slice(0, at) +
      JSON.stringify({ ok: true, value: { labels, missing: [], model: "replayed-in-e2e" } }) +
      (end === -1 ? "" : body.slice(end));
    await page.route(
      (url) => url.pathname.startsWith("/takeoff/"),
      async (route) => {
        const req = route.request();
        if (req.method() === "POST" && req.headers()["next-action"] !== undefined) {
          await route.fulfill({ status: 200, contentType, body: replaced });
        } else {
          await route.fallback();
        }
      },
    );
    await check.click();
    const demoted = page.locator('[data-takeoff="demoted"]');
    await expect(demoted).toBeVisible({ timeout: 30_000 });
    const rows = await page.locator('[data-takeoff="demoted-row"]').count();
    const lines = await page.locator('[data-takeoff="demoted-wall"]').count();
    const after = await foundCount();
    await page.screenshot({ path: path.join(OUT, `p${PAGE}-02-demoted-INVENTED-verdict.png`) });
    await page.locator('[data-takeoff="demoted-row"]').first().hover();
    await page.screenshot({ path: path.join(OUT, `p${PAGE}-03-demoted-row-hovered-INVENTED-verdict.png`) });
    await page.locator('[data-takeoff="accept-demoted"]').first().click();
    await expect(page.locator('[data-takeoff="demoted-row"]')).toHaveCount(rows - 1);
    const accepted = await foundCount();
    await page.screenshot({ path: path.join(OUT, `p${PAGE}-04-one-taken-back-INVENTED-verdict.png`) });
    const note = `p${PAGE}: found ${before} runs; replayed verdict demoted ${rows} (grey lines ${lines}); total ${before} -> ${after}; one taken back -> ${accepted}\n`;
    console.log(note);
    writeFileSync(path.join(OUT, `p${PAGE}-demoted.txt`), note);
    expect(rows).toBe(DEMOTE_N);
    expect(lines).toBe(DEMOTE_N);
    expect(after).toBe(before - DEMOTE_N);
    expect(accepted).toBe(before - DEMOTE_N + 1);
  });
});
