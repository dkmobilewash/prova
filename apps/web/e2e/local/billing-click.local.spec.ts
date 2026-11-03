import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { test, expect, type Download, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { FIXTURE_JOB, samplePdf, seedBillingClickFixture } from "../../scripts/billingClickFixture";

/**
 * THE BILLING CLICK LIST, AS A SPEC. LOCAL ONLY: `pnpm test:e2e -- --billing-click`.
 *
 * Each test is one step of "Billing click test" in the coordination folder's
 * sheets-to-label.md, named by its number, with that step's expected figures and
 * sentences. The fixture is the same `seedBillingClickFixture` the click list runs,
 * seeded once into the signed-in MAIN persona's company in this run's throwaway
 * database.
 *
 * The steps change state in the click list's order (Part 2 bills the retainage,
 * Part 5 drafts POs that Part 6 issues), so the file runs in order on one page.
 * It is NOT serial mode: a failing step is reported and the next one still runs,
 * which is what a click list is for. A step after a failed one may fail for that
 * reason; the report reads the first failure in a chain.
 *
 * Where the click list says "a person checks the file", this reads the file:
 * CSV and Excel by parsing, PDFs by page count, orientation and their drawn text.
 */

let page: Page;
let monitor: HealthMonitor;
let jobId = "";
let companyName = "";
const files = mkdtempSync(join(tmpdir(), "billing-click-"));

/** What a person reads: `innerText` keeps the gaps between elements that
 * `textContent` glues together ("C StreamJobs"), with whitespace collapsed. */
const shown = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
/** Case-insensitive, because labels are uppercased by CSS and innerText reports
 * what is drawn. */
const matches = (body: string, text: string | RegExp) =>
  typeof text === "string" ? body.toLowerCase().includes(text.toLowerCase()) : new RegExp(text.source, `${text.flags.replace("i", "")}i`).test(body);
const says = (text: string | RegExp) => expect.poll(async () => matches(await shown(), text), { message: `the page should say ${text}` }).toBe(true);
const saysNot = (text: string | RegExp) => expect.poll(async () => matches(await shown(), text), { message: `the page should NOT say ${text}` }).toBe(false);
/** A collapsed section or row, opened by its visible title. */
async function expand(title: string | RegExp) {
  const opener = page.getByText(title).first();
  await opener.click();
}

async function open(path: string, what: string) {
  await page.goto(path);
  await expectHealthy(page, what, { monitor });
}

async function download(press: () => Promise<unknown>): Promise<{ name: string; bytes: Buffer }> {
  const [file] = await Promise.all([page.waitForEvent("download") as Promise<Download>, press()]);
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

/** The text a pdf-lib document drew, from every content stream. */
function pdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = Buffer.from(match[1], "latin1");
    try {
      body = inflateSync(body);
    } catch {
      // not compressed
    }
    const content = body.toString("latin1");
    for (const shown of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      text += (shown[1] ? Buffer.from(shown[1], "hex").toString("latin1") : shown[2]) + "\n";
    }
  }
  return text;
}

async function pdfPages(bytes: Buffer) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight() }));
}

const lastDayOfThisMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
};

test.describe.configure({ timeout: 90_000 });
test.use({ actionTimeout: 10_000 });

test.beforeAll(async ({ browser }) => {
  const user = await prisma.user.findFirstOrThrow({ where: { email: PERSONAS.main.email }, include: { company: true } });
  companyName = user.company.name;
  const existing = await prisma.job.findFirst({ where: { companyId: user.companyId, name: FIXTURE_JOB }, select: { id: true } });
  jobId = existing?.id ?? (await seedBillingClickFixture(prisma, user.companyId)).jobId;
  for (const [name, label, pages] of [["click-test-board.pdf", "Board data", 3], ["click-test-track.pdf", "Track data", 2]] as const) {
    writeFileSync(join(files, name), await samplePdf(label, pages));
  }
  page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.main.email);
});

