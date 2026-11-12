import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { deleteThrowaway, throwawayEmail } from "../lib/throwawayUsers.mjs";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { prisma } from "@prova/db";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { buildSpecBookFixture } from "../../lib/specs/fixtures/specBookFixture";
import { buildDrawingNotesFixture } from "../../lib/specs/fixtures/drawingNotesFixture";

/**
 * ── THE SPEC BOOK, WALKED: a new company uploads the project manual and sees its sections read ──
 *
 * A fresh sign-up (plan reading on, as every new company has it), a job, a wall legend
 * on the job's plans (seeded: three invented types, one of which disagrees with the
 * spec), then the invented fixture manual uploaded through the Specs page's own
 * button. The upload goes to the stubbed store, so the book's row is pointed at the
 * same bytes on disk (`local:`), the way the new-customer walk serves Baker — then
 * "Find the sections" runs on the real server and every trade section is read by
 * the REAL model. Ends on the proposal with one inclusion and one alternate added.
 *
 * SKIPS unless SPEC_DIR (the server's TAKEOFF_LOCAL_PLAN_DIR) and WALK_OUT are set,
 * on a `_test` database with E2E_PORT naming the server.
 */
const DIR = process.env.SPEC_DIR ?? "";
const OUT = process.env.WALK_OUT ?? "";
const BOOK = "riverbend-project-manual.pdf";
const EMAIL = throwawayEmail("specs");
// Pass or fail: the dev Clerk instance caps at 100 users (e2e/lib/throwawayUsers.mjs).
test.afterAll(async () => { await deleteThrowaway(EMAIL); });

let page: Page;
let shotN = 0;
const notes: string[] = [];
const note = (line: string) => {
  notes.push(line);
  console.log(`[specs] ${line}`);
};
async function shot(name: string): Promise<void> {
  shotN += 1;
  await page.screenshot({ path: path.join(OUT, `${String(shotN).padStart(2, "0")}-${name}.png`), fullPage: true }).catch(() => {});
}
const seen = (target: Locator, timeout = 5000) => target.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
async function hydrated(selector: string): Promise<void> {
  await expect
    .poll(() => page.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))).catch(() => false), { timeout: 60_000 })
    .toBe(true);
}
async function freeTestPhone(): Promise<string> {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY ?? "" });
  for (const digits of Array.from({ length: 99 }, (_, i) => `20155501${String(i + 1).padStart(2, "0")}`).sort(() => Math.random() - 0.5)) {
    if ((await clerk.users.getUserList({ phoneNumber: [`+1${digits}`] })).totalCount === 0) return digits;
  }
  throw new Error("every Clerk test number is taken; delete some walk users");
}

