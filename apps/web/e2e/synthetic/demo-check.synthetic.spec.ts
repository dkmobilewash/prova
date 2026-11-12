import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";
import { openItems } from "../lib/finders";
import { dataTour } from "../lib/dataTour";
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
  const run: SyntheticRun & { deployment?: string; jobId?: string } = { ok: false, startedAt: new Date().toISOString(), steps: [] };
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
  let wallType = "";
  try {
    await step("sign in", async () => {
      await signInAs(page, PERSONAS.takeoff.email);
      await landOnDashboard(page, monitor);
      run.deployment = await servedDeployment(page);
    });

    await step("create job", async () => {
      // The starter assemblies, once: a type with parts is what prices the walls. A no-op after the first day.
      await page.goto("/wall-types");
      await expectHealthy(page, "wall types", { monitor });
      const starters = page.getByRole("button", { name: /Start from the common trade assemblies/ });
      if (await starters.isVisible()) {
        await starters.click();
        await expect(page.getByText(/^Added |already have every starter/)).toBeVisible({ timeout: 60_000 });
      }
      jobId = await startJob(page, monitor, { name: `ZZ-SYNTH ${run.startedAt.slice(0, 10)}`, gcName: "ZZ-SYNTH GC", newGc: false });
      await finishWizard(page, monitor, jobId);
      run.jobId = jobId;
    });

    await step("upload plans", async () => {
      await page.goto(`/jobs/${jobId}/takeoff`);
      await expectHealthy(page, "takeoff tab", { monitor });
      await hydrated(page, 'input[type="file"]');
      await page.locator('input[type="file"]').first().setInputFiles(PLAN);
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
      // Found is not done: the walls go on the job once the sheet's walls are stored, and the panel says so.
      // Leaving before this line appears leaves the job with no quantities and nothing to review.
      const posted = page.locator('[data-takeoff="posted-note"]');
      await expect(posted).toHaveText(/^Put on the job/, { timeout: 300_000 });
      return `${await groups.count()} wall group(s) found; ${(await posted.innerText()).replace(/\s+/g, " ").trim().slice(0, 160)}`;
    });

    await step("review queue", async () => {
      await page.goto(`/takeoff/${jobId}?open=review`);
      const queue = page.locator('[data-takeoff="review-queue"]');
      await expect(queue).toBeVisible({ timeout: 120_000 });
      await expectHealthy(page, "review queue", { monitor, signedIn: false });
      const left = queue.locator('[data-takeoff="review-queue-left"]');
      const said = async () => (await left.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const before = await said();
      // The found walls wait here untyped. Give them a type with parts and a height: that is what prices them.
      const group = queue.locator('[data-takeoff="queue-group"]').first();
      await expect(group, `the queue offers no wall group to type ("${before}")`).toBeVisible({ timeout: 60_000 });
      await hydrated(page, '[data-takeoff="queue-accept"]');
      const typed = (await group.locator('[data-takeoff="queue-type"]').innerText()).trim();
      if (typed === "—") await group.locator('[data-takeoff="queue-code"]').first().click();
      const type = (await group.locator('[data-takeoff="queue-type"]').innerText()).trim();
      if (type === "—") throw new Error("no wall type to give the found walls: the starter assemblies are missing");
      const height = group.locator('[data-takeoff="queue-height"]');
      if ((await height.inputValue()) === "") await height.fill("10");
      // Accept is optimistic: the group leaves the queue at once and the save runs after, so neither the
      // queue's count nor "the next action" says it landed (that was a sheet-summary action). The save's
      // own answer carries "accepted"; wait for that one and require 1.
      const save = page.waitForResponse(
        async (response) => response.request().method() === "POST" && !!response.request().headers()["next-action"] && (await response.text().catch(() => "")).includes('"accepted":'),
        { timeout: 60_000 },
      );
      await group.locator('[data-takeoff="queue-accept"]').click();
      const answer = await (await save).text();
      if (!answer.includes('"accepted":1')) throw new Error(`typing the walls ${type} was not accepted: ${answer.replace(/\s+/g, " ").slice(0, 200)}`);
      await expect.poll(said, { timeout: 30_000, message: `the queue still says "${before}" after typing the walls ${type}` }).not.toBe(before);
      const refused = queue.getByRole("alert");
      if ((await refused.count()) > 0 && (await refused.first().innerText()).trim() !== "") throw new Error(`the queue refused ${type}: ${(await refused.first().innerText()).trim()}`);
      wallType = type;
      return `typed ${type}; "${before}" → "${await said()}"`;
    });

    await step("build estimate", async () => {
      // As the stepper's "Put the takeoff on the estimate" does: the typed walls' item, Send takeoff to the estimate.
      await page.goto(`/takeoff/${jobId}`);
      await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 120_000 });
      await openItems(page);
      const item = page.locator('[data-takeoff="items-rail"] [data-takeoff="item-row"]').filter({ hasText: wallType }).first();
      await expect(item, `no ${wallType} item in the items rail`).toBeVisible({ timeout: 60_000 });
      await hydrated(page, '[data-takeoff="pick-item"]');
      await item.locator('[data-takeoff="pick-item"]').click();
      const panel = page.locator('[data-takeoff="assembly-panel"]');
      await expect(panel).toBeVisible({ timeout: 60_000 });
      await panel.locator('[data-takeoff="send-to-estimate"]').click();
      const result = panel.locator('[data-takeoff="send-result"]');
      await expect(result).toContainText(/\d+ added/, { timeout: 60_000 });
      const sent = (await result.innerText()).replace(/\s+/g, " ").trim().slice(0, 120);
      await page.goto(`/jobs/${jobId}/estimate`);
      await expectHealthy(page, "estimate", { monitor });
      // No line exists on a new job until the takeoff is sent.
      const lines = page.locator(`${dataTour("job-line-items")} [id^="line-"]`);
      await expect(lines.first()).toBeVisible({ timeout: 60_000 });
      const total = (await page.locator(dataTour("job-line-items")).getByText(/^Lines total/).innerText()).replace(/\s+/g, " ");
      return `${sent}; ${await lines.count()} line(s), ${total}`;
    });

    await step("open proposal", async () => {
      await page.goto(`/jobs/${jobId}/proposal`);
      await expectHealthy(page, "proposal", { monitor });
      await expect(page.getByRole("heading", { level: 1, name: /^Proposal — / })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("heading", { name: "Schedule of values" })).toBeVisible();
      await expect(page.getByText("This job has no line items yet.")).toHaveCount(0);
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

/** The deployment the preview is serving, from `dpl=` on its scripts (a Vercel `dpl_…` id, not a commit). */
async function servedDeployment(page: Page): Promise<string> {
  return page.evaluate(
    () => [...document.querySelectorAll<HTMLScriptElement>('script[src*="dpl="]')].map((s) => /dpl=([\w-]+)/.exec(s.src)?.[1]).find(Boolean) ?? "unknown",
  );
}

/** The failure in one line, plus the one cause worth naming: a demo database behind main. */
async function explain(page: Page, error: unknown): Promise<string> {
  const first = (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim())?.trim() ?? "unknown";
  const body = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  // The drift arm's own sentence (components/PageLoadError.tsx). NOT "Migrate demo database": the
  // not-drift arm names that workflow too, to say it will not help.
  const drift = body.includes("On this preview, this is the database, not the code.");
  const boundary = body.includes("This page didn't load");
  const reference = /include reference (\S+?)\.?$/m.exec(body)?.[1];
  const cause = drift
    ? "the demo database is behind main — run the Migrate demo database workflow. "
    : boundary
      ? `the page hit its error boundary${reference ? ` (reference ${reference}, in Vercel's logs)` : ""}. `
      : "";
  return `${cause}${first.slice(0, 300)} (at ${page.url()})`;
}