const billing = () => open(`/jobs/${jobId}/billing`, "billing tab");
async function application(n: number) {
  await billing();
  const link = page.getByRole("link", { name: new RegExp(`^Application #${n}$`) }).first();
  if (!(await link.isVisible())) await expand(new RegExp(`^Pay app #${n}$`));
  await link.click();
  await page.waitForURL(/\/pay-applications\/[^/]+$/);
  await expectHealthy(page, `application #${n}`, { monitor });
}
const coCard = (n: number) => page.locator("li").filter({ hasText: new RegExp(`^CO #${n}:`) }).first();
const estimate = () => open(`/jobs/${jobId}/estimate`, "estimate tab");
const buyout = () => open(`/jobs/${jobId}/buyout`, "buyout");
const buyoutRow = (line: string) => page.locator("li").filter({ has: page.getByText(line, { exact: true }) }).first();
async function addToCo(fields: Record<string, string>, costType: string) {
  const card = coCard(2);
  await card.getByRole("button", { name: "Add scope" }).click();
  for (const [label, value] of Object.entries(fields)) await card.getByLabel(label, { exact: true }).fill(value);
  await card.getByLabel("Cost type").selectOption({ label: costType });
  await card.getByRole("button", { name: "Add to CO" }).click();
}
async function startPayApp(periodTo?: string) {
  await billing();
  await page.getByRole("button", { name: "Submit pay application" }).first().click();
  if (periodTo) {
    const box = page.getByLabel("Period to");
    await box.fill(periodTo);
    await box.blur();
  }
}