test.describe("the spec book on a new company's job", () => {
  test.skip(DIR === "" || OUT === "", "SPEC_DIR and WALK_OUT say where the book is served from and where the pictures go");
  test.setTimeout(1_200_000);

  test("upload, find, read, check the legend, add to the proposal", async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(DIR, BOOK), await buildSpecBookFixture());
    writeFileSync(path.join(DIR, "riverbend-plans.pdf"), await buildDrawingNotesFixture());
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    new HealthMonitor(page);
    const t0 = Date.now();

    // Sign up, as the new-customer walk does.
    await setupClerkTestingToken({ page });
    await page.goto("/sign-up");
    await hydrated('input[name="emailAddress"]');
    await page.locator('input[name="emailAddress"]').fill(EMAIL);
    const password = page.locator('input[name="password"]');
    if (await seen(password, 1000)) await password.fill(`Specs-${Date.now()}-pw!`);
    for (const [name, value] of [["firstName", "Dana"], ["lastName", "Walker"], ["username", `specs${Date.now()}`]] as const) {
      const box = page.locator(`input[name="${name}"]`);
      if (await seen(box, 300)) await box.fill(value);
    }
    const phone = page.locator('input[name="phoneNumber"]');
    if (await seen(phone, 300)) await phone.fill(await freeTestPhone());
    await page.getByRole("button", { name: /^Continue/ }).first().click();
    const code = page.locator('input[autocomplete="one-time-code"], input[name="code"]').first();
    for (let round = 0; round < 2; round += 1) {
      if (!(await seen(code, 15_000))) break;
      await code.click();
      await page.keyboard.type("424242");
      await page.waitForTimeout(3000);
    }
    await page.waitForURL(/\/welcome/, { timeout: 90_000 });
    await hydrated('[data-setup="trades"] button');
    await page.locator('[data-setup="trades"]').getByRole("button", { name: /Framing and drywall/ }).click();
    await page.locator('[data-setup="skip-sample"]').click(); // the sample offer after the trade (#1120): not now
    await page.getByRole("button", { name: "Later" }).click();
    const skip = page.getByRole("button", { name: "Skip for now" });
    if (await seen(skip, 15_000)) await skip.click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    const { companyId } = await prisma.user.findFirstOrThrow({ where: { email: EMAIL }, select: { companyId: true } });
    const settings = await prisma.companyAiSettings.findUnique({ where: { companyId }, select: { optedInFeatures: true } });
    note(`Signed up; plan reading opted in: ${String(settings?.optedInFeatures.includes("PLAN_TEXT_READ" as never) ?? false)}.`);

    // A job.
    await page.goto("/jobs/new");
    await hydrated('input[name="jobName"]');
    await page.locator('input[name="jobName"]').fill("Riverbend Clinic Fit-Out");
    const addNew = page.getByRole("button", { name: "+ Add a new GC" });
    if (await seen(addNew, 2000)) await addNew.click();
    await page.locator('input[name="contactName"]').fill("Walker Builders");
    await page.getByRole("button", { name: /Start the job/ }).click();
    await page.waitForURL(/\/jobs\/new\/[^/]+\/items$/, { timeout: 30_000 });
    const jobId = page.url().match(/\/jobs\/new\/([^/]+)\/items$/)![1]!;

    // The plan set's legend, as the legend stage stores it: three invented types.
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:riverbend-plans.pdf", fileName: "riverbend-plans.pdf" } });
    const run = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId, stage: "WALL_LEGEND", pageCount: 1 } });
    const type = (code: string, lines: string[]) => ({ code, name: null, lines, assembly: {}, from: "text", disagreements: [] });
    await prisma.planLegendProposal.create({
      data: {
        ingestJobId: run.id,
        planId: plan.id,
        pageNumber: 1,
        textRead: {},
        merged: [
          type("A1", ['3 5/8" 20 GA. MTL. STUDS @ 16" O.C.', '(1) LAYER 5/8" TYPE X GYP. BD. EACH SIDE', "1 HR RATED"]),
          type("B2", ['3 5/8" 25 GA. MTL. STUDS @ 24" O.C.', '(1) LAYER 5/8" GYP. BD. EACH SIDE']),
          type("C3", ['6" 20 GA. MTL. STUDS @ 16" O.C.', '(1) LAYER 1/2" GYP. BD. ONE SIDE', "1 HOUR"]),
        ],
        crops: [],
        reason: "seeded for the spec-book walk",
        confidence: "HIGH",
        model: "seed",
        promptVersion: "seed",
      },
    });

    // The job's own way to Specs.
    await page.goto(`/jobs/${jobId}`);
    const link = page.getByRole("link", { name: /^Specs/ });
    await expect(link.first()).toBeVisible({ timeout: 30_000 });
    await shot("job-specs-link");
    await link.first().click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/specs$`));
    await hydrated('[data-spec="upload"]');
    await shot("specs-empty");

    // Upload through the page's own button; the store is stubbed.
    await stubDocumentUpload(page);
    await page.locator('input[aria-label="Spec book PDF"]').setInputFiles({
      name: BOOK,
      mimeType: "application/pdf",
      buffer: Buffer.from(await buildSpecBookFixture()),
    });
    await expect(page.locator('[data-spec="error"], [data-spec="message"]').first()).toBeVisible({ timeout: 60_000 });
    note(`After the upload (stubbed store, so the server cannot fetch it): "${(await page.locator('[data-spec="error"]').innerText().catch(() => "")).trim()}"`);
    const book = await prisma.specBook.findFirstOrThrow({ where: { jobId } });
    note(`SpecBook recorded: ${book.fileName}, ${book.fileUrl.startsWith("https://e2estore.") ? "under the job's plan-set path" : book.fileUrl}.`);
    await prisma.specBook.update({ where: { id: book.id }, data: { fileUrl: `local:${BOOK}` } });

    // Find the sections, and every trade section read by the real model.
    await page.reload();
    await hydrated('[data-spec="find"]');
    const tFind = Date.now();
    await page.locator('[data-spec="find"]').click();
    const message = page.locator('[data-spec="message"]');
    await expect(message).toContainText(/Read \d+ of \d+/, { timeout: 600_000 });
    note(`Find + read took ${Math.round((Date.now() - tFind) / 1000)} s: "${(await message.innerText()).trim()}"`);
    await page.waitForTimeout(2000);
    await shot("specs-read");

    // ── NO MODEL CREDIT: a stand-in read, said so ──
    // With SPEC_STAND_IN=1 and every read turned away by the provider, two readings are
    // written from the fixture's own sentences so the wall-type check and the proposal
    // buttons can still be walked. The model read itself is then NOT verified by this run.
    if (/Read 0 of/.test(await message.innerText()) && process.env.SPEC_STAND_IN === "1") {
      const byNumber = async (n: string) => prisma.bidSpecSection.findFirstOrThrow({ where: { specBook: { jobId }, sectionNumber: n } });
      const facts = (f: Record<string, unknown>) => ({ products: [], studs: [], boards: [], fireRatings: [], ceilings: [], finishLevels: [], priceDrivers: [], reason: "STAND-IN, written by the walk", ...f });
      await prisma.specTradeReading.create({
        data: {
          bidSpecSectionId: (await byNumber("09 21 16")).id,
          pagesCharged: 0,
          model: "stand-in",
          promptVersion: "stand-in",
          readingReason: "stand-in",
          facts: facts({
            products: [{ manufacturer: "USG Corporation", product: null, quote: "A. USG Corporation; CertainTeed Gypsum; National Gypsum Company." }],
            boards: [
              { kind: "Type X", thickness: "5/8 inch", where: "at all fire-rated assemblies", quote: "A. Type X: ASTM C1396, 5/8 inch thick, at all fire-rated assemblies." },
              { kind: "abuse-resistant", thickness: "5/8 inch", where: "at corridors to 8 feet above floor", quote: "B. Abuse-resistant gypsum board: ASTM C1629 Level 2, 5/8 inch, at corridors to 8 feet above floor." },
            ],
            fireRatings: [{ rating: "1-hour", assembly: "UL Design U419", quote: "C. Fire-rated partitions: UL Design U419, 1-hour." }],
            finishLevels: [
              { level: 4, where: "all exposed surfaces unless otherwise indicated", quote: "A. Level 4 finish at all exposed surfaces unless otherwise indicated." },
              { level: 5, where: "main lobby and walls receiving gloss paint", quote: "B. Level 5 finish at the main lobby and at walls receiving gloss paint." },
            ],
            priceDrivers: [
              { label: "Level 5 finish at the main lobby", why: "A skim coat over the whole surface, beyond Level 4.", quote: "B. Level 5 finish at the main lobby and at walls receiving gloss paint." },
              { label: "Abuse-resistant board at corridors", why: "ASTM C1629 board costs more than standard board.", quote: "B. Abuse-resistant gypsum board: ASTM C1629 Level 2, 5/8 inch, at corridors to 8 feet above floor." },
            ],
          }),
        },
      });
      await prisma.specTradeReading.create({
        data: {
          bidSpecSectionId: (await byNumber("09 22 16")).id,
          pagesCharged: 0,
          model: "stand-in",
          promptVersion: "stand-in",
          readingReason: "stand-in",
          facts: facts({
            studs: [{ gauge: "20 gauge (33 mil) minimum", depth: "3-5/8 inch", spacing: "16 inches on center maximum", quote: "A. Steel studs: 20 gauge (33 mil) minimum, 3-5/8 inch unless otherwise indicated." }],
            priceDrivers: [{ label: "Slotted deflection track", why: "Deflection track at walls to structure costs more than standard track.", quote: "A. Slotted deflection track at all partitions extending to structure above: ClarkDietrich MaxTrak." }],
          }),
        },
      });
      note("STAND-IN: the model provider refused every read (out of credit), so two readings were written from the fixture's own sentences. The real model read is NOT verified by this run.");
      await page.reload();
      await hydrated('[data-spec="upload"]');
      await shot("specs-stand-in-read");
    }

    const sections = page.locator('[data-spec="section"]');
    await expect(sections).toHaveCount(4);
    for (const s of await sections.all()) {
      note(`${await s.getAttribute("data-number")} read=${await s.getAttribute("data-read")}: ${(await s.innerText()).replace(/\s+/g, " ").slice(0, 400)}`);
    }
    const walls = page.locator('[data-spec="wall-type"]');
    await expect(walls).toHaveCount(3);
    for (const w of await walls.all()) {
      note(`Wall ${await w.getAttribute("data-code")} (${await w.getAttribute("data-conflicts")} conflicts): ${(await w.innerText()).replace(/\s+/g, " ")}`);
    }
    await walls.first().scrollIntoViewIfNeeded();
    await shot("wall-types");

    // Specs printed on the drawings: the plan set's own notes, no model call.
    await page.locator('[data-spec="drawings"]').click();
    await expect(message).toContainText(/printed on \d+ sheet|No Division 09/, { timeout: 120_000 });
    note(`Drawings: "${(await message.innerText()).trim()}"`);
    await page.waitForTimeout(2000);
    const printed = page.locator('[data-spec="drawing-notes"] [data-spec="section"]');
    await expect(printed.first()).toBeVisible({ timeout: 30_000 });
    for (const s of await printed.all()) note(`Printed: ${(await s.innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
    await page.locator('[data-spec="drawing-notes"]').scrollIntoViewIfNeeded();
    await shot("drawing-notes");
    for (const w of await walls.all()) {
      note(`Wall after drawings ${await w.getAttribute("data-code")} (${await w.getAttribute("data-conflicts")} conflicts): ${(await w.innerText()).replace(/\s+/g, " ")}`);
    }

    // What the spec says, on the estimate's lines for wall type A1 (board line and stud line).
    const a1 = await prisma.wallType.upsert({
      where: { companyId_code: { companyId, code: "A1" } },
      create: { companyId, code: "A1", name: "A1 partition" },
      update: {},
    });
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "A1", type: "LINEAR", colorHex: "#888888", wallTypeId: a1.id } });
    await prisma.jobLineItem.createMany({
      data: [
        { jobId, description: 'A1 — 5/8" gypsum board', quantity: 1200, unit: "SF", takeoffItemId: item.id },
        { jobId, description: 'A1 — 3 5/8" metal studs', quantity: 300, unit: "LF", takeoffItemId: item.id },
      ],
    });
    await page.goto(`/jobs/${jobId}/estimate`);
    const estimateSays = page.locator('[data-estimate="spec-says"]');
    await expect(estimateSays.first()).toBeVisible({ timeout: 30_000 });
    for (const s of await estimateSays.all()) note(`Estimate: ${(await s.innerText()).trim()}`);
    await estimateSays.first().scrollIntoViewIfNeeded();
    await shot("estimate-spec-says");
    await page.goto(`/jobs/${jobId}/specs`);
    await hydrated('[data-spec="upload"]');

    // Price items onto the proposal.
    const drivers = page.locator('[data-spec="driver"]');
    const driverCount = await drivers.count();
    note(`${driverCount} price items listed.`);
    expect(driverCount).toBeGreaterThan(1);
    await drivers.nth(0).locator('[data-spec="add-inclusion"]').click();
    await expect(drivers.nth(0).locator('[data-spec="driver-note"]')).toContainText(/inclusions/, { timeout: 30_000 });
    await drivers.nth(1).locator('[data-spec="add-alternate"]').click();
    await expect(drivers.nth(1).locator('[data-spec="driver-note"]')).toContainText(/alternate/, { timeout: 30_000 });
    await drivers.nth(0).locator('[data-spec="add-inclusion"]').click();
    await expect(drivers.nth(0).locator('[data-spec="driver-note"]')).toContainText(/already on the proposal/, { timeout: 30_000 });
    await shot("drivers-added");
    const clauses = await prisma.jobProposalClause.findMany({ where: { jobId }, select: { kind: true, text: true } });
    note(`Proposal clauses: ${clauses.map((c) => `${c.kind}: ${c.text}`).join(" | ")}`);
    await page.goto(`/jobs/${jobId}/proposal`);
    await expect(page.getByText(clauses[0]!.text).first()).toBeVisible({ timeout: 30_000 });
    await shot("proposal");

    // ── ASK ABOUT THE SPEC, with the real model (ASK_REAL=1 and a key with credit) ──
    // The four questions, each answered from the reads above; every answer must name a source.
    if (process.env.ASK_REAL === "1") {
      const asks: [string, RegExp][] = [
        ["What board does the spec call for on Riverbend?", /Type X|09 21 16/i],
        ["Does Riverbend need Level 5 anywhere?", /Level 5/i],
        ["What stud gauge is specified on Riverbend?", /\b2[05]\s*(?:ga|gauge)/i],
        ["Any spec items not in my estimate on Riverbend?", /estimate/i],
      ];
      for (const [question, expected] of asks) {
        await page.goto("/ai");
        const box = page.getByRole("textbox", { name: "Ask about your jobs" });
        await box.fill(question);
        await page.getByRole("button", { name: "Ask", exact: true }).click();
        const answer = page.locator('[data-ask="answer"]').last();
        await expect(answer).toContainText(expected, { timeout: 120_000 });
        const said = (await answer.innerText()).replace(/\s+/g, " ").trim();
        note(`Ask "${question}": ${said.slice(0, 400)}`);
        expect(said, "every spec answer names its source").toMatch(/09 2\d \d\d|sheet [A-Z]/);
        await shot(`ask-${asks.findIndex((a) => a[0] === question) + 1}`);
      }
    } else {
      note("Ask step skipped: set ASK_REAL=1 with a model key that has credit to ask the four spec questions.");
    }

    const usage = await prisma.askUsage.findMany({ where: { companyId }, select: { feature: true, model: true, inputTokens: true, outputTokens: true } });
    note(`Model calls: ${usage.length} (${usage.map((u) => `${u.feature} ${u.model} ${u.inputTokens}/${u.outputTokens}`).join("; ")}).`);
    note(`Total ${Math.round((Date.now() - t0) / 1000)} s.`);
    writeFileSync(path.join(OUT, "notes.md"), notes.map((n) => `- ${n}`).join("\n") + "\n");
  });
});
