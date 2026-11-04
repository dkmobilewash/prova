import path from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── DOES THE APP SHOW THE LIST THE EVALS SCORE? ──
 *
 * `detectForSheet` + `offeredCandidates` is now the one pipeline the viewer
 * calls and every eval measures. This drives the real app on real sheets and
 * records what the panel shows, so `realplan/zzAppEquals.eval.ts` can compute
 * the same list in Node and the two can be compared number for number.
 *
 * The scale is SET the same way on both sides: two clicks half a page width
 * apart declared as 144 ft, which is 288 ft per page width exactly, so the
 * only thing that can differ is the pipeline.
 *
 * The drawings are a client's: read in place from `REAL_PLAN_DIR`, served
 * from disk, never copied in. Results go to `APP_EQ_OUT`, outside the tree.
 * Skips without both. `APP_EQ_SHEETS` is `<name fragment>:<page>,…`.
 */
const PLANS = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.APP_EQ_OUT ?? "";
const SHEETS = (process.env.APP_EQ_SHEETS ?? "Murray:24,Crosslines:10,Baker:13,Baker:12")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((s) => ({ set: s.split(":")[0], page: Number(s.split(":")[1]) }));

test.describe.configure({ mode: "serial" });

test.describe("the app's candidate list against the eval's", () => {
  test.skip(PLANS === "" || OUT === "", "needs REAL_PLAN_DIR and APP_EQ_OUT");
  test.setTimeout(900_000);
  let page: Page;
  let monitor: HealthMonitor;
  let served: Buffer | null = null;
  const results: { set: string; file: string; page: number; keyLines: number; runsText: string; caution: string; feetPerUnit: number; calibration: { points: string; declaredDistanceFeet: string }; seen: string | null }[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    monitor = new HealthMonitor(page);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      if (served === null) return route.continue();
      return route.fulfill({ status: 200, contentType: "application/pdf", body: served });
    });
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
  });
  test.afterAll(async () => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, "app-counts.json"), JSON.stringify(results, null, 2));
    await page?.close();
  });

  const picker = () => page.locator('[data-takeoff="sheet-picker"]');
  async function toSheet(n: number): Promise<void> {
    await picker().selectOption(String(n));
    await expect
      .poll(async () => page.locator('[data-testid="takeoff-plan-port"] canvas').evaluate((node) => (node as HTMLCanvasElement).width), { timeout: 180_000, message: `sheet ${n} never rendered` })
      .toBeGreaterThan(0);
    await expect(picker()).toHaveValue(String(n));
    await page.waitForTimeout(600);
  }

  for (const sheet of SHEETS) {
    test(`${sheet.set} p${sheet.page}: what the panel shows`, async () => {
      const matches = readdirSync(PLANS).filter((name) => name.toLowerCase().endsWith(".pdf") && name.toLowerCase().includes(sheet.set.toLowerCase()));
      expect(matches.length, `no pdf in REAL_PLAN_DIR matching "${sheet.set}"`).toBeGreaterThan(0);
      const file = path.join(PLANS, matches[0]);
      expect(existsSync(file)).toBe(true);
      served = readFileSync(file);
      const id = await startJob(page, monitor, { name: `ZZ-E2E App=Eval ${sheet.set} ${sheet.page}`, gcName: "ZZ-E2E App=Eval GC" });
      await finishWizard(page, monitor, id);
      await openJobTab(page, "Takeoff");
      await page.waitForURL(new RegExp(`/jobs/${id}/takeoff$`));
      await stubDocumentUpload(page);
      await page.locator('input[type="file"]').setInputFiles(file);
      await page.getByRole("button", { name: "Add a drawing" }).click();
      await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 180_000 });
      await page.goto(`/takeoff/${id}?key=1`);
      await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
      await expect(picker()).toBeVisible({ timeout: 60_000 });
      await toSheet(sheet.page);
      const overlay = page.locator('[data-testid="takeoff-plan-port"] svg');
      await page.getByRole("button", { name: "Set scale" }).click();
      const box = await overlay.boundingBox();
      expect(box).not.toBeNull();
      await overlay.click({ position: { x: box!.width * 0.2, y: box!.width * 0.3 } });
      await overlay.click({ position: { x: box!.width * 0.7, y: box!.width * 0.3 } });
      const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
      await form.locator('input[name="declaredDistanceFeet"]').fill("144");
      await form.locator('input[name="pageLabel"]').fill(`P${sheet.page}`);
      // The line the app will STORE, read off the form before it is sent, so
      // the Node side can derive feet per page width exactly as the viewer does.
      const calibration = {
        points: await form.locator('input[name="points"]').inputValue(),
        declaredDistanceFeet: await form.locator('input[name="declaredDistanceFeet"]').inputValue(),
      };
      await form.getByRole("button", { name: "Set the scale" }).click();
      await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 60_000 });
      const find = page.locator('[data-takeoff="find-walls"]');
      await expect(find).toBeEnabled({ timeout: 60_000 });
      await find.click();
      await expect(find).toHaveText("Find the walls", { timeout: 600_000 });
      await page.waitForTimeout(1500);
      const keyLines = await page.locator('[data-takeoff="key-line"]').count();
      const cautionNode = page.locator('[data-takeoff="found-walls"]');
      const caution = (await cautionNode.count()) > 0 ? (await cautionNode.first().innerText()).replace(/\s+/g, " ").slice(0, 400) : "";
      const runsText = /Found (\d+) runs/.exec(caution)?.[1] ?? "";
      const seen = await page.locator('[data-testid="takeoff-plan-port"]').getAttribute("data-takeoff-detect");
      results.push({ set: sheet.set, file: matches[0], page: sheet.page, keyLines, runsText, caution, feetPerUnit: 288, calibration, seen });
      expect(keyLines, `${sheet.set} p${sheet.page} offered no candidates`).toBeGreaterThan(0);
      await page.locator('[data-testid="takeoff-plan-port"]').screenshot({ path: path.join(OUT, `${sheet.set}-p${sheet.page}.png`) }).catch(() => undefined);
    });
  }
});
