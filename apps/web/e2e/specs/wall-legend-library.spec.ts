import path from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { expectHealthy } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── "ADD THESE WALL TYPES TO YOUR LIBRARY", DRIVEN IN A BROWSER ──
 *
 * The legend READ needs a model and is not run here. What this proves is the
 * half a customer touches: a legend read stored on a job shows up as a link
 * on the takeoff tab, the review screen opens with one row per type and the
 * crop beside each, a field can be edited, and Add creates the wall type with
 * its parts and no price — asserted in the database, not off the screen.
 *
 * The proposal is seeded from `fixtures/wall-legend.json`, an INVENTED legend
 * in the shape the ingest stores — made-up codes, words and numbers, with one
 * one-sided type and one words-versus-drawing disagreement so the flags
 * render. No real drawing's text is in this repository. Optionally, on a
 * machine that has a client's plans OUTSIDE git, `LEGEND_FIXTURE` names a
 * stored read of a real legend (built by
 * lib/takeoff/realplan/zzLegendFixture.eval.ts) and `REAL_PLAN_DIR` the
 * folder holding the PDF it was read from; the crops are then real and the
 * spec also checks that the first type's crop is a drawing rather than a
 * blank. Without them the one-page fixture PDF stands in and that one check
 * is skipped, not faked.
 */

type Fixture = {
  pdf: string;
  pageNumber: number;
  pageCount: number;
  sheetTitle: string;
  sheetNumber: string;
  textRead: unknown;
  sightRead: unknown;
  merged: { code: string }[];
  crops: unknown[];
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  model: string;
  promptVersion: string;
};
const PLANS = process.env.REAL_PLAN_DIR ?? "";
const REAL_FIXTURE = process.env.LEGEND_FIXTURE ?? "";
const PLAN_FIXTURE = path.resolve(__dirname, "../fixtures/plan-sheet.pdf");
const INVENTED = path.resolve(__dirname, "../fixtures/wall-legend.json");
const REAL = REAL_FIXTURE !== "" && existsSync(REAL_FIXTURE) && PLANS !== "";
const FIXTURE = JSON.parse(readFileSync(REAL ? REAL_FIXTURE : INVENTED, "utf8")) as Fixture;
const PDF = REAL ? path.join(PLANS, FIXTURE.pdf) : PLAN_FIXTURE;
if (REAL && !existsSync(PDF)) throw new Error(`LEGEND_FIXTURE names ${FIXTURE.pdf}, which is not in REAL_PLAN_DIR`);
const SHOTS = process.env.TRACE_SHOTS ?? "";
const JOB_NAME = "ZZ-E2E Wall legend library";
const TYPE = FIXTURE.merged[0].code;

test.describe.configure({ mode: "serial" });

