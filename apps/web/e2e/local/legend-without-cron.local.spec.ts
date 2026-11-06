import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";

/**
 * ── A NEW COMPANY'S LEGEND IS READ WHILE THE PAGE IS OPEN, NOT BY TOMORROW'S CRON ──
 *
 * Found by the 4th's walk: the WALL_LEGEND run queued when the free pass
 * closes was never advanced by the plan panel, which pumped only the newest
 * run, so it waited for the 04:17Z daily cron — 65 legend pages unclaimed, and
 * no suggested types or heights for a new customer until the next day.
 *
 * A brand-new Clerk user (so a brand-new company), plan reading opted in,
 * a job, Baker uploaded on the Takeoff tab — and then nothing but the page
 * staying open. Nothing here calls `/api/plan-ingest/run`, and `next start`
 * runs no cron, so a legend proposal that appears was read by the page.
 *
 * LOCAL ONLY: real drawings and a real model (the legend read is a model call
 * per page). Run against your own `next start` with ALLOW_LOCAL_PLANS=1,
 * TAKEOFF_LOCAL_PLAN_DIR = WALK_PLAN_DIR and the model key, on a `_test`
 * database, E2E_PORT naming it:
 *   WALK_PLAN_DIR=… WALK_SET=2025.07.08_Baker_EOC_BID.pdf WALK_OUT=… npx playwright test --config e2e/playwright.real.config.ts legend-without-cron
 */
const DIR = process.env.WALK_PLAN_DIR ?? "";
const SET = process.env.WALK_SET ?? "";
const OUT = process.env.WALK_OUT ?? "";
/** How long the page is given. Long by default; a deliberate-break run shortens it. */
const WAIT_MS = Number(process.env.LEGEND_WAIT_MS ?? 1_500_000);
const EMAIL = `legend-${Date.now()}+clerk_test@example.com`;

test.describe.configure({ mode: "serial" });

test.describe("a new company's wall legend, read with the page open", () => {
  test.skip(DIR === "" || SET === "" || OUT === "", "WALK_PLAN_DIR, WALK_SET and WALK_OUT name the set and where the pictures go");
  test.setTimeout(1_800_000);
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let planId = "";

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. a fresh company with plan reading on, and a job", async () => {
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY ?? "" });
    // The development instance requires a username and a phone (walk v2, O1): a Clerk test number nobody holds.
    const free = Array.from({ length: 99 }, (_, i) => `+120155501${String(i + 1).padStart(2, "0")}`).sort(() => Math.random() - 0.5);
    let phone = "";
    for (const candidate of free) if ((await clerk.users.getUserList({ phoneNumber: [candidate] })).totalCount === 0) { phone = candidate; break; }
    expect(phone, "every Clerk test number is taken; delete some walk users").not.toBe("");
    await clerk.users.createUser({ emailAddress: [EMAIL], phoneNumber: [phone], username: `legend${Date.now()}`, firstName: "Legend", lastName: "Walk", skipPasswordRequirement: true });
    await signInAs(page, EMAIL);
    await page.goto("/dashboard");
    const user = await expect.poll(async () => prisma.user.findFirst({ where: { email: EMAIL }, select: { companyId: true } }), { timeout: 60_000 }).not.toBeNull().then(() => prisma.user.findFirstOrThrow({ where: { email: EMAIL }, select: { companyId: true } }));
    const companyId = user.companyId;
    expect(await prisma.planIngestJob.count({ where: { companyId } }), "a fresh company has read nothing").toBe(0);
    await prisma.companyAiSettings.upsert({ where: { companyId }, create: { companyId, optedInFeatures: ["PLAN_TEXT_READ"] }, update: { optedInFeatures: ["PLAN_TEXT_READ"] } });
    await prisma.company.update({ where: { id: companyId }, data: { tradePresetAskedAt: new Date() } });
    const contact = await prisma.contact.create({ data: { companyId, name: "ZZ Legend GC" } });
    jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "ZZ Legend without the cron", status: "ESTIMATE" }, select: { id: true } })).id;
  });

  test("2. Baker uploaded on the Takeoff tab", async () => {
    await page.goto(`/jobs/${jobId}/takeoff`);
    await stubDocumentUpload(page);
    // Hold the app's next server action until the stored plan points at the file on disk.
    let pointed!: () => void;
    const ready = new Promise<void>((resolve) => (pointed = resolve));
    let actions = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        actions += 1;
        if (actions > 1) await ready;
      }
      await route.fallback();
    });
    await page.locator('input[type="file"]').first().setInputFiles(path.join(DIR, SET));
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect.poll(async () => prisma.takeoffPlan.count({ where: { jobId } }), { timeout: 60_000 }).toBe(1);
    await prisma.takeoffPlan.updateMany({ where: { jobId }, data: { fileUrl: `local:${SET}` } });
    planId = (await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, select: { id: true } })).id;
    pointed();
    await page.unroute("**/*");
  });

  test("3. with the page left open, the legend is read and a proposal stored — no cron", async () => {
    const started = Date.now();
    let sawLegend = false;
    await expect
      .poll(
        async () => {
          if (!sawLegend) sawLegend = /The wall legend/.test((await page.locator('[data-plan-ingest="reading"]').first().textContent().catch(() => "")) ?? "");
          return prisma.planLegendProposal.count({ where: { planId } });
        },
        { timeout: WAIT_MS, intervals: [5_000] },
      )
      .toBeGreaterThan(0);
    const minutes = ((Date.now() - started) / 60_000).toFixed(1);
    const runs = await prisma.planIngestJob.findMany({ where: { planId }, orderBy: { createdAt: "asc" }, select: { stage: true, pageCount: true, finishedAt: true, _count: { select: { tasks: { where: { finishedAt: { not: null } } } } } } });
    console.log(`[legend] proposal after ${minutes} min; runs: ${runs.map((r) => `${r.stage} ${r._count.tasks}/${r.pageCount}${r.finishedAt ? " done" : ""}`).join(", ")}`);
    expect(runs.find((r) => r.stage === "WALL_LEGEND"), "the legend read was queued").toBeDefined();
    expect(sawLegend, "the panel said it was reading the wall legend").toBe(true);
    await page.screenshot({ path: path.join(OUT, "legend-read-with-the-page-open.png") });
    expect(monitor.crashes).toEqual([]);
  });
});