// ───────────────────────────────────────────── PART 1. G702/G703 and PDF
test("1: two applications, the newest is #2 for the period to Oct 31, 2026", async () => {
  await billing();
  await expect(page.getByText(/^Pay app #\d+$/)).toHaveCount(2);
  await says(/Application #2 · issued .* · period to Oct 31, 2026/);
});

test("2: Application #2's header", async () => {
  await application(2);
  for (const text of ["ZZ Click General Contractors", "100 Test Plaza, Denver, CO 80202", "ZZ Click Billing Test", "1 Fixture Way, Denver, CO", "Framing, drywall and fireproofing", "Project / contract no. SC-1001", "Application no. 2", "Period to Oct 31, 2026"]) await says(text);
  await saysNot(/predates the field/);
});

test("3: the nine G702 lines", async () => {
  await application(2);
  for (const line of [
    "1. Original contract sum $100,000.00", "2. Net change by change orders $5,000.00", "3. Contract sum to date $105,000.00",
    "4. Total completed & stored to date $47,000.00", "5. Retainage to date $4,700.00", "6. Total earned less retainage $42,300.00",
    "7. Less previous certificates for payment $22,500.00", "8. Current payment due $19,800.00", "9. Balance to finish, including retainage $62,700.00",
  ]) await says(line);
});

test("4: net changes by change order, and no certification paragraph", async () => {
  await application(2);
  await says("Net changes by change order $5,000.00");
  await saysNot(/certifies that the work covered/);
});

test("5: the continuation sheet", async () => {
  await application(2);
  const table = page.locator("table").filter({ hasText: "Grand totals" }).first();
  for (const row of [
    ["Framing labor", "60,000", "20,000", "15,000", "0", "35,000", "58.3%", "25,000"],
    ["5/8 type X board", "15,000", "3,000", "3,000", "1,000", "7,000", "46.7%", "8,000"],
    ["Spray fireproofing", "25,000", "0", "5,000", "0", "5,000", "20.0%", "20,000"],
    ["Added soffit", "5,000", "0", "0", "0", "0", "0.0%", "5,000"],
    ["Grand totals", "105,000", "23,000", "23,000", "1,000", "47,000", "44.8%", "58,000"],
  ]) {
    const cells = (await table.locator("tr").filter({ hasText: row[0] }).first().locator("td, th").allInnerTexts()).map((c) => c.replace(/^\$|\.00$/g, "").trim());
    const at = cells.indexOf(row[0]);
    expect(cells.slice(at + 1, at + 8), `the ${row[0]} row`).toEqual(row.slice(1));
  }
});

test("6: the G702/G703 PDF downloads, page 1 portrait and page 2 landscape", async () => {
  await application(2);
  const file = await download(() => page.getByRole("button", { name: /Download G702\/G703 PDF/ }).click());
  expect(file.name).toBe("G702-G703 ZZ Click Billing Test application 2.pdf");
  const pages = await pdfPages(file.bytes);
  expect(pages[0].height, "page 1 should be portrait").toBeGreaterThan(pages[0].width);
  expect(pages[1].width, "page 2 should be landscape").toBeGreaterThan(pages[1].height);
  const text = pdfText(file.bytes);
  for (const figure of ["19,800.00", "62,700.00", "105,000"]) expect(text, `the PDF should show ${figure}`).toContain(figure);
});

test("7: Application #1", async () => {
  await application(1);
  for (const text of ["8. Current payment due $22,500.00", "7. Less previous certificates for payment $0.00", "9. Balance to finish, including retainage $82,500.00", "Period to Sep 30, 2026"]) await says(text);
});

test("7a: a suggested amount from hours, never filled in", async () => {
  await startPayApp("2026-10-31");
  await says("Suggested $7,000.00 from hours: 140 of 200 budgeted hours through 2026-10-31, 70.0%.");
  await expect(page.locator("tr").filter({ hasText: "Framing labor" }).locator('input[name="thisPeriodBilled"]').first()).toHaveValue("");
  await page.getByLabel("Period to").fill("2026-09-30");
  await page.getByLabel("Period to").blur();
  await says("Nothing suggested from hours: 100 of 200 budgeted hours through 2026-09-30, 50.0%, and this line is billed that far.");
});

test("7b: installed quantities on a field report, and the suggestion from them", async () => {
  await open(`/jobs/${jobId}/field-reports`, "field reports");
  const openForm = async () => {
    await page.getByRole("button", { name: "Log a day" }).click();
    await page.getByText("Installed today (optional)").click();
  };
  await openForm();
  await says("5/8 type X board (SF)");
  await says("7,000 of 10,000 SF to date");
  await page.getByLabel(/5\/8 type X board/).fill("500");
  await page.getByLabel(/Work performed|What was done|Notes/i).first().fill("Click spec day");
  await page.getByLabel(/Date/).first().fill("2026-10-27");
  await page.getByRole("button", { name: /^Save/ }).first().click();
  await page.getByText("Tue, Oct 27").click();
  await says("Installed: 500 SF 5/8 type X board");
  await openForm();
  await says("7,500 of 10,000 SF to date");
  // ponytail: the report is deleted directly; deleting a report is not what this step tests.
  await prisma.dailyFieldReport.deleteMany({ where: { jobId, workPerformed: "Click spec day" } });
  await open(`/jobs/${jobId}/field-reports`, "field reports");
  await openForm();
  await says("7,000 of 10,000 SF to date");
  await startPayApp("2026-10-31");
  await says("Suggested $2,000.00 from installed qty: 6,000 of 10,000 SF through 2026-10-31, 60.0%.");
  await page.getByLabel("Period to").fill("2026-09-30");
  await page.getByLabel("Period to").blur();
  await says("Nothing suggested from installed qty: 3,000 of 10,000 SF through 2026-09-30, 30.0%, and this line is billed that far.");
});

test("7c: the G703 as CSV and Excel, Period to defaults to month end", async () => {
  await application(2);
  const press = (name: string) => page.getByRole("link", { name }).or(page.getByRole("button", { name })).click();
  const csv = await download(() => press("G703 as CSV"));
  const totals = csv.bytes.toString("utf8").split(/\r?\n/).find((line) => /Grand total/i.test(line)) ?? "";
  for (const figure of ["105000", "23000", "1000", "47000", "44.8", "58000"]) expect(totals.split(","), `the CSV's grand totals should hold ${figure}`).toContain(figure);
  const xlsx = await download(() => press("G703 as Excel"));
  const rows = XLSX.utils.sheet_to_json<unknown[]>(Object.values(XLSX.read(xlsx.bytes).Sheets)[0], { header: 1 });
  const grand = rows.find((row) => row.some((cell) => /Grand total/i.test(String(cell)))) ?? [];
  for (const figure of [105000, 23000, 1000, 47000, 58000]) expect(grand, `the workbook's grand totals should hold ${figure}`).toContain(figure);
  await startPayApp();
  await expect(page.getByLabel("Period to")).toHaveValue(lastDayOfThisMonth());
  await expect(page.getByLabel("Period to")).toBeEditable();
});

// ───────────────────────────────────────────── PART 2. Lien waivers
const WAIVER_WARNING =
  "Before this goes to the GC: no lower-tier lien waiver received through 2026-09-30 from ZZ Click Spray Sub. Collect them on the Compliance page, or send knowing the GC may hold payment for them.";

test("8: the lower-tier waiver warning on #2's row and page, not on #1, not naming Foundation", async () => {
  await billing();
  await says(WAIVER_WARNING);
  await application(2);
  await says(WAIVER_WARNING);
  await saysNot(/no lower-tier lien waiver[^.]*Foundation Supply/);
  await application(1);
  await saysNot("no lower-tier lien waiver");
});

test("9: the warning is absent in print", async () => {
  await application(2);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(WAIVER_WARNING)).toBeHidden();
  await page.emulateMedia({ media: "screen" });
});

test("10-12: the conditional progress waiver offer, exceptions left empty", async () => {
  await billing();
  await says("Application #2 has no lien waiver yet.");
  const offer = page.getByRole("button", { name: "Issue the conditional progress waiver for application #2: $19,800.00 through 2026-10-31" });
  await offer.click();
  await expect(page.getByLabel("Form")).toHaveValue(/CONDITIONAL/i);
  await expect(page.getByLabel("Covers")).toHaveValue(/PROGRESS/i);
  await expect(page.getByLabel("Through date")).toHaveValue("2026-10-31");
  await expect(page.getByLabel(/^Amount/)).toHaveValue("19800.00");
  await expect(page.getByLabel("Pay application").locator("option:checked")).toHaveText(/^#2/);
  await expect(page.getByLabel(/^Excepted from this waiver/)).toHaveValue("");
  await says("Your exceptions total $0.00, and this job is carrying retainage held on this job $4,700.00.");
  await page.getByLabel(/^Excepted from this waiver/).fill("0");
  await page.getByRole("button", { name: "Issue waiver" }).click();
  await expect(offer).toHaveCount(0);
  await says("Conditional");
});

test("13: a received waiver for Spray Sub clears the warning", async () => {
  // ponytail: the waiver is recorded directly, as the fixture records Foundation's.
  // The Compliance form itself is not clicked here; this step tests the warning.
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } });
  await prisma.complianceDocument.create({
    data: { companyId: job.companyId, jobId, type: "LIEN_WAIVER", partyName: "ZZ Click Spray Sub", status: "RECEIVED", periodEnd: new Date("2026-09-30T00:00:00Z") },
  });
  await billing();
  await saysNot("no lower-tier lien waiver received");
});

