import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { prisma } from "@prova/db";
import { HealthMonitor } from "../lib/health";

/**
 * ── "NEW JOB" FROM HOME AND THE TOP BAR, WALKED ──
 *
 * The renovation walk (2026-11-08) found no clear way to start a job from Home. This signs up a
 * brand-new company and photographs its empty dashboard at desk and phone width, starts a job
 * from the dashboard's New job button and checks it lands on the job's Takeoff tab — the stepper
 * and the plan upload — then starts one from the top bar, and photographs a busy dashboard after
 * seeding a handful of jobs. SKIPS unless WALK_OUT is set, on a `_test` database with E2E_PORT.
 */
const OUT = process.env.WALK_OUT ?? "";
const EMAIL = `newjob-${Date.now()}+clerk_test@example.com`;
let page: Page;
let shotN = 0;
const notes: string[] = [];
const note = (line: string) => {
  notes.push(line);
  console.log(`[new-job] ${line}`);
};
async function shot(name: string, on: Page = page): Promise<void> {
  shotN += 1;
  await on.screenshot({ path: path.join(OUT, `${String(shotN).padStart(2, "0")}-${name}.png`), fullPage: false }).catch(() => {});
}
const seen = (target: Locator, timeout = 5000) => target.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
async function hydrated(on: Page, selector: string): Promise<void> {
  await expect
    .poll(() => on.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))).catch(() => false), { timeout: 60_000 })
    .toBe(true);
}
async function freeTestPhone(): Promise<string> {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY ?? "" });
  for (const digits of Array.from({ length: 99 }, (_, i) => `20155501${String(i + 1).padStart(2, "0")}`).sort(() => Math.random() - 0.5)) {
    if ((await clerk.users.getUserList({ phoneNumber: [`+1${digits}`] })).totalCount === 0) return digits;
  }
  throw new Error("every Clerk test number is taken; delete some walk users");
}
async function createJobOnForm(name: string): Promise<string> {
  await hydrated(page, 'input[name="jobName"]');
  await page.locator('input[name="jobName"]').fill(name);
  const addNew = page.getByRole("button", { name: "+ Add a new GC" });
  if (await seen(addNew, 1500)) await addNew.click();
  const gcName = page.locator('input[name="contactName"]');
  if (await seen(gcName, 1500)) await gcName.fill("Walker Builders");
  else await page.locator('select[name="contactId"], [name="contactId"]').first().selectOption({ index: 1 }).catch(() => {});
  await page.getByRole("button", { name: /Start the job/ }).click();
  await page.waitForURL(/\/jobs\/[^/]+\/takeoff$/, { timeout: 30_000 });
  return page.url().match(/\/jobs\/([^/]+)\/takeoff$/)![1]!;
}

test.describe("starting a new job from Home and the top bar", () => {
  test.skip(OUT === "", "WALK_OUT says where the pictures go");
  test.setTimeout(900_000);

  test("brand-new and busy dashboards, both ways in, landing on the plan upload", async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    new HealthMonitor(page);

    await setupClerkTestingToken({ page });
    await page.goto("/sign-up");
    await hydrated(page, 'input[name="emailAddress"]');
    await page.locator('input[name="emailAddress"]').fill(EMAIL);
    const password = page.locator('input[name="password"]');
    if (await seen(password, 1000)) await password.fill(`NewJob-${Date.now()}-pw!`);
    for (const [name, value] of [["firstName", "Dana"], ["lastName", "Walker"], ["username", `newjob${Date.now()}`]] as const) {
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
    await hydrated(page, '[data-setup="trades"] button');
    await page.locator('[data-setup="trades"]').getByRole("button", { name: /Framing and drywall/ }).click();
    await page.locator('[data-setup="skip-sample"]').click(); // the sample offer after the trade (#1120): not now
    await page.getByRole("button", { name: "Later" }).click();
    const skip = page.getByRole("button", { name: "Skip for now" });
    if (await seen(skip, 15_000)) await skip.click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    // ── A BRAND-NEW COMPANY'S HOME ──
    const button = page.locator('[data-home="new-job"]');
    await expect(button).toBeVisible({ timeout: 30_000 });
    note(`Empty dashboard: "${(await button.innerText()).replace(/\s+/g, " ").trim()}" → ${await button.getAttribute("href")}`);
    note(`Checklist showing beside it: ${await page.getByText("Add your first job").first().isVisible().catch(() => false)}`);
    const topBar = page.locator('[data-shell="new-job"]');
    note(`Top bar: "${(await topBar.innerText()).replace(/\s+/g, " ").trim()}" → ${await topBar.getAttribute("href")}`);
    await shot("dashboard-new-company-1440");
    const phonePage = await (await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() })).newPage();
    await phonePage.goto("/dashboard");
    await expect(phonePage.locator('[data-home="new-job"]')).toBeVisible({ timeout: 30_000 });
    await expect(phonePage.locator('[data-shell="new-job"]')).toBeVisible();
    await shot("dashboard-new-company-390", phonePage);
    await phonePage.context().close();

    // ── FROM THE DASHBOARD: the wizard, then the job's plan upload ──
    await button.click();
    await page.waitForURL(/\/jobs\/new\?then=plans$/, { timeout: 30_000 });
    await expect(page.getByText("next you upload the plans")).toBeVisible();
    await shot("wizard-from-dashboard");
    const first = await createJobOnForm("Riverbend Clinic Fit-Out");
    await expect(page.getByText(/No drawing on this job yet|Upload the plans/).first()).toBeVisible({ timeout: 30_000 });
    note(`Created from the dashboard → ${new URL(page.url()).pathname}; stepper: ${await page.locator("[data-job-step]").count()} steps`);
    await shot("landed-on-plan-upload");

    // ── FROM THE TOP BAR, on another page ──
    await page.goto("/jobs");
    await page.locator('[data-shell="new-job"]').click();
    await page.waitForURL(/\/jobs\/new\?then=plans$/, { timeout: 30_000 });
    const second = await createJobOnForm("Baker EOC");
    note(`Created from the top bar → ${new URL(page.url()).pathname}`);
    expect(second).not.toBe(first);

    // ── A BUSY COMPANY'S HOME ──
    const { companyId } = await prisma.user.findFirstOrThrow({ where: { email: EMAIL }, select: { companyId: true } });
    const gc = await prisma.contact.findFirstOrThrow({ where: { companyId } });
    const statuses = ["ESTIMATE", "ESTIMATE", "CONTRACTED", "IN_PROGRESS", "IN_PROGRESS", "COMPLETE"] as const;
    for (const [i, status] of statuses.entries()) {
      await prisma.job.create({ data: { companyId, contactId: gc.id, name: `Busy job ${i + 1} — level ${i + 2} framing and drywall`, status } });
    }
    await page.goto("/dashboard");
    await expect(page.locator('[data-home="new-job"]')).toBeVisible({ timeout: 30_000 });
    note(`Busy dashboard (${statuses.length + 2} jobs): New job still first in the hero, top bar button present: ${await page.locator('[data-shell="new-job"]').isVisible()}`);
    await shot("dashboard-busy-1440");
    writeFileSync(path.join(OUT, "notes.md"), notes.map((n) => `- ${n}`).join("\n") + "\n");
  });
});
