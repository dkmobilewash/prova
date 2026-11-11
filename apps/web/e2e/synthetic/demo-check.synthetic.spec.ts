import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";
import { SYNTHETIC_STEPS } from "../lib/syntheticReport.mjs";
import type { SyntheticRun, SyntheticStep } from "../lib/syntheticReport.d.mts";

/**
 * ── THE DAILY SYNTHETIC CHECK, ON THE DEMO ENVIRONMENT ──
 *
 * What a pilot does first, against a real deployed preview: sign in, start a
 * job, upload a small plan set, run the takeoff, open the review queue, build
 * the estimate, open the proposal. Every step is timed and written to
 * SYNTHETIC_OUT; e2e/synthetic-report.mjs turns that into the verdict and the
 * #prova-build post.
 *
 * NOTHING IS STUBBED, which is the point of it and the difference from CI: the
 * upload goes to the preview's real blob store, the walls are found by the
 * deployed code, and no row is seeded. It runs against the DEMO database
 * (previews' DATABASE_URL), never production, and it cannot reach the
 * database at all — every check is on the screen.
 *
 * One persona, every day (PERSONAS.takeoff): the Clerk development instance
 * caps at 100 users. Its company on the demo database gains one job a day,
 * each named "ZZ-SYNTH <date>" so it is plain what it is.
 *
 * The plan is the invented one-sheet fixture S02 (3 KB, no client drawing).
 */

const OUT = process.env.SYNTHETIC_OUT ?? path.resolve(__dirname, "../artifacts/synthetic/result.json");
const PLAN = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
/** S02 is 144 ft across; the scale is set by two clicks half the sheet apart. */
const HALF_SHEET_FEET = 72;

test("the demo environment: sign in to proposal", async ({ page }) => {
  const monitor = new HealthMonitor(page);
  const run: SyntheticRun & { commit?: string; jobId?: string } = { ok: false, startedAt: new Date().toISOString(), steps: [] };
  const save = () => {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(run, null, 2));
  };

  async function step(name: (typeof SYNTHETIC_STEPS)[number], body: () => Promise<string | void>): Promise<void> {
    const t0 = Date.now();
    const row: SyntheticStep = { name, seconds: 0, ok: false };
    run.steps.push(row);
    try {
      const note = await body();
      row.ok = true;
      if (note) row.note = note;
    } catch (error) {
      row.error = await explain(page, error);
      throw error;
    } finally {
      row.seconds = Math.round((Date.now() - t0) / 100) / 10;
      save();
    }
  }

  let jobId = "";
  try {
    await step("sign in", async () => {
      await signInAs(page, PERSONAS.takeoff.email);
      await landOnDashboard(page, monitor);
      run.commit = await servedCommit(page);
    });

    await step("create job", async () => {
      jobId = await startJob(page, monitor, { name: `ZZ-SYNTH ${run.startedAt.slice(0, 10)}`, gcName: "ZZ-SYNTH GC", newGc: false });
      await finishWizard(page, monitor, jobId);
      run.jobId = jobId;
    });

    await step("upload plans", async () => {
      await page.goto(`/jobs/${jobId}/takeoff`);
      await expectHealthy(page, "takeoff tab", { monitor });
      await hydrated(page, 'input[type="file"]');
      await page.locator('input[type="file"]').first().setInputFiles(PLAN);
      await page.getByRole("button", { name: "Add a drawing" }).click();
      // Only a stored plan offers its revision: this cannot be on the page before the upload lands.
      await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 120_000 });
    });

    await step("run takeoff", async () => {
      await page.goto(`/takeoff/${jobId}`);
      await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 120_000 });
      await expectHealthy(page, "takeoff workspace", { monitor, signedIn: false });
      const port = page.locator('[data-testid="takeoff-plan-port"]');
      await expect.poll(() => port.locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 120_000, message: "the sheet never drew" }).toBeGreaterThan(0);
      const press = page.locator('[data-takeoff="find-walls"]');
      if (!(await press.isEnabled().catch(() => false))) await setScaleByClicking(page);
      await hydrated(page, '[data-takeoff="find-walls"]');
      await expect(press).toBeEnabled({ timeout: 60_000 });
      await press.click();
      const groups = page.locator('[data-takeoff="found-group"]');
      // A found group is the deployed code reading this sheet's walls; none exists before the press.
      await expect(groups.first()).toBeVisible({ timeout: 300_000 });
      return `${await groups.count()} wall group(s) found`;
    });

    await step("review queue", async () => {
      await page.goto(`/takeoff/${jobId}?open=review`);
      const queue = page.locator('[data-takeoff="review-queue"]');
      await expect(queue).toBeVisible({ timeout: 120_000 });
      await expectHealthy(page, "review queue", { monitor, signedIn: false });
      return (await queue.locator('[data-takeoff="review-queue-left"]').innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 120);
    });

    await step("build estimate", async () => {
      await page.goto(`/jobs/${jobId}/estimate`);
      await expectHealthy(page, "estimate", { monitor });
      // TODO(selectors): settled by the first run against a preview.
    });

    await step("open proposal", async () => {
      await page.goto(`/jobs/${jobId}/proposal`);
      await expectHealthy(page, "proposal", { monitor });
      await expect(page.locator('[data-proposal="terms"]')).toBeVisible({ timeout: 60_000 });
    });

    expect(monitor.crashes, "uncaught exceptions in the browser").toEqual([]);
    run.ok = true;
  } finally {
    save();
  }
});

async function hydrated(page: Page, selector: string): Promise<void> {
  await expect
    .poll(() => page.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))), { timeout: 60_000, message: `${selector} never hydrated` })
    .toBe(true);
}

async function setScaleByClicking(page: Page): Promise<void> {
  const overlay = page.locator('[data-testid="takeoff-plan-port"] svg');
  await page.getByRole("button", { name: "Set scale", exact: true }).click();
  const box = await overlay.boundingBox();
  if (!box) throw new Error("the sheet has no overlay to click a scale on");
  await overlay.click({ position: { x: box.width * 0.2, y: box.width * 0.5 } });
  await overlay.click({ position: { x: box.width * 0.7, y: box.width * 0.5 } });
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
  await form.locator('input[name="declaredDistanceFeet"]').fill(String(HALF_SHEET_FEET));
  await form.locator('input[name="pageLabel"]').fill("A101");
  await form.getByRole("button", { name: "Set the scale" }).click();
  await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 60_000 });
}

/** The commit the preview is serving: the first 32 hex of `dpl=` (CLAUDE.md). */
async function servedCommit(page: Page): Promise<string> {
  return page.evaluate(
    () => [...document.querySelectorAll<HTMLScriptElement>('script[src*="dpl="]')].map((s) => /dpl=([0-9a-f]{32})/.exec(s.src)?.[1]).find(Boolean) ?? "unknown",
  );
}

/** The failure in one line, plus the one cause worth naming: a demo database behind main. */
async function explain(page: Page, error: unknown): Promise<string> {
  const first = (error instanceof Error ? error.message : String(error)).split("\n").find((l) => l.trim())?.trim() ?? "unknown";
  const body = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  const drift = /Migrate demo database|does not exist in the current database|column .* does not exist/.test(body);
  return `${drift ? "the demo database is behind main — run the Migrate demo database workflow. " : ""}${first.slice(0, 300)} (at ${page.url()})`;
}
