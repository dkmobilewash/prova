import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { prisma } from "@prova/db";
import { HealthMonitor } from "../lib/health";
import { legendProposalFrom } from "../../lib/takeoff/legendProposalBuild";
import { storedLegendTypes } from "../../lib/takeoff/legendProposal";

/**
 * ── BAKER'S LABOR FROM THE COMPANY'S OWN PRODUCTION RATES ──
 *
 * The auto-estimate walk's company, types and runs; then the estimate asks "Set your production
 * rates" (none are seeded), the rates are typed on Wall types, and the estimate carries one labor
 * line per task, wall type and height band, matching the hand calculation in
 * lib/estimating/productionRates.test.ts. A run's height change moves its labor into another band.
 *
 * (What follows is the auto-estimate walk's own description, kept for the steps this reuses.)
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
const EMAIL = `labor-${Date.now()}+clerk_test@example.com`;
let page: Page;
let shotN = 0;
const notes: string[] = [];
const note = (line: string) => {
  notes.push(line);
  console.log(`[labor] ${line}`);
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

test.describe("Baker's labor from the company's production rates", () => {
  test.skip(OUT === "" || SET === "" || CACHE === "", "WALK_OUT, WALK_SET and LEGEND_CACHE name the pictures, the set and the cached legend read");
  test.setTimeout(900_000);

  test("Baker runs → set your production rates → labor lines → height band", async ({ browser }) => {
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
    // ── 3. NO RATES SEEDED: NO LABOR, AND THE ESTIMATE ASKS ──
    expect(before.filter((l) => l.costCategory === "LABOR")).toEqual([]);
    const prompt = page.locator('[data-estimate="set-production-rates"]');
    await expect(prompt).toBeVisible();
    note(`Prompt: ${(await prompt.innerText()).replace(/\s+/g, " ")}`);
    await shot("estimate-set-production-rates");

    // ── 4. THE RATES, TYPED ON WALL TYPES (the company's own; every field started empty) ──
    await prompt.getByRole("link", { name: /Set your production rates/ }).click();
    await page.waitForURL(/\/wall-types/);
    await hydrated('[data-rates="framingLfPerHr"]');
    const empty = await page.locator('[data-wall-types="production-rates"] input[data-rates]').evaluateAll((els) => els.every((e) => (e as HTMLInputElement).value === ""));
    note(`Every rate field empty before typing: ${empty}`);
    expect(empty).toBe(true);
    const typed: Record<string, string> = { framingLfPerHr: "20", boardRegular: "60", boardTypeX: "50", boardSpecial: "40", finishLevel3: "55", finishLevel4: "45", finishLevel5: "30", ceilingSfPerHr: "40", over10Multiplier: "1.15", over14Multiplier: "1.3", crewRatePerHr: "62" };
    for (const [name, value] of Object.entries(typed)) await page.locator(`[data-rates="${name}"]`).fill(value);
    await shot("wall-types-rates-typed");
    await page.getByRole("button", { name: "Save rates" }).click();
    await expect.poll(async () => (await estimateLines(jobId)).filter((l) => l.costCategory === "LABOR").length, { timeout: 30_000 }).toBe(8);

    // ── 5. THE LABOR LINES AGAINST THE HAND CALCULATION ──
    await page.goto(`/jobs/${jobId}/estimate`);
    await hydrated('[data-estimate="price-these"] input');
    await expect(page.locator('[data-estimate="set-production-rates"]')).toHaveCount(0);
    const labor = (await estimateLines(jobId)).filter((l) => l.costCategory === "LABOR");
    for (const l of labor) note(`labor: ${l.description} @ $${l.budgetedUnitCost}/h = $${(Number(l.quantity) * Number(l.budgetedUnitCost)).toFixed(2)}`);
    const hand: [RegExp, number][] = [
      [/^Labor — S6B — framing, studs and track$/, 6], [/^Labor — S6B — hang type X board$/, 48], [/^Labor — S6B — tape and finish, Level 4$/, 53.33],
      [/^Labor — C8B — hang regular board, over 10 ft$/, 18.4], [/^Labor — C8B — tape and finish, Level 4, over 10 ft$/, 24.53],
      [/^Labor — S6A — framing, studs and track, over 10 ft$/, 3.45], [/^Labor — S6A — hang type X board, 2 layers, over 10 ft$/, 77.28], [/^Labor — S6A — tape and finish, Level 4, over 10 ft$/, 42.93],
    ];
    for (const [re, want] of hand) {
      const got = Number(labor.find((l) => re.test(l.description))?.laborHours ?? NaN);
      note(`hand ${re.source}: ${got} vs ${want}`);
      expect(got, re.source).toBe(want);
    }
    const cost = labor.reduce((n, l) => n + Number(l.quantity) * Number(l.budgetedUnitCost), 0);
    note(`Labor: ${labor.reduce((n, l) => n + Number(l.laborHours), 0).toFixed(2)} h, $${cost.toFixed(2)} cost`);
    expect(Math.round(cost * 100) / 100).toBe(16983.04);
    await page.getByText("Labor — S6B — framing, studs and track", { exact: true }).first().scrollIntoViewIfNeeded();
    await shot("estimate-labor-lines");

    // ── 6. A HEIGHT CHANGE MOVES THE LABOR INTO ANOTHER BAND ──
    await openSchedule();
    const editForm = page.locator("form").filter({ has: page.locator('input[name="label"][value="S6B walls"]') }).first();
    await editForm.locator('input[name="heightFt"]').fill("12");
    await editForm.getByRole("button", { name: "Save" }).click();
    const s6bBoard = async () => Number((await estimateLines(jobId)).find((l) => /^Labor — S6B — hang type X board, over 10 ft$/.test(l.description))?.laborHours ?? 0);
    await expect.poll(s6bBoard, { timeout: 30_000 }).toBe(66.24);
    note(`S6B at 12 ft: hang board 48 h → ${await s6bBoard()} h (2,880 sf / 50 × 1.15)`);
    await page.reload();
    await hydrated('[data-estimate="price-these"] input');
    await page.getByText("Labor — S6B — hang type X board, over 10 ft", { exact: true }).first().scrollIntoViewIfNeeded();
    await shot("estimate-labor-height-12");

    // ── 7. THE BID CHECK ON THE SEND STEP (bidCheck.ts) ──
    // Every check's state, words and fix link; then the floor-area check's own link, the building's
    // area typed (BID_CHECK_GROSS_SF, read off the set's cover sheet by whoever runs the walk), and back.
    const readBidCheck = async (when: string) => {
      await page.goto(`/jobs/${jobId}#contract-signature`);
      const panel = page.locator('[data-bid-check=""]');
      await expect(panel).toBeVisible({ timeout: 30_000 });
      const summary = (await panel.locator('[data-bid-check="summary"]').innerText()).trim();
      expect(summary).toMatch(/^(\d+ checks? open|All 7 checks clear)$/);
      note(`Bid check ${when}: ${summary} · beside Send: "${(await page.locator('[data-bid-check="beside-send"]').innerText().catch(() => "")).trim()}"`);
      const items = await panel.locator("[data-bid-check-item]").all();
      expect(items).toHaveLength(7);
      for (const item of items) {
        const fix = item.locator("[data-bid-check-fix]");
        const href = (await fix.count()) > 0 ? ` → ${await fix.getAttribute("href")}` : "";
        note(`  ${await item.getAttribute("data-bid-check-item")} ${(await item.getAttribute("data-state"))!.toUpperCase()}: ${(await item.innerText()).replace(/\s+/g, " ").slice(0, 400)}${href}`);
      }
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, "0")}-bid-check-${when}.png`) });
      return summary;
    };
    await readBidCheck("on-arrival");
    const gross = process.env.BID_CHECK_GROSS_SF ?? "";
    const areaFix = page.locator('[data-bid-check-fix="quantities"]');
    if (gross !== "" && /floor area/.test(await areaFix.innerText().catch(() => ""))) {
      await areaFix.click();
      await hydrated("#job-details button");
      const details = page.locator("#job-details");
      await details.getByRole("button", { name: "Edit details" }).click();
      await details.locator('input[name="grossAreaSqFt"]').fill(gross);
      await details.getByRole("button", { name: /^Save/ }).first().click();
      await expect.poll(async () => (await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { grossAreaSqFt: true } })).grossAreaSqFt?.toString() ?? "", { timeout: 30_000 }).toBe(String(Number(gross)));
      note(`Typed the building's floor area through the check's own link: ${gross} SF`);
      await readBidCheck("with-floor-area");
    }

    writeFileSync(path.join(OUT, "notes.md"), notes.map((n) => `- ${n}`).join("\n") + "\n");
  });
});
