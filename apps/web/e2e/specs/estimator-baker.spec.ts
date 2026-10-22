import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";
import { openPlanPdf, titleBlockText } from "@/lib/plan-ingest/planPdf";
import { sheetNumberFrom } from "@/lib/plan-ingest/sheetNumber";
import { storedLegendTypes } from "@/lib/takeoff/legendProposal";
import { legendCropRects } from "@/lib/takeoff/legendSight";

/**
 * ── THE WHOLE TAKEOFF AS AN ESTIMATOR WOULD DO IT, ON A REAL TRAINING SET ──
 *
 * SKIPS unless `REAL_PLAN_DIR`, `ESTIMATOR_SET` (the pdf's file name inside
 * it), `LEGEND_CACHE` and `ESTIMATOR_OUT` (a folder OUTSIDE the repository)
 * are set, and the runner was started with `TAKEOFF_LOCAL_PLAN_DIR` =
 * `REAL_PLAN_DIR`, `ALLOW_LOCAL_PLANS=1` and `HOSTNAME=localhost`, so the
 * server reads the set from this disk the way `dev-local-plans.sh` does.
 * Nothing is uploaded anywhere.
 *
 * Two stand-ins, both named in the report rather than hidden:
 *   - the upload itself: the throwaway stack has no blob store, so the plan
 *     row is written with a `local:` file after the upload screen is shot;
 *   - the two model stages: sheet names come from the keyless title-block
 *     reader and the wall legend from the second session's CACHED read of
 *     this set (`LEGEND_CACHE`), so no model is called and nothing is spent.
 *     The page inventory itself runs for real; it calls no model.
 *
 * Every step is photographed into ESTIMATOR_OUT, and every sentence the
 * panels show is written to a text file beside the pictures, so the list of
 * where an estimator would be confused is read off what the screen said.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.ESTIMATOR_SET ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const OUT = process.env.ESTIMATOR_OUT ?? "";
const LEGEND_PAGE = Number(process.env.ESTIMATOR_LEGEND_PAGE ?? "25");
const PLAN_PAGE = Number(process.env.ESTIMATOR_PLAN_PAGE ?? "13");
const PDF = path.join(DIR, SET);

test.describe.configure({ mode: "serial" });

test.describe("an estimator's takeoff on a real set", () => {
  test.skip(DIR === "" || SET === "" || CACHE === "" || OUT === "" || !existsSync(PDF), "no real set named for the estimator walkthrough");
  test.setTimeout(1_200_000);
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let planId = "";
  let companyId = "";
  const notes: string[] = [];
  const say = (line: string) => {
    notes.push(line);
    console.log(line);
  };
  let shotIndex = 0;
  const shot = async (name: string, target?: { screenshot: (o: { path: string }) => Promise<unknown> }) => {
    shotIndex += 1;
    const file = path.join(OUT, `${String(shotIndex).padStart(2, "0")}-${name}.png`);
    if (target) await target.screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: false });
    say(`[shot ${shotIndex}] ${name}`);
  };

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    writeFileSync(path.join(OUT, "walkthrough.txt"), notes.join("\n") + "\n");
    await page?.context().close();
  });

  const port = () => page.locator('[data-testid="takeoff-plan-port"]');
  const overlay = () => port().locator("svg");
  async function settledOverlayBox(): Promise<{ width: number }> {
    let previous = -1;
    let steady = 0;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const box = await overlay().boundingBox();
      if (box && box.width > 0 && Math.abs(box.width - previous) < 0.5) {
        steady += 1;
        if (steady >= 3) return { width: box.width };
      } else steady = 0;
      previous = box?.width ?? -1;
      await page.waitForTimeout(100);
    }
    throw new Error("the sheet never stopped resizing, so no click on it can be trusted");
  }

  test("1. sign in, switch on, starters, a job, and the upload screen", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    await page.goto("/settings?tab=estimating");
    const form = page.locator('[data-settings="room-finder"]');
    await expect.poll(() => form.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))), { timeout: 30_000 }).toBe(true);
    await shot("settings-room-finder-switch");
    const box = form.locator('input[name="roomFinderOn"]');
    if (!(await box.isChecked())) {
      await box.check();
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form.getByText("Saved.")).toBeVisible({ timeout: 30_000 });
    }
    await page.goto("/wall-types");
    await shot("wall-types-empty");
    const starters = page.getByRole("button", { name: /Start from the common trade assemblies/ });
    if (await starters.isVisible()) {
      await starters.click();
      await expect(page.getByText(/^Added |already have every starter/)).toBeVisible({ timeout: 60_000 });
    }
    await shot("wall-types-with-starters");
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Estimator — Baker EOC", gcName: "ZZ-E2E Estimator GC" });
    await finishWizard(page, monitor, jobId);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } });
    companyId = job.companyId;
    await page.goto(`/jobs/${jobId}`);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff$`));
    await shot("takeoff-tab-upload-form");
    say(`takeoff tab before any plan: ${(await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 600)}`);
  });

  test("2. the set is read: the page inventory runs on its own, and the sheets are filed", async () => {
    const plan = await prisma.takeoffPlan.create({
      data: { companyId, jobId, fileUrl: `local:${SET}`, fileName: SET, revisionLabel: "Bid set" },
      select: { id: true },
    });
    planId = plan.id;
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expectHealthy(page, "takeoff tab with the set", { monitor });
    const panel = page.locator('[data-plan-ingest="panel"]');
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await shot("ingest-started", panel);
    // The inventory is done when the next stage is offered.
    await expect(panel.getByRole("button", { name: /Read the title blocks/ })).toBeVisible({ timeout: 900_000 });
    await shot("ingest-done", panel);
    say(`ingest panel after the inventory: ${(await panel.innerText()).replace(/\s+/g, " ").slice(0, 900)}`);
    const texts = await prisma.planSheetText.count({ where: { planId } });
    say(`sheet text rows written by the inventory: ${texts}`);

    // ── THE TITLE-BLOCK STAGE'S PROPOSALS, FROM THE KEYLESS READER ──
    const ingest = await prisma.planIngestJob.findFirstOrThrow({ where: { planId, stage: "PAGE_INVENTORY" }, orderBy: { startedAt: "desc" }, select: { id: true } });
    const pdf = await openPlanPdf(readFileSync(PDF));
    let proposed = 0;
    for (let n = 1; n <= pdf.pageCount; n += 1) {
      const t = await pdf.pageText(n);
      if (t.items.length < 20) continue;
      const r = sheetNumberFrom(t);
      if (r.sheetNumber === null) continue;
      const title = titleBlockText(t).text.replace(/\s+/g, " ").trim().slice(0, 80);
      await prisma.planSheetProposal.create({
        data: { ingestJobId: ingest.id, planId, pageNumber: n, proposedSheetNumber: r.sheetNumber, proposedTitle: title, proposedReason: "keyless title-block reader (stand-in for the model stage)", proposedConfidence: "MEDIUM", model: "none", promptVersion: "n/a" },
      });
      proposed += 1;
    }
    say(`sheet proposals seeded from the keyless reader: ${proposed} of ${pdf.pageCount} pages`);
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expectHealthy(page, "takeoff tab with sheet proposals", { monitor });
    const index = page.locator("summary").filter({ hasText: "Sheet index" });
    await expect(index).toBeVisible({ timeout: 60_000 });
    await index.click();
    const review = page.locator('[data-sheet-review="root"]');
    await expect(review).toBeVisible();
    await shot("sheet-index-to-check", review);
    say(`sheet index before confirming: ${(await review.innerText()).replace(/\s+/g, " ").slice(0, 1200)}`);
    const confirm = review.getByRole("button", { name: /Confirm|Accept|File/ }).first();
    if (await confirm.isVisible()) {
      await confirm.click();
      await page.waitForTimeout(3000);
      await shot("sheet-index-confirmed", review);
      say(`sheet index after confirming: ${(await review.innerText()).replace(/\s+/g, " ").slice(0, 600)}`);
    } else {
      say("sheet index: no confirm control found");
    }
    await pdf.close();
  });

  test("3. the wall legend: review the read, add every type to the library", async () => {
    const cacheKey = SET.replace(/\W+/g, "_");
    const text = JSON.parse(readFileSync(path.join(CACHE, `${cacheKey}-p${LEGEND_PAGE}-wall-legend.1.json`), "utf8"));
    const sightFiles = (await import("node:fs")).readdirSync(CACHE).filter((f) => f.startsWith(`${cacheKey}-p${LEGEND_PAGE}-wall-legend-sight.`)).sort();
    const sight = sightFiles.length === 0 ? null : JSON.parse(readFileSync(path.join(CACHE, sightFiles[sightFiles.length - 1]), "utf8"));
    const pdf = await openPlanPdf(readFileSync(PDF));
    const t = await pdf.pageText(LEGEND_PAGE);
    const r = sheetNumberFrom(t);
    const where = `${r.sheetNumber ?? `page ${LEGEND_PAGE}`} (page ${LEGEND_PAGE})`;
    const merged = storedLegendTypes(text, sight, where);
    const crops = legendCropRects({ text: t.items, codes: merged.map((m) => m.code), widthPt: t.widthPt, heightPt: t.heightPt });
    await pdf.close();
    const ingest = await prisma.planIngestJob.findFirstOrThrow({ where: { planId }, orderBy: { startedAt: "desc" }, select: { id: true } });
    await prisma.planLegendProposal.create({
      data: { ingestJobId: ingest.id, planId, pageNumber: LEGEND_PAGE, sheetTitle: r.sheetNumber ?? null, textRead: text, sightRead: sight, merged: merged as never, crops: crops as never, reason: text.reason, confidence: text.confidence, model: "cached read (second session's legend-by-sight)", promptVersion: "wall-legend-sight.cached" },
    });
    say(`legend proposal seeded: ${merged.length} types, ${crops.length} crops, from ${where}`);
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expectHealthy(page, "takeoff tab with a legend read", { monitor });
    const link = page.locator('[data-plan-ingest="legend-review"] a');
    await expect(link).toHaveCount(1, { timeout: 60_000 });
    await shot("takeoff-tab-legend-link");
    await link.click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff/legend$`));
    await expectHealthy(page, "legend review", { monitor });
    await expect(page.locator('[data-legend="type"]')).toHaveCount(merged.length, { timeout: 60_000 });
    await page.waitForTimeout(4000);
    await shot("legend-review", undefined);
    for (const type of merged) {
      const row = page.locator(`[data-legend="type"][data-legend-code="${type.code}"]`);
      await row.scrollIntoViewIfNeeded();
      say(`legend row ${type.code}: ${(await row.innerText()).replace(/\s+/g, " ").slice(0, 500)}`);
      const add = row.locator('[data-legend="add"]');
      if ((await add.count()) === 0) continue;
      await add.click();
      await expect(row.locator('[data-legend="message"]')).toBeVisible({ timeout: 120_000 });
      say(`  → ${(await row.locator('[data-legend="message"]').innerText()).replace(/\s+/g, " ")}`);
    }
    await shot("legend-all-added");
    await page.goto("/wall-types");
    await expectHealthy(page, "wall types after the legend", { monitor });
    await shot("wall-types-after-legend");
    const types = await prisma.wallType.findMany({ where: { companyId, code: { in: merged.map((m) => m.code) } }, select: { code: true, defaultHeightFt: true, thicknessIn: true, studSpacingIn: true, components: { select: { description: true, basis: true } } } });
    for (const w of types) say(`library ${w.code}: height ${w.defaultHeightFt ?? "—"} ft, ${w.thicknessIn ?? "—"} in, studs ${w.studSpacingIn} o.c., parts: ${w.components.map((c) => `${c.description} [${c.basis}]`).join("; ")}`);
  });

  test("4. the floor plan: scale, Find the walls, add every group", async () => {
    await page.goto(`/takeoff/${jobId}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 120_000 });
    const picker = page.locator('[data-takeoff="sheet-picker"]');
    await expect(picker).toBeVisible({ timeout: 120_000 });
    const options = await picker.locator("option").allTextContents();
    say(`sheet picker offers ${options.length} sheets; first ten: ${options.slice(0, 10).join(" | ")}`);
    await shot("workspace-first-open");
    const values = await picker.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const wanted = values.find((v) => v === String(PLAN_PAGE)) ?? values[PLAN_PAGE - 1];
    await picker.selectOption(wanted);
    await expect.poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 300_000 }).toBeGreaterThan(0);
    await settledOverlayBox();
    await shot("floor-plan-open");
    say(`sheet facts: ${((await page.locator('[data-takeoff="sheet-facts"]').innerText({ timeout: 5000 }).catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 400)}`);
    const toolbar = page.locator('[data-takeoff="workspace"]').getByRole("button", { name: "Set scale", exact: true });
    say(`toolbar before Set scale: ${(await page.locator("main, body").first().innerText({ timeout: 10_000 })).replace(/\s+/g, " ").slice(0, 300)}`);
    try {
      await toolbar.first().click({ timeout: 30_000 });
    } catch (err) {
      say(`Set scale click did not go through normally (${String(err).slice(0, 120)}); forcing it`);
      await toolbar.first().click({ timeout: 30_000, force: true });
    }
    await page.waitForTimeout(1500);
    await shot("set-scale-opened");
    const offer = page.getByRole("button", { name: /Use the printed scale|Use this scale|Use it/ }).first();
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    say(`set-scale panel says: ${(await form.innerText({ timeout: 5000 }).catch(() => "(no form)")).replace(/\s+/g, " ").slice(0, 700)}`);
    if (await offer.isVisible()) {
      await offer.click();
      say("scale: took the printed-scale offer");
    } else {
      const box = await settledOverlayBox();
      await overlay().click({ position: { x: box.width * 0.2, y: box.width * 0.5 } });
      await overlay().click({ position: { x: box.width * 0.7, y: box.width * 0.5 } });
      await form.locator('input[name="declaredDistanceFeet"]').fill("144");
      say("scale: no printed-scale offer was shown, clicked two points and typed 144 ft (half the sheet at 1/8\")");
    }
    const label = form.locator('input[name="pageLabel"]');
    if (await label.isVisible()) {
      const current = await label.inputValue();
      say(`scale form's sheet label was "${current}"`);
      if (current.trim() === "") await label.fill("A101");
    }
    await shot("set-scale-filled");
    await form.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 60_000 });
    say(`after setting the scale: ${(await page.getByText(/^Scale set/).first().innerText()).replace(/\s+/g, " ")}`);
    await shot("scale-set");

    const findWalls = page.locator('[data-takeoff="find-walls"]');
    await expect(findWalls).toBeEnabled({ timeout: 60_000 });
    await findWalls.click();
    await expect(findWalls).toHaveText("Find the walls", { timeout: 900_000 });
    await page.waitForTimeout(1000);
    await shot("walls-found");
    const groups = page.locator('[data-takeoff="found-group"]');
    const n = await groups.count();
    say(`found-walls panel: ${n} groups`);
    for (let i = 0; i < n; i += 1) say(`  group ${i + 1}: ${(await groups.nth(i).innerText()).replace(/\s+/g, " ").slice(0, 600)}`);
    const uno = page.locator('[data-takeoff="uno-option"]');
    say(`U.N.O. option offered in a picker: ${await uno.count()} (this set prints no "ALL PARTITIONS TYPE … U.N.O." note)`);
    // Add every group the panel lets us, as an estimator clicking down the list.
    for (let round = 0; round < 40; round += 1) {
      const add = page.getByRole("button", { name: /^Add these/ }).first();
      if ((await add.count()) === 0 || !(await add.isEnabled())) break;
      const row = add.locator("xpath=ancestor::li[1]");
      const before = (await row.innerText({ timeout: 5000 }).catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
      await add.click();
      await page.waitForTimeout(2500);
      say(`  added: ${before}`);
    }
    const left = await groups.count();
    say(`groups left unadded (needing a choice or a type): ${left}`);
    for (let i = 0; i < left; i += 1) say(`  left ${i + 1}: ${(await groups.nth(i).innerText()).replace(/\s+/g, " ").slice(0, 400)}`);
    await shot("walls-after-adding");
    const rail = page.locator('[data-takeoff="items-rail"]');
    await shot("items-after-walls", rail);
    say(`items rail after walls: ${(await rail.innerText()).replace(/\s+/g, " ").slice(0, 800)}`);
  });

  test("5. Find the rooms with ceilings, save, and send everything to the estimate", async () => {
    const findRooms = page.locator('[data-takeoff="find-rooms"]');
    if (!(await findRooms.isEnabled())) {
      await page.locator('[data-takeoff="find-walls"]').click();
      await expect(findRooms).toBeEnabled({ timeout: 900_000 });
    }
    await findRooms.click();
    const panel = page.locator('[data-takeoff="rooms-panel"]');
    await expect(panel).toBeVisible({ timeout: 120_000 });
    await expect.poll(async () => (await page.locator('[data-takeoff="room-ceiling-from"]').allTextContents()).filter((t) => /reading/.test(t)).length, { timeout: 300_000 }).toBe(0);
    await panel.scrollIntoViewIfNeeded();
    await shot("rooms-with-ceilings", panel);
    const rows = page.locator('[data-takeoff="room-row"]');
    for (let i = 0; i < (await rows.count()); i += 1) say(`  room ${i + 1}: ${(await rows.nth(i).innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
    say(`rooms panel foot: ${(await panel.innerText()).replace(/\s+/g, " ").slice(-700)}`);
    await page.locator('[data-takeoff="save-rooms"]').click();
    await expect(panel).toHaveCount(0, { timeout: 120_000 });
    await page.reload();
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 120_000 });
    const rail = page.locator('[data-takeoff="items-rail"]');
    await shot("items-after-rooms", rail);
    say(`items rail after rooms: ${(await rail.innerText()).replace(/\s+/g, " ").slice(0, 900)}`);

    const items = rail.locator('[data-takeoff="item-row"]');
    const count = await items.count();
    for (let i = 0; i < count; i += 1) {
      const name = (await items.nth(i).innerText()).split("\n")[0];
      await items.nth(i).locator('[data-takeoff="pick-item"]').click();
      const assemblyPanel = page.locator('[data-takeoff="assembly-panel"]');
      await expect(assemblyPanel).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      say(`item "${name}": ${(await assemblyPanel.innerText()).replace(/\s+/g, " ").slice(0, 700)}`);
      if (i < 3) await shot(`assembly-${i + 1}`, assemblyPanel);
    }
    const assemblyPanel = page.locator('[data-takeoff="assembly-panel"]');
    await assemblyPanel.locator('[data-takeoff="send-to-estimate"]').click();
    const result = assemblyPanel.locator('[data-takeoff="send-result"]');
    await expect(result).toBeVisible({ timeout: 120_000 });
    say(`send to estimate: ${(await result.innerText()).replace(/\s+/g, " ")}`);
    await shot("send-result", assemblyPanel);
    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "estimate", { monitor });
    await page.screenshot({ path: path.join(OUT, "99-estimate-full.png"), fullPage: true });
    say(`estimate page: ${(await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 2500)}`);
    expect(count).toBeGreaterThan(0);
  });
});
