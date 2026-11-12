import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { deleteThrowaway, throwawayEmail } from "../lib/throwawayUsers.mjs";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { prisma } from "@prova/db";
import { HealthMonitor } from "../lib/health";
import { legendProposalFrom } from "../../lib/takeoff/legendProposalBuild";
import { storedLegendTypes } from "../../lib/takeoff/legendProposal";

/**
 * ── BAKER'S LEGEND TYPES BECOME A PRICED MATERIAL LIST WITHOUT TYPING ──
 *
 * A brand-new company with its markup set and ONE price in its price book (5/8in Type X board per
 * sheet). Baker EOC's legend read is put in place from the cached read (LEGEND_CACHE — the same reads
 * a model call would write, so this walk spends nothing), then everything else is clicked: S6B, C8B and
 * S6A added to the library from the legend page; runs added on the estimate's wall schedule; the
 * "Price these N materials" list; one cost typed; a run's height changed; the quantity standards on
 * Wall types. No price anywhere comes from anything but the company.
 *
 * LOCAL ONLY: real drawings. Run against your own `next start` with ALLOW_LOCAL_PLANS=1, HOSTNAME=
 * localhost and TAKEOFF_LOCAL_PLAN_DIR = WALK_PLAN_DIR, on a `_test` database, E2E_PORT naming it:
 *   WALK_PLAN_DIR=… WALK_SET=2025.07.08_Baker_EOC_BID.pdf LEGEND_CACHE=… WALK_OUT=… npx playwright test -c e2e/playwright.real.config.ts auto-estimate
 */
const OUT = process.env.WALK_OUT ?? "";
const SET = process.env.WALK_SET ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const EMAIL = throwawayEmail("autoest");
// Pass or fail: the dev Clerk instance caps at 100 users (e2e/lib/throwawayUsers.mjs).
test.afterAll(async () => { await deleteThrowaway(EMAIL); });
let page: Page;
let shotN = 0;
const notes: string[] = [];
const note = (line: string) => {
  notes.push(line);
  console.log(`[auto-estimate] ${line}`);
};
async function shot(name: string): Promise<void> {
  shotN += 1;
  await page.screenshot({ path: path.join(OUT, `${String(shotN).padStart(2, "0")}-${name}.png`), fullPage: true }).catch(() => {});
}
const seen = (target: Locator, timeout = 5000) => target.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
async function hydrated(selector: string): Promise<void> {
  await expect.poll(() => page.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))).catch(() => false), { timeout: 60_000 }).toBe(true);
}
async function freeTestPhone(): Promise<string> {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY ?? "" });
  for (const digits of Array.from({ length: 99 }, (_, i) => `20155501${String(i + 1).padStart(2, "0")}`).sort(() => Math.random() - 0.5)) {
    if ((await clerk.users.getUserList({ phoneNumber: [`+1${digits}`] })).totalCount === 0) return digits;
  }
  throw new Error("every Clerk test number is taken; delete some walk users");
}
const estimateLines = (jobId: string) => prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, orderBy: { createdAt: "asc" } });

