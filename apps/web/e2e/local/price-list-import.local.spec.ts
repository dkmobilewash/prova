import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
 * ── A SUPPLIER'S PRICE LIST PRICES BAKER'S ESTIMATE: N UNPRICED MATERIALS TO 0, NO COSTS TYPED ──
 *
 * The auto-estimate walk's company and Baker types, but with an EMPTY price book: every material
 * starts unpriced. Then the Price book's "Import a supplier price list" takes the invented supplier
 * quote (e2e/fixtures/supplier-price-list.csv), the four uncertain materials get their one-click
 * picks, and the estimate's "Price these N materials" list is gone, each line saying which list
 * and date its price came from.
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
const EMAIL = throwawayEmail("pricelist");
// Pass or fail: the dev Clerk instance caps at 100 users (e2e/lib/throwawayUsers.mjs).
test.afterAll(async () => { await deleteThrowaway(EMAIL); });
const FIXTURE = path.join(__dirname, "..", "fixtures", "supplier-price-list.csv");
// "Send PO to supplier" is pressed only against a TEST INBOX: the walk's own server sends every
// email there (a local capture of the provider's endpoint), and the supplier's address is the
// invented list's reserved .example one. Without WALK_INBOX_DIR the walk stops at the preview.
const INBOX = process.env.WALK_INBOX_DIR ?? "";
const SUPPLIER_EMAIL = "orders@northgate-supply.example";
const inboxMessages = () => (INBOX === "" ? [] : readdirSync(INBOX).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(INBOX, f), "utf8")) as { to: string[]; subject: string; attachments: string[] }));
let page: Page;
let shotN = 0;
const notes: string[] = [];
const note = (line: string) => {
  notes.push(line);
  console.log(`[price-list] ${line}`);
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

test.describe("a supplier price list prices Baker's estimate", () => {
  test.skip(OUT === "" || SET === "" || CACHE === "", "WALK_OUT, WALK_SET and LEGEND_CACHE name the pictures, the set and the cached legend read");
  test.setTimeout(900_000);

  test("Baker types → N unpriced → import the supplier's list → 0", async ({ browser }) => {
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
    // ── 3. BEFORE: EVERY MATERIAL UNPRICED ──
    expect(before.every((l) => l.unitPrice === null)).toBe(true);
    const heading = (await page.locator('[data-estimate="price-these"] h2').innerText()).trim();
    note(`Before the import: "${heading}"`);
    const unpricedBefore = Number(heading.match(/(\d+)/)![1]);
    expect(unpricedBefore).toBeGreaterThanOrEqual(10);

    // ── 4. THE PRICE BOOK: IMPORT THE SUPPLIER'S LIST ──
    await page.goto("/catalog");
    await page.locator('[data-catalog="price-list"] button').first().click();
    await hydrated('[data-price-list="file"]');
    await page.locator('input[name="vendorName"]').fill("Northgate Building Supply");
    await page.locator('[data-price-list="file"]').setInputFiles(FIXTURE);
    await expect(page.locator('[data-price-list="summary"]')).toBeVisible({ timeout: 30_000 });
    // The supplier's email for orders, read off their list, before anyone types it.
    await expect(page.locator('[data-price-list="contact"]')).toHaveValue(SUPPLIER_EMAIL);
    note(`Preview: ${(await page.locator('[data-price-list="summary"]').innerText()).replace(/\s+/g, " ")}`);
    await shot("price-list-preview");
    const pick = async (selector: string, re: RegExp) => {
      const select = page.locator(`${selector} select`);
      const value = await select.evaluate((el, src) => [...(el as HTMLSelectElement).options].find((o) => new RegExp(src).test(o.text))?.value ?? "", re.source);
      expect(value, `${selector} has a row matching ${re}`).not.toBe("");
      await select.selectOption(value);
      note(`Picked for ${selector}: ${(await select.locator("option:checked").innerText()).slice(0, 120)}`);
    };
    await pick('[data-price-list="choose"][data-price-list-key="stud|metal|6|25"]', /14'/); // S6A runs 14 ft
    await pick('[data-price-list="choose"][data-price-list-key="screws"]', /1-1\/4/);
    await pick('[data-price-list="need"][data-price-list-need="6in metal stud"]', /Steel Stud 25 GA 6" x 10'/);
    await pick('[data-price-list="need"][data-price-list-need="6in track, top and bottom"]', /Track 25 GA 6"/);
    await pick('[data-price-list="need"][data-price-list-need="cavity insulation"]', /R-19/);
    await shot("price-list-picked");
    await page.locator('[data-price-list="import-button"]').click();
    await expect(page.locator('[data-price-list="done"]')).toBeVisible({ timeout: 60_000 });
    note(`Import: ${(await page.locator('[data-price-list="done"]').innerText()).replace(/\s+/g, " ")}`);
    await shot("price-list-imported");

    // ── 5. AFTER: NOTHING LEFT TO PRICE, EACH PRICE SAYING WHERE IT CAME FROM ──
    await page.goto(`/jobs/${jobId}/estimate`);
    await hydrated('[data-estimate="price-source"]');
    await expect(page.locator('[data-estimate="price-these"]')).toHaveCount(0);
    const after = await estimateLines(jobId);
    for (const l of after) note(`after: ${l.description} — ${l.quantity} ${l.unit ?? ""} @ ${l.unitPrice} (cost ${l.budgetedUnitCost})`);
    expect(after.every((l) => l.unitPrice !== null && l.priceBasis === "COMPANY_CATALOG")).toBe(true);
    const sources = await page.locator('[data-estimate="price-source"]').allInnerTexts();
    note(`Source shown on ${sources.length} of ${after.length} lines, e.g. "${sources[0]}"`);
    expect(sources.length).toBe(after.length);
    expect(sources.every((s) => /Northgate Building Supply price list \d+\/\d+\/\d{4}/.test(s))).toBe(true);
    note(`Unpriced materials: ${unpricedBefore} → 0`);
    await shot("estimate-after-import");

    // ── 6. ORDER MATERIALS: THE CONTRACTED ESTIMATE AS A DRAFT PO, IN WHOLE PACKS ──
    // Buyout starts at the contract, so the job is contracted (the walk does not
    // re-walk the executed subcontract, which journey.spec.ts covers).
    await prisma.job.update({ where: { id: jobId }, data: { status: "CONTRACTED" } });
    await page.goto(`/jobs/${jobId}/estimate`);
    await hydrated('[data-order="go"]');
    await page.locator('[data-order="supplier"]').selectOption({ label: "Northgate Building Supply" });
    await shot("order-materials");
    await page.locator('[data-order="go"]').click();
    await expect(page.locator('[data-order="done"]')).toBeVisible({ timeout: 60_000 });
    note(`Order materials: ${(await page.locator('[data-order="done"]').innerText()).replace(/\s+/g, " ")}`);
    await expect(page.locator('[data-order="po"]')).toHaveCount(1);
    await expect(page.locator('[data-order="po"]').first()).toContainText(/^PO 1: \d+ lines?, \$[\d,.]+, draft$/);
    await shot("order-materials-done");

    // ── SEND PO TO SUPPLIER: a preview first, nothing sent until the press, then one email ──
    expect(inboxMessages()).toHaveLength(0);
    await page.locator('[data-po-send="open"]').click();
    const preview = page.locator('[data-po-send="preview"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Preview: nothing has been sent yet.");
    await expect(page.locator('[data-po-send="to"]')).toHaveValue(SUPPLIER_EMAIL);
    note(`Send preview: ${(await page.locator('[data-po-send="summary"]').innerText()).replace(/\s+/g, " ")}`);
    await shot("send-po-preview");
    const [pdfTab] = await Promise.all([page.context().waitForEvent("page"), page.locator('[data-po-send="pdf"]').click()]);
    await pdfTab.close();
    expect(inboxMessages(), "opening the preview and its PDF sent nothing").toHaveLength(0);
    expect((await prisma.outboundMessage.count({ where: { jobId } })), "and logged nothing").toBe(0);
    if (INBOX === "") {
      note("No WALK_INBOX_DIR: stopped at the preview; nothing was sent.");
    } else {
      expect(SUPPLIER_EMAIL.endsWith(".example")).toBe(true);
      await page.locator('[data-po-send="send"]').click();
      await expect(page.locator('[data-po-send="sent"]')).toBeVisible({ timeout: 60_000 });
      await shot("send-po-sent");
      const got = inboxMessages();
      expect(got).toHaveLength(1);
      expect(got[0].to).toEqual([`Northgate Building Supply <${SUPPLIER_EMAIL}>`]);
      expect(got[0].attachments).toHaveLength(1);
      expect(readFileSync(path.join(INBOX, got[0].attachments[0])).subarray(0, 5).toString()).toBe("%PDF-");
      note(`Test inbox: "${got[0].subject}" to ${got[0].to[0]} with ${got[0].attachments[0].replace(/^inbox_\d+_\d+-0-/, "")}`);
      const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { jobId }, select: { id: true, status: true, issuedOn: true } });
      expect(po.status).toBe("ISSUED");
      const logged = await prisma.outboundMessage.findFirstOrThrow({ where: { jobId, relatedType: "PURCHASE_ORDER", relatedId: po.id }, include: { sentDocument: { select: { fileName: true } } } });
      expect(logged.toAddress).toBe(SUPPLIER_EMAIL);
      note(`Logged on the job: to ${logged.toAddress}, kept ${logged.sentDocument?.fileName}; PO issued ${po.issuedOn?.toISOString().slice(0, 10)}`);
    }
    const poLines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrder: { jobId } }, include: { lineItem: { select: { description: true, quantity: true, unit: true } } } });
    for (const l of poLines) note(`PO line: ${l.lineItem.description} (${l.lineItem.quantity} ${l.lineItem.unit}) → ${l.quantity} ${l.unit} "${l.description}" @ ${l.unitPrice}`);
    // Every material line is ordered, and every order is whole packs.
    expect(poLines.length).toBe(after.filter((l) => l.costCategory === "MATERIAL").length);
    expect(poLines.every((l) => Number(l.quantity) === Math.ceil(Number(l.quantity)))).toBe(true);
    expect(poLines.some((l) => l.unit === "PAIL") && poLines.some((l) => l.unit === "BX")).toBe(true);
    await page.locator('[data-order="open-buyout"]').click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/buyout`));
    if (INBOX === "") {
      await expect(page.getByText(/PO 1 · Northgate Building Supply · draft/)).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText(/PO 1 · Northgate Building Supply · issued/)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(new RegExp(`Emailed .* to ${SUPPLIER_EMAIL.replace(/\./g, "\\.")}`))).toBeVisible();
    }
    await shot("buyout-after");

    writeFileSync(path.join(OUT, "notes.md"), notes.map((n) => `- ${n}`).join("\n") + "\n");
  });
});