test("12a: bill the retainage on a closeout application", async () => {
  await billing();
  await says("$4,700.00 still held");
  await page.getByRole("button", { name: /^Bill the retainage/ }).click();
  await page.getByLabel("Amount to bill").fill("5000");
  await page.getByRole("button", { name: "Create the retainage application" }).click();
  await says("Only $4,700.00 is held, so no more than that can be billed.");
  await page.getByLabel("Amount to bill").fill("4700");
  await page.getByRole("button", { name: "Create the retainage application" }).click();
  await says("Billed on application #3.");
  await says("$4,700.00 unpaid on application #3.");
  await expect(page.getByRole("button", { name: /conditional progress waiver for application #3: \$4,700\.00/ })).toBeVisible();
  await application(3);
  for (const text of ["5. Retainage to date $0.00", "6. Total earned less retainage $47,000.00", "7. Less previous certificates for payment $42,300.00", "8. Current payment due $4,700.00"]) await says(text);
});

// ───────────────────────────────────────────── PART 3. T&M to change order
test("14: the signed ticket drafts change order #2", async () => {
  await open(`/jobs/${jobId}/crew`, "crew tab");
  await page.getByText(/^T&M tickets$/).click();
  await says("Sam Patel (GC super)");
  await page.getByRole("button", { name: "Draft change order" }).click();
  await expect(page.getByRole("link", { name: "Change order #2 (draft) →" })).toBeVisible();
  await page.reload();
  await page.getByText(/^T&M tickets$/).click();
  await expect(page.getByRole("link", { name: "Change order #2 (draft) →" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft change order" })).toHaveCount(0);
});

test("15: the draft's description", async () => {
  await estimate();
  const card = coCard(2);
  await expect(card).toContainText("Draft");
  for (const text of ["T&M 2026-10-20: Reframed the L3 corridor soffit after the duct moved", "Ana Ruiz", "8", "Luis Ortega", "2.5", "signed on site by Sam Patel (GC super), Oct 20, 2026, 4:12 PM MDT (drawn signature on file)", "Photos: none captured"]) await expect(card).toContainText(text);
});

test("16: the three priced and unpriced lines", async () => {
  await estimate();
  const card = coCard(2);
  const ana = card.locator("li").filter({ hasText: "Ana Ruiz" });
  await expect(ana).toContainText("8 hr @ $101.59");
  await expect(ana).toContainText("($42.10/h wage + fringes $19.10/h + 31.25% burden on the wage $13.16 = $74.36/h)");
  await expect(ana).toContainText("Cost $74.36 × 8 = $594.88 · Labor markup 15%: +$89.23 · Overhead 10%: +$68.41 · Profit 8%: +$60.20 · Sell $101.59 × 8 = $812.72");
  const luis = card.locator("li").filter({ hasText: "Luis Ortega" });
  await expect(luis).toContainText("UNPRICED: no wage on file for ZZ Click Laborer on the work date; enter the rate");
  await expect(luis, "a price on Luis Ortega means a wage was invented").not.toContainText("@");
  await expect(luis).not.toContainText("Cost $");
  await expect(card.locator("li").filter({ hasText: "12 lengths 20ga track" })).toContainText("enter the cost");
});

test("16a: per diem, travel and mileage lines", async () => {
  await estimate();
  const line = (name: string) => coCard(2).locator("li").filter({ hasText: name });
  await expect(line("Per diem — $60.00 from the day's time entries")).toContainText("@ $71.28");
  await expect(line("Per diem")).toContainText("Cost $60.00 × 1 = $60.00 · Overhead 10%: +$6.00 · Profit 8%: +$5.28 · Sell $71.28 × 1 = $71.28");
  await expect(line("Travel — $45.00 entered on the ticket")).toContainText("@ $53.46");
  await expect(line("Mileage — 40 mi @ $0.725")).toContainText("1 @ $41.34");
  await expect(line("Mileage")).toContainText("Equipment markup 20%: +$5.80");
});

test("17: a scissor lift priced from the recap", async () => {
  await estimate();
  await addToCo({ Description: "Scissor lift", Qty: "1", "Budgeted unit cost": "1000" }, "Equipment");
  const lift = coCard(2).locator("li").filter({ hasText: "Scissor lift" }).first();
  await expect(lift).toContainText("@ $1,425.60");
  await expect(lift).toContainText("Cost $1,000.00 × 1 = $1,000.00 · Equipment markup 20%: +$200.00 · Overhead 10%: +$120.00 · Profit 8%: +$105.60 · Sell $1,425.60 × 1 = $1,425.60");
});

test("17a: an equipment rate, picked onto the draft, and a later rate change leaves it", async () => {
  await estimate();
  await coCard(2).getByRole("button", { name: "Add scope" }).click();
  await coCard(2).getByRole("link", { name: "Add equipment rates →" }).click();
  await expectHealthy(page, "equipment rates", { monitor });
  const addRate = async (starts: string) => {
    await page.getByRole("button", { name: "Add a rate" }).click();
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Save rate" }) });
    await form.locator('[name="name"]').fill("Scissor lift");
    await form.locator('[name="unit"]').selectOption({ label: "day" });
    await form.locator('[name="rate"]').fill("1000");
    await form.locator('[name="effectiveFrom"]').fill(starts);
    await page.getByRole("button", { name: "Save rate" }).click();
  };
  await addRate("2026-01-01");
  await says("Scissor lift");
  await addRate("2026-06-01");
  await says(/already has a day rate/);
  await estimate();
  const card = coCard(2);
  await card.getByRole("button", { name: "Add scope" }).click();
  await card.getByLabel("Fill from an equipment rate").selectOption({ index: 1 });
  await expect(card.getByLabel("Description", { exact: true })).toHaveValue("Scissor lift");
  await expect(card.getByLabel("Unit", { exact: true })).toHaveValue("day");
  await expect(card.getByLabel("Budgeted unit cost")).toHaveValue("1000.00");
  await expect(card.getByLabel("Cost type")).toHaveValue("EQUIPMENT");
  await expect(card.getByLabel("Unit price")).toHaveValue("");
  await card.getByRole("button", { name: "Add to CO" }).click();
  await expect(coCard(2).getByText(/@ \$1,425\.60/)).toHaveCount(2);
  await open("/equipment/rates", "equipment rates");
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.locator('form [name="rate"]').fill("2000");
  await page.getByRole("button", { name: "Save changes" }).click();
  await says("$2,000.00");
  await estimate();
  await expect(coCard(2).getByText(/@ \$1,425\.60/)).toHaveCount(2);
});

test("18: a typed unit price wins over the recap, then it is removed", async () => {
  await estimate();
  await addToCo({ Description: "Typed", Qty: "1", "Budgeted unit cost": "1000", "Unit price": "1500" }, "Equipment");
  const typed = coCard(2).locator("li").filter({ hasText: /Typed/ }).first();
  await expect(typed).toContainText("@ $1,500.00");
  await typed.getByRole("button", { name: "remove" }).click();
  await expect(coCard(2).locator("li").filter({ hasText: /— Typed/ })).toHaveCount(0);
});

test("19a: the change order log", async () => {
  await estimate();
  await page.getByRole("link", { name: "Change order log →" }).click();
  await expectHealthy(page, "change order log", { monitor });
  await says(/1 Added soffit at L2 Executed .* \$5,000\.00/);
  await says("Drafts are not listed (1 on this job)");
  await says("Executed $5,000.00 1 change orders");
  await says("Pending GC $0.00 0 change orders");
  await says("Rejected $0.00 0 change orders");
  const press = (name: string) => page.getByRole("link", { name }).or(page.getByRole("button", { name })).click();
  const csv = (await download(() => press("Download CSV"))).bytes.toString("utf8");
  expect(csv).toContain("1,Added soffit at L2,Executed");
  expect(csv).toContain("Executed,1,5000");
  expect(csv).not.toContain("T&M 2026-10-20");
  const xlsx = await download(() => press("Download Excel"));
  const rows = XLSX.utils.sheet_to_json<unknown[]>(Object.values(XLSX.read(xlsx.bytes).Sheets)[0], { header: 1 });
  expect(rows.find((row) => row[0] === "Executed")).toEqual(["Executed", 1, 5000]);
});

// ───────────────────────────────────────────── PART 4. Submittal package
const submittals = () => open(`/submittals?job=${jobId}`, "submittals");
const submittal = (title: string) => page.locator("li").filter({ hasText: title }).first();

test("20: the two submittals", async () => {
  await submittals();
  await expect(submittal("Metal stud and track")).toContainText("SUB 1");
  await expect(submittal("Metal stud and track")).toContainText(/revis/i);
  await expect(submittal("Fire-rated gypsum board")).toContainText("SUB 2");
  await expect(submittal("Fire-rated gypsum board")).toContainText(/not sent/i);
});

test("21-24: SUB 2's package is built, downloaded and recorded", async () => {
  await submittals();
  await submittal("Fire-rated gypsum board").getByRole("button", { name: "Record as sent" }).click();
  const send = page.locator("form").filter({ hasText: "Send submittal 2" });
  const build = page.getByRole("button", { name: "Build and download package" });
  await expect(build).toBeDisabled();
  await page.getByLabel("Files for the package").setInputFiles([join(files, "click-test-board.pdf"), join(files, "click-test-track.pdf")]);
  const pdf = await download(() => build.click());
  await says("Downloaded: cover plus 2 files, 6 pages.");
  expect(pdf.name).toBe("ZZ-Click-Billing-Test-submittal-2-rev-1.pdf");
  expect((await pdfPages(pdf.bytes)).length).toBe(6);
  const cover = pdfText(pdf.bytes);
  for (const text of ["SUBMITTAL 2", "REVISION 1", "Fire-rated gypsum board", companyName, "ZZ Click General Contractors", "09 29 00", "A-502", "REVIEWER"]) {
    expect(cover, `the cover should show ${text}`).toContain(text);
  }
  await send.getByRole("button", { name: "Record as sent" }).click();
  await expect(send).toHaveCount(0);
  await submittals();
  await submittal("Fire-rated gypsum board").getByText(/^Revisions · /).click();
  await expect(submittal("Fire-rated gypsum board")).toContainText("Sent: 2 files, 6 pages: click-test-board.pdf (3 p), click-test-track.pdf (2 p)");
});

test("25: SUB 1's revision 2, recorded without a package", async () => {
  await submittals();
  await submittal("Metal stud and track").getByRole("button", { name: "Send revision 2" }).click();
  const send = page.locator("form").filter({ hasText: "Send revision 2 of submittal 1" });
  await send.getByRole("button", { name: "Record as sent" }).click();
  await expect(send).toHaveCount(0);
  await submittals();
  await submittal("Metal stud and track").getByText(/^Revisions · /).click();
  await expect(submittal("Metal stud and track")).toContainText("R2");
  await expect(submittal("Metal stud and track").locator("li").filter({ hasText: "R2" })).not.toContainText("Sent:");
});

// ───────────────────────────────────────────── PART 5. Buyout
test("26-28: the buyout rows, quotes and budgets", async () => {
  await buyout();
  await expect(page.getByText("Framing labor", { exact: true }).filter({ visible: true }), "a labor line on Buyout").toHaveCount(0);
  const board = buyoutRow("5/8 type X board");
  for (const text of ["Budget $8,000.00", "Drafted $0.00", "Committed $0.00", "10000 left of 10000", "ZZ Click Foundation Supply: $0.75 = $7,500.00 · lowest · $500.00 under budget", "ZZ Click ABC Building: $0.85 = $8,500.00 · $500.00 over budget", "ZZ Click Metric Board quoted $700.00 per MSF. A different unit, so it is not compared."]) {
    await expect(board).toContainText(text);
  }
  // Not compared: Metric Board has no quote row of its own, so no button to add it.
  await expect(board.locator("li").filter({ hasText: /^ZZ Click Metric Board:/ })).toHaveCount(0);
  const spray = buyoutRow("Spray fireproofing");
  await expect(spray).toContainText("Budget $18,000.00");
  await expect(spray).toContainText("No current quote on file in this unit.");
});

async function addSprayPo() {
  const spray = buyoutRow("Spray fireproofing");
  await spray.getByLabel("Vendor or lower-tier sub").selectOption({ label: "ZZ Click Spray Sub" });
  await spray.getByLabel("Unit price").fill("18500");
  await spray.getByRole("button", { name: "Add to draft PO" }).click();
}

test("29-30: two draft POs", async () => {
  await buyout();
  await buyoutRow("5/8 type X board").locator("li").filter({ hasText: "ZZ Click Foundation Supply: $0.75" }).getByRole("button", { name: "Add to draft PO" }).click();
  await says("PO 1 · ZZ Click Foundation Supply · draft · $7,500.00");
  await expect(buyoutRow("5/8 type X board")).toContainText("Drafted $7,500.00");
  await expect(buyoutRow("5/8 type X board")).toContainText("Committed $0.00");
  await buyout();
  await expect(buyoutRow("5/8 type X board")).toContainText("0 left of 10000");
  await addSprayPo();
  await says("PO 2 · ZZ Click Spray Sub · draft · $18,500.00");
});

test("31: the Estimate shows drafted amounts, Actual unchanged", async () => {
  await estimate();
  await says("Drafted on a PO $7,500.00");
  await says("Drafted on a PO $18,500.00");
  const actual = await prisma.costEntry.count({ where: { lineItem: { jobId } } });
  expect(actual, "a cost entry appeared, so Actual moved").toBe(0);
});

test("32: a removed draft PO's number is not reused", async () => {
  await buyout();
  const po2 = page.locator("li").filter({ has: page.getByText(/^PO 2 · ZZ Click Spray Sub/) }).last();
  await po2.getByRole("button", { name: "Remove" }).click();
  await po2.getByRole("button", { name: "Remove it" }).click();
  await saysNot("PO 2 ·");
  await addSprayPo();
  await says("PO 3 · ZZ Click Spray Sub");
});

test("33: a vendor on a material order cannot be deleted", async () => {
  await open("/vendors", "vendors");
  const row = page.locator("li").filter({ has: page.getByText("ZZ Click Foundation Supply", { exact: true }) }).first();
  await row.getByRole("button", { name: "Remove" }).click();
  await row.getByRole("button", { name: "Confirm remove" }).click();
  await says(/material order/);
  await says("ZZ Click Foundation Supply");
});

// ───────────────────────────────────────────── PART 6. Issue, PDF, close
const po1 = () => page.locator("div").filter({ has: page.getByRole("button", { name: "Download PDF" }) }).filter({ hasText: /^PO 1 · / }).last();

test("34-35: PO 1 as a draft, and its draft PDF", async () => {
  await buyout();
  await expect(po1()).toContainText("Marking as issued counts this as committed and locks its lines. Nothing is sent to the vendor.");
  await expect(po1().getByLabel("Date issued")).toBeVisible();
  const pdf = await download(() => po1().getByRole("button", { name: "Download PDF" }).click());
  expect(pdf.name).toBe("ZZ-Click-Billing-Test-PO-1.pdf");
  const text = pdfText(pdf.bytes);
  for (const part of ["DRAFT - NOT ISSUED", "ZZ Click Foundation Supply", "5/8 type X board", "10000", "SF", "0.75", "7,500.00"]) expect(text, `the PO PDF should show ${part}`).toContain(part);
});

test("36-38: PO 1 issued, committed, Actual unchanged, PDF dated", async () => {
  await buyout();
  await po1().getByLabel("Date issued").fill("2026-10-28");
  await po1().getByRole("button", { name: "Mark as issued" }).click();
  await says("PO 1 · ZZ Click Foundation Supply · issued · $7,500.00 · issued Oct 28, 2026");
  await expect(buyoutRow("5/8 type X board")).toContainText("Committed $7,500.00");
  await expect(buyoutRow("5/8 type X board")).toContainText("Drafted $0.00");
  await estimate();
  await says("Committed $7,500.00");
  await buyout();
  const pdf = await download(() => po1().getByRole("button", { name: "Download PDF" }).click());
  const text = pdfText(pdf.bytes);
  expect(text).not.toContain("DRAFT");
  expect(text).toContain("Oct 28, 2026");
});

async function logOrder(vendor: string, what: string) {
  await open("/material-orders", "material orders");
  await page.getByRole("button", { name: "Log an order" }).click();
  const job = page.locator('select[name="jobId"]');
  const jobOption = await job.evaluate((select: HTMLSelectElement, name) => [...select.options].find((option) => option.text.startsWith(`${name} — `))?.value ?? "", FIXTURE_JOB);
  await job.selectOption(jobOption);
  await page.locator('select[name="vendorId"]').selectOption({ label: vendor });
  await page.getByLabel(/^What was ordered/).fill(what);
  await page.locator('select[name="purchaseOrderLineId"]').selectOption({ label: "PO 1: 5/8 type X board" });
  await page.getByRole("button", { name: "Save order" }).click();
}

test("39: a material order against PO 1", async () => {
  await logOrder("ZZ Click Foundation Supply", "Click spec drop");
  await expect(page.locator("li, tr").filter({ hasText: "Click spec drop" }).first()).toContainText("on PO 1");
});

test("40: the wrong vendor on PO 1 is refused in words", async () => {
  await logOrder("ZZ Click ABC Building", "Click spec wrong vendor");
  await says("PO 1 is with a different vendor than this order");
});

test("41: PO 1 cannot close before it was issued, then closes", async () => {
  await buyout();
  await po1().getByLabel("Date closed").fill("2026-10-20");
  await po1().getByRole("button", { name: "Close" }).click();
  await says(/before it was issued/);
  await po1().getByLabel("Date closed").fill("2026-10-30");
  await po1().getByRole("button", { name: "Close" }).click();
  await says(/PO 1 · ZZ Click Foundation Supply · closed · .*closed Oct 30, 2026/);
  await expect(buyoutRow("5/8 type X board")).toContainText("Committed $7,500.00");
  await expect(po1().getByLabel("Date closed")).toHaveCount(0);
});

// ───────────────────────────────────────────── PART 7. Spec findings
test("42-45: spec findings on Buyout, with no verdict", async () => {
  await buyout();
  await says("From 2 spec sections read on the bid. Sections nobody read are not included, so compare against the spec yourself.");
  await page.getByText(/^Spec says, not tied to one line · 1/).click();
  await says(/Fire rating · 07 81 00 · p 4/);
  await says("2-hour rating at beams");
  await page.getByText(/^Spec says · 2 to compare before buying/).click();
  await says(/Named product · 09 29 00 · p 4/);
  await says("Gypsum board shall be USG Sheetrock Firecode X. No substitutions.");
  await says(/Finish level · 09 29 00 · p 4/);
  await saysNot("$2,500");
  await saysNot(/\b(meets|complies with|compliant)\b/);
});