test.describe("a wall legend read off a set becomes wall types in the library", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let companyId = "";

  const shot = async (name: string) => {
    if (SHOTS === "") return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `legend-${name}.png`), fullPage: true });
  };

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    monitor = new HealthMonitor(page);
    const pdf = readFileSync(PDF);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
    });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("1. a job with a stored legend read links to the review screen from the takeoff tab", async () => {
    // The takeoff persona, not a new one: +1 555 555 0123 is already taken on the
    // development instance by a persona on another branch, so a LEGEND persona
    // failed global setup with `form_identifier_exists`. This spec makes its own
    // job and touches only the fixture's codes, so sharing the persona is safe.
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: JOB_NAME, gcName: "ZZ-E2E Legend GC" });
    await finishWizard(page, monitor, jobId);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } });
    companyId = job.companyId;
    // A clean library, so "in your library" below is this run's doing.
    await prisma.wallType.deleteMany({ where: { companyId, code: { in: FIXTURE.merged.map((t) => t.code) } } });

    const plan = await prisma.takeoffPlan.create({
      data: { companyId, jobId, fileUrl: "https://example.invalid/plan.pdf", fileName: REAL ? FIXTURE.pdf : "plan-sheet.pdf", revisionLabel: "Bid set" },
      select: { id: true },
    });
    const ingest = await prisma.planIngestJob.create({
      data: { planId: plan.id, companyId, stage: "WALL_LEGEND", pageCount: FIXTURE.pageCount, startedAt: new Date(), finishedAt: new Date() },
      select: { id: true },
    });
    await prisma.planSheetProposal.create({
      data: {
        ingestJobId: ingest.id,
        planId: plan.id,
        pageNumber: FIXTURE.pageNumber,
        proposedSheetNumber: FIXTURE.sheetNumber,
        proposedTitle: FIXTURE.sheetTitle,
        proposedReason: "seeded",
        proposedConfidence: "HIGH",
        model: "seed",
        promptVersion: "n/a",
      },
    });
    await prisma.planLegendProposal.create({
      data: {
        ingestJobId: ingest.id,
        planId: plan.id,
        pageNumber: FIXTURE.pageNumber,
        sheetTitle: FIXTURE.sheetTitle,
        textRead: FIXTURE.textRead as never,
        sightRead: FIXTURE.sightRead as never,
        merged: FIXTURE.merged as never,
        crops: FIXTURE.crops as never,
        reason: FIXTURE.reason,
        confidence: FIXTURE.confidence,
        model: FIXTURE.model,
        promptVersion: FIXTURE.promptVersion,
      },
    });

    await page.goto(`/jobs/${jobId}/takeoff`);
    await expectHealthy(page, "takeoff tab with a legend read stored", { monitor });
    const link = page.locator('[data-plan-ingest="legend-review"] a');
    await expect(link, "the takeoff tab offers the review screen").toHaveCount(1);
    await expect(link).toContainText(`${FIXTURE.merged.length} wall types`);
    await shot("takeoff-tab-link");
    await link.click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff/legend$`));
  });

  test("2. the review screen shows one row per type, the crop beside each, and the flags in red", async () => {
    await expectHealthy(page, "wall legend review", { monitor });
    const rows = page.locator('[data-legend="type"]');
    await expect(rows).toHaveCount(FIXTURE.merged.length);
    for (const type of FIXTURE.merged) {
      await expect(page.locator(`[data-legend="type"][data-legend-code="${type.code}"]`)).toHaveCount(1);
    }
    // Nothing is in the library yet, so every row offers Add and none says "in your library".
    await expect(page.locator('[data-legend="in-library"]')).toHaveCount(0);
    await expect(page.locator('[data-legend="add"]')).toHaveCount(FIXTURE.merged.length);
    await expect(page.locator('[data-legend="flags"] li').first(), "the legend's flags render, one line each").toBeVisible();

    // The crops are rendered from the sheet. "drawn" is set only after pdf.js
    // has painted the rectangle, so this is the browser saying it did.
    const crops = page.locator('[data-legend="crop"][data-legend-crop-state="drawn"]');
    await expect(crops, "every crop rendered from the drawing").toHaveCount(FIXTURE.crops.length, { timeout: 60_000 });
    if (REAL) {
      const painted = await page
        .locator(`[data-legend="type"][data-legend-code="${TYPE}"] canvas`)
        .evaluate((canvas: HTMLCanvasElement) => {
          const ctx = canvas.getContext("2d");
          if (!ctx) return 0;
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let dark = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark += 1;
          return dark;
        });
      expect(painted, "the crop is a drawing, not a blank canvas").toBeGreaterThan(200);
    }
    await shot("review-screen");
  });

  test("3. Add creates the wall type with its parts and no price, from the fields as edited", async () => {
    const row = page.locator(`[data-legend="type"][data-legend-code="${TYPE}"]`);
    await row.scrollIntoViewIfNeeded();
    const name = row.getByLabel("Name");
    await name.fill("Interior partition, 1 hr");
    await shot("row-before-add");
    await row.locator('[data-legend="add"]').click();
    await expect(row.locator('[data-legend="message"]')).toContainText(`Added ${TYPE}`);
    await expect(row.locator('[data-legend="in-library"]')).toHaveCount(1);
    await shot("row-after-add");

    const added = await prisma.wallType.findUniqueOrThrow({
      where: { companyId_code: { companyId, code: TYPE } },
      include: { components: true },
    });
    expect(added.name).toBe("Interior partition, 1 hr");
    expect(added.thicknessIn === null ? null : Number(added.thicknessIn)).toBeGreaterThan(3);
    expect(added.components.length, "studs, track and board at least").toBeGreaterThanOrEqual(3);
    for (const component of added.components) {
      expect(component.catalogEntryId, `${component.description} carries no price-book entry`).toBeNull();
      expect(component.costCategory, `${component.description} carries no cost category`).toBeNull();
    }
    const proposal = await prisma.planLegendProposal.findFirstOrThrow({ where: { plan: { jobId } }, select: { status: true, acceptedByUserId: true } });
    expect(proposal.status).toBe("ACCEPTED");
    expect(proposal.acceptedByUserId).not.toBeNull();
    // ── THE HEIGHT, READ OFF THE SET, OR HONESTLY NOT ──
    // P1 says EXTEND TO DECK and the one-page fixture prints no deck
    // elevation, so the library gets NO default height and the notes say why.
    expect(added.defaultHeightFt, "a 'to deck' type with no section must not get a guessed height").toBeNull();
    expect(added.notes ?? "").toMatch(/No height read: /);

    // The library page shows it, which is where the person is sent next.
    await page.goto("/wall-types");
    await expectHealthy(page, "wall types after adding from the legend", { monitor });
    await expect(page.getByText(TYPE, { exact: true }).first()).toBeVisible();
    await shot("wall-types");

    // A second Add of the same code is refused in words, not with a crash.
    await page.goto(`/jobs/${jobId}/takeoff/legend`);
    await expectHealthy(page, "review screen after one add", { monitor });
    await expect(page.locator(`[data-legend="type"][data-legend-code="${TYPE}"] [data-legend="in-library"]`)).toHaveCount(1);
    await expect(page.locator(`[data-legend="type"][data-legend-code="${TYPE}"] [data-legend="add"]`)).toHaveCount(0);
  });

  test("3b. a type whose legend prints its height lands in the library with that default height, and the row says so", async () => {
    const FIXED = "P5";
    const row = page.locator(`[data-legend="type"][data-legend-code="${FIXED}"]`);
    await row.scrollIntoViewIfNeeded();
    await row.locator('[data-legend="add"]').click();
    await expect(row.locator('[data-legend="message"]')).toContainText(`Added ${FIXED}`);
    await expect(row.locator('[data-legend="message"]')).toContainText("Height 10 ft (HIGH)");
    await shot("row-after-add-with-height");
    const added = await prisma.wallType.findUniqueOrThrow({ where: { companyId_code: { companyId, code: FIXED } } });
    expect(added.defaultHeightFt === null ? null : Number(added.defaultHeightFt)).toBe(10);
    expect(added.notes ?? "").toMatch(/Height 10 ft \(HIGH\)/);
  });
});
