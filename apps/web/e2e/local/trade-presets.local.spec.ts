import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { MARKUP_FIELDS, TRADE_PRESETS } from "../../lib/trade-presets";

/**
 * GUIDED FLOW PHASE 5, CLICKED. LOCAL ONLY: `pnpm test:e2e -- --welcome-click`.
 *
 * EMPTY signs in for the first time on this run's throwaway database, so its
 * company is genuinely new and `/welcome` is the real first screen. The walk:
 * tap Fireproofing, see the markup boxes EMPTY, choose Later, skip the three
 * questions; then read back what the tap wrote, open an estimate and see the
 * "Set your markup" banner and an unfinished Estimate step; set the markup in
 * Settings and see both clear. MAIN, an established company, is the control:
 * the same estimate page shows no banner.
 */

let page: Page;
let monitor: HealthMonitor;
const shots = (name: string) => test.info().outputPath(`${name}.png`);

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ actionTimeout: 15_000 });

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.empty.email);
});

async function companyOf(email: string) {
  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  return prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
}

async function estimateJob(companyId: string, name: string) {
  const contact = await prisma.contact.create({ data: { companyId, name: `${name} GC` } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name, status: "ESTIMATE" } });
  await prisma.jobLineItem.create({ data: { jobId: job.id, description: "Spray fireproofing — deck", quantity: "1000", unitPrice: "3" } });
  return job.id;
}

test("1. a new company is asked its trade first, one tap each, with a way past it", async () => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "What's your trade?" })).toBeVisible();
  await expect(page).toHaveURL(/\/welcome/);
  await expectHealthy(page, "welcome: trade", { monitor, signedIn: false });
  const trades = page.locator("[data-setup=trades] button");
  await expect(trades).toHaveText(TRADE_PRESETS.map((p) => p.label));
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await page.screenshot({ path: shots("welcome-trade") });
});

test("2. Fireproofing leads to the markup step, every box EMPTY", async () => {
  await page.getByRole("button", { name: "Fireproofing" }).click();
  await page.locator('[data-setup="skip-sample"]').click(); // the sample offer after the trade (#1120): not now
  await expect(page.getByRole("heading", { name: "Your markup" })).toBeVisible();
  for (const [field, label] of MARKUP_FIELDS.map((f, i) => [f, ["Material markup", "Labor markup", "Overhead", "Profit"][i]!] as const)) {
    await expect(page.getByLabel(label), label).toBeVisible();
    await expect(page.locator(`input[name="${field}"]`), label).toHaveValue("");
  }
  await page.screenshot({ path: shots("welcome-markup") });
  await page.getByRole("button", { name: "Later" }).click();
  await expect(page.getByRole("heading", { name: "A few questions about how you work" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.waitForURL(/\/dashboard(\?|$)/);
});

test("3. the tap wrote the fireproofing preset and no markup", async () => {
  const company = await companyOf(PERSONAS.empty.email);
  expect(company.tradePresetAskedAt).not.toBeNull();
  expect([company.wholeSetTakeoffOn, company.roomFinderOn, company.doorsWindowsOn, company.symbolCountOff]).toEqual([false, true, false, false]);
  expect((await prisma.wallType.findMany({ where: { companyId: company.id }, orderBy: { sortOrder: "asc" } })).map((t) => t.code)).toEqual(["FP1", "FP2"]);
  expect(await prisma.estimateTemplate.count({ where: { companyId: company.id, tradeScope: "FIREPROOFING" } })).toBe(1);
  expect(await prisma.companyBidDefaults.findUnique({ where: { companyId: company.id } })).toBeNull();
});

test("4. the estimate says Set your markup, and the Estimate step is not done", async () => {
  const company = await companyOf(PERSONAS.empty.email);
  const jobId = await estimateJob(company.id, "ZZ Trade Preset Job");
  await page.goto(`/jobs/${jobId}/estimate`);
  await expectHealthy(page, "estimate with markup owed", { monitor });
  const banner = page.locator("[data-estimate=set-markup]");
  await expect(banner).toContainText("Set your markup.");
  await expect(page.locator("[data-job-step=estimate]")).not.toHaveAttribute("data-state", "done");
  await page.screenshot({ path: shots("estimate-set-markup") });

  await banner.getByRole("link", { name: "Set your markup →" }).click();
  await expect(page).toHaveURL(/\/settings\?tab=estimating#bid-defaults/);
  const form = page.locator("#bid-defaults");
  await form.locator('input[name="materialMarkupPercent"]').fill("10");
  await form.locator('input[name="laborMarkupPercent"]').fill("12");
  await form.locator('input[name="overheadPercent"]').fill("8");
  await form.locator('input[name="profitPercent"]').fill("7.5");
  await form.getByRole("button", { name: "Save default markup" }).click();
  await expect(form.getByText("Saved. New jobs start from these.")).toBeVisible();

  await page.goto(`/jobs/${jobId}/estimate`);
  await expect(page.getByRole("heading", { name: "Line items (estimate)" })).toBeVisible();
  await expect(page.locator("[data-estimate=set-markup]")).toHaveCount(0);
  await expect(page.locator("[data-job-step=estimate]")).toHaveAttribute("data-state", "done");
});

test("5. CONTROL: an established company's estimate shows no banner", async ({ browser }) => {
  // A fresh context: clearing cookies leaves Clerk's client thinking it is
  // still signed in, and the second sign-in then refuses about half the time.
  await page.context().close();
  page = await (await browser.newContext()).newPage();
  await signInAs(page, PERSONAS.main.email);
  const company = await companyOf(PERSONAS.main.email);
  expect(company.tradePresetAskedAt).toBeNull();
  const jobId = await estimateJob(company.id, "ZZ Established Estimate");
  await page.goto(`/jobs/${jobId}/estimate`);
  await expect(page.getByRole("heading", { name: "Line items (estimate)" })).toBeVisible();
  await expect(page.locator("[data-estimate=set-markup]")).toHaveCount(0);
});