test.describe("Baker's legend types to a priced estimate", () => {
  test.skip(OUT === "" || SET === "" || CACHE === "", "WALK_OUT, WALK_SET and LEGEND_CACHE name the pictures, the set and the cached legend read");
  test.setTimeout(900_000);

  test("legend → library → wall schedule → price these → height change", async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    new HealthMonitor(page);

    // ── A FRESH COMPANY ──
    await setupClerkTestingToken({ page });
    await page.goto("/sign-up");
    await hydrated('input[name="emailAddress"]');
    await page.locator('input[name="emailAddress"]').fill(EMAIL);
    const password = page.locator('input[name="password"]');
    if (await seen(password, 1000)) await password.fill(`AutoEst-${Date.now()}-pw!`);
    for (const [name, value] of [["firstName", "Dana"], ["lastName", "Walker"], ["username", `autoest${Date.now()}`]] as const) {
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

    // ── WHAT A MODEL CALL AND A PERSON'S SETTINGS WOULD HAVE LEFT: markup, one price, a job, Baker's legend read ──
    const user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL }, select: { companyId: true } });
    const companyId = user.companyId;
    await prisma.companyBidDefaults.upsert({
      where: { companyId },
      create: { companyId, materialMarkupPercent: "10", laborMarkupPercent: "10", overheadPercent: "5", profitPercent: "5" },
      update: { materialMarkupPercent: "10", laborMarkupPercent: "10", overheadPercent: "5", profitPercent: "5" },
    });
    const pricedBefore = await prisma.lineItemCatalogEntry.count({ where: { companyId, OR: [{ defaultUnitPrice: { not: null } }, { defaultBudgetedUnitCost: { not: null } }] } });
    note(`Price book entries with a price before the walk added one: ${pricedBefore}`);
    await prisma.lineItemCatalogEntry.create({ data: { companyId, description: '5/8" Type X Gypsum Board 4x8', unit: "sheet", defaultBudgetedUnitCost: "14.00", defaultUnitPrice: "17.16", costCategory: "MATERIAL" } });
    const contact = await prisma.contact.create({ data: { companyId, name: "Walker Builders" } });
    const jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Baker EOC", status: "ESTIMATE" } })).id;
    const planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: `local:${SET}`, fileName: SET } })).id;
    const run = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 120 } });
    const cached = (f: string) => {
      const j = JSON.parse(readFileSync(path.join(CACHE, f), "utf8"));
      return j.read ?? j;
    };
    const text = cached("2025_07_08_Baker_EOC_BID_pdf-p25-wall-legend.3.json");
    const sight = cached("2025_07_08_Baker_EOC_BID_pdf-p25-wall-legend-sight.6.json");
    const built = legendProposalFrom({ pageNumber: 25, sheetTitle: "A601", model: "cached", read: text, crops: [] });
    await prisma.planLegendProposal.create({ data: { ingestJobId: run.id, planId, pageNumber: 25, ...built, merged: JSON.parse(JSON.stringify(storedLegendTypes(text, sight, "A601 (page 25)"))), sightRead: sight } });

    // ── 1. THE LEGEND PAGE: ADD THREE TYPES ──
    await page.goto(`/jobs/${jobId}/takeoff/legend`);
    await hydrated('[data-legend="add"]');
    await shot("legend-before-add");
    for (const typeCode of ["S6B", "C8B", "S6A"]) {
      const row = page.locator(`[data-legend="type"][data-legend-code="${typeCode}"]`);
      await row.locator('[data-legend="add"]').click();
      await expect(row.locator('[data-legend="message"], [data-legend="in-library"]').first()).toBeVisible({ timeout: 30_000 });
      note(`${typeCode}: ${(await row.locator('[data-legend="message"]').first().innerText().catch(() => "")).replace(/\s+/g, " ")}`);
    }
    const types = await prisma.wallType.findMany({ where: { companyId, code: { in: ["S6B", "C8B", "S6A"] } }, include: { components: { orderBy: { sortOrder: "asc" } } } });
    for (const t of types) note(`${t.code} parts: ${t.components.map((c) => `${c.description} [${c.unit}${c.catalogEntryId ? ", priced from your book" : ""}]`).join(" · ")}`);
    expect(types.every((t) => t.components.some((c) => /screws/.test(c.description)))).toBe(true);

    // C8B is board over concrete on one face: the legend's own flag says so, and a person sets sides.
    await prisma.wallType.updateMany({ where: { companyId, code: "C8B" }, data: { sides: 1 } });

    // ── 2. THE ESTIMATE'S WALL SCHEDULE: THREE RUNS ──
    await page.goto(`/jobs/${jobId}/estimate`);
    await hydrated('input[name="lengthFt"]');
    // The schedule is a closed disclosure until somebody opens it.
    const openSchedule = async () => {
      const addRun = page.getByRole("button", { name: "Add run" });
      // A refresh after a save can re-render the disclosure closed, so open it until the button shows.
      await expect(async () => {
        if (!(await addRun.isVisible())) await page.getByRole("heading", { name: "Wall schedule" }).click();
        await expect(addRun).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30_000 });
    };
    await openSchedule();
    for (const [typeCode, lf, h] of [["S6B", "120", "10"], ["C8B", "80", "12"], ["S6A", "60", "14"]] as const) {
      await openSchedule();
      const form = page.locator("form").filter({ has: page.locator('input[name="lengthFt"][placeholder], input[name="lengthFt"]') }).filter({ hasText: "Add run" }).first();
      const id = types.find((t) => t.code === typeCode)!.id;
      await form.locator('select[name="wallTypeId"]').selectOption(id);
      await form.locator('input[name="label"]').fill(`${typeCode} walls`);
      await form.locator('input[name="lengthFt"]').fill(lf);
      await form.locator('input[name="heightFt"]').fill(h);
      await form.getByRole("button", { name: "Add run" }).click();
      await expect.poll(async () => (await prisma.wallRun.count({ where: { jobId, wallTypeId: id } })), { timeout: 30_000 }).toBe(1);
    }
    await page.reload();
    await hydrated('[data-estimate="price-these"] input');
    await shot("estimate-after-runs");
    const before = await estimateLines(jobId);
    for (const l of before) note(`line: ${l.description} — ${l.quantity} ${l.unit ?? ""} @ ${l.unitPrice ?? "unpriced"}`);
    // The book prices 5/8in TYPE X board per sheet and nothing else: those lines take it, and every
    // other line — C8B's plain board included — waits for a person's cost.
    const inBook = (d: string) => /type X gypsum board/.test(d);
    expect(before.filter((l) => inBook(l.description)).length).toBe(2);
    expect(before.filter((l) => inBook(l.description)).every((l) => l.unitPrice?.toString() === "17.16" && l.priceBasis === "COMPANY_CATALOG")).toBe(true);
    expect(before.filter((l) => !inBook(l.description)).every((l) => l.unitPrice === null)).toBe(true);
    // The hand calculation (lib/estimating/autoEstimate.eval.ts), line by line.
    const hand: [RegExp, number][] = [
      [/^S6B — .*metal stud/, 96], [/^S6B — .*track/, 252], [/^S6B — .*gypsum board/, 83], [/^S6B — .*screws/, 2.52], [/^S6B — joint tape/, 2], [/^S6B — joint compound/, 353],
      [/^C8B — .*gypsum board/, 33], [/^C8B — .*insulation/, 1008], [/^C8B — .*screws/, 1.01], [/^C8B — joint tape/, 1], [/^C8B — joint compound/, 142],
      [/^S6A — .*metal stud/, 33], [/^S6A — .*track, bottom/, 63], [/^S6A — .*deflection track/, 63], [/^S6A — .*gypsum board/, 116], [/^S6A — .*screws/, 3.53], [/^S6A — joint tape/, 2], [/^S6A — joint compound/, 247],
    ];
    for (const [re, want] of hand) {
      const got = Number(before.find((l) => re.test(l.description))?.quantity ?? NaN);
      note(`hand ${re.source}: ${got} vs ${want}`);
      expect(Math.abs(got - want) / want, re.source).toBeLessThanOrEqual(0.02);
    }

    // ── 3. PRICE THESE N MATERIALS ──
    const heading = (await page.locator('[data-estimate="price-these"] h2').innerText()).trim();
    note(`List heading: "${heading}"`);
    const rows = page.locator('[data-estimate="price-these-row"]');
    note(`Rows: ${(await rows.allInnerTexts()).map((t) => t.split("\n")[0]).join(" | ")}`);
    const screwRow = rows.filter({ hasText: "screws" });
    await screwRow.locator('[data-estimate="price-these-cost"]').fill("32");
    await screwRow.getByRole("button", { name: "Save cost" }).click();
    await expect.poll(async () => (await estimateLines(jobId)).filter((l) => /screws/.test(l.description)).every((l) => l.unitPrice !== null), { timeout: 30_000 }).toBe(true);
    await page.reload();
    await hydrated('[data-estimate="price-these"] input');
    await shot("estimate-screws-priced");
    note(`After one cost: "${(await page.locator('[data-estimate="price-these"] h2').innerText()).trim()}"`);

    // ── 4. A HEIGHT CHANGE MOVES THE MATERIALS ──
    const s6bBoard = async () => Number((await estimateLines(jobId)).find((l) => /^S6B — .*gypsum board/.test(l.description))?.quantity ?? 0);
    const was = await s6bBoard();
    await openSchedule();
    const editForm = page.locator("form").filter({ has: page.locator('input[name="label"][value="S6B walls"]') }).first();
    await expect(editForm).toBeVisible();
    await editForm.locator('input[name="heightFt"]').fill("12");
    await editForm.getByRole("button", { name: "Save" }).click();
    await expect.poll(s6bBoard, { timeout: 30_000 }).toBeGreaterThan(was);
    note(`S6B board: ${was} sheets at 10 ft → ${await s6bBoard()} at 12 ft`);
    await shot("estimate-height-12");

    // ── 5. THE QUANTITY STANDARDS ──
    await page.goto("/wall-types");
    await page.locator('[data-wall-types="standards"] button').first().click();
    await hydrated('input[name="screwsPerSqFt"]');
    await shot("wall-types-standards");

    writeFileSync(path.join(OUT, "notes.md"), notes.map((n) => `- ${n}`).join("\n") + "\n");
  });
});
