import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── WITH MARKUP SET, THE REVIEW QUEUE ASKS FOR A COST AND THE BID FOLLOWS IT ──
 *
 * The new-job walkthrough v2 (F2): markup asked for at signup changed nothing,
 * because the queue asked for every line's sale price and the bid was the sum
 * of those. Diego's call: once a company's own four rates are set, the queue's
 * price item asks for the line's cost and the price is worked from it, through
 * the recap (`unitPriceFromCost`).
 *
 * Set 10/10/8/10 in Settings (the four lead the form, F3), put two unpriced
 * lines on a job, answer them in the queue with costs, and read the estimate:
 *
 *   100 ea material at $2: 200 → +10% 220 → +8% 237.60 → +10% 261.36 → $2.61 ea
 *    10 hr labor at $30:   300 → +10% 330 → +8% 356.40 → +10% 392.04 → $39.20 hr
 *
 * so the lines total goes from $0.00 to 100 × 2.61 + 10 × 39.20 = $653.00.
 */
test.describe.configure({ mode: "serial" });

const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");

test.describe("cost pricing in the review queue", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  const queue = (tab: Page) => tab.locator('[data-takeoff="review-queue"]');
  const item = (tab: Page) => queue(tab).locator('[data-takeoff="review-queue-item"]');
  const linesTotal = async () => (await page.getByText(/^Lines total/).first().innerText()).replace(/\s+/g, " ");

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pdf = readFileSync(S02);
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. the four rates lead the markup form; set 10/10/8/10", async () => {
    await signInAs(page, PERSONAS.markupCost.email);
    await landOnDashboard(page, monitor);
    await page.goto("/settings?tab=estimating#bid-defaults");
    const needed = page.locator('[data-markup="needed"]');
    await expect(needed).toBeVisible();
    await expect.poll(() => needed.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
    await expect(needed).toHaveAttribute("data-waiting", "true");
    await expect(needed.getByText("Your estimates are waiting on these four.")).toBeVisible();
    // The rest are under More, closed on a company that set none of them.
    await expect(page.locator('[data-markup="more"]')).not.toHaveAttribute("open", "");
    await expect(page.locator('input[name="bondPercent"]')).toBeHidden();
    await page.locator("#bid-defaults").screenshot({ path: path.resolve(__dirname, "../artifacts/cost-pricing/markup-form.png") });
    for (const [name, value] of [["materialMarkupPercent", "10"], ["laborMarkupPercent", "10"], ["overheadPercent", "8"], ["profitPercent", "10"]] as const) {
      await needed.locator(`input[name="${name}"]`).fill(value);
    }
    await page.getByRole("button", { name: "Save default markup" }).click();
    await expect(page.getByText("Saved. New jobs start from these.")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.locator('[data-markup="needed"]')).toHaveAttribute("data-waiting", "false");
  });

  test("2. a job with a plan and two unpriced lines: the bid is $0.00", async () => {
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Cost pricing", gcName: "ZZ-E2E Cost pricing GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').first().setInputFiles(S02);
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    // Two lines a takeoff would write: one material with its category, one
    // with none (the queue asks for it).
    await prisma.jobLineItem.create({ data: { jobId, description: "ZZ-E2E studs", quantity: "100", unit: "ea", costCategory: "MATERIAL" } });
    await prisma.jobLineItem.create({ data: { jobId, description: "ZZ-E2E hang and finish", quantity: "10", unit: "hr" } });
    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "the estimate before costs", { monitor });
    expect(await linesTotal()).toBe("Lines total $0.00");
  });

  let tab: Page;
  test("3. the queue asks for each line's cost, and prices it with the markup", async () => {
    // Straight to the queue: S02 is unscaled, so the stepper is still on
    // Scale — the stepper's own path to Review is job-stepper.spec.ts's.
    tab = await page.context().newPage();
    await tab.goto(`/takeoff/${jobId}?open=review`);
    await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
    await expect(queue(tab)).toBeVisible();

    const answer = async (description: string, cost: string, category: string | null, said: string) => {
      // Past anything else the plan put in the queue, to this line's item.
      for (let i = 0; i < 10 && !(await item(tab).innerText()).includes(description); i += 1) {
        await item(tab).locator('[data-takeoff="review-queue-next"]').click();
      }
      const costForm = item(tab).locator('[data-takeoff="review-queue-cost"]');
      await expect(costForm, "a price item asks for a cost once markup is set").toBeVisible();
      await expect(item(tab).locator('[data-takeoff="review-queue-line"]')).toHaveCount(0);
      const picker = costForm.locator('[data-takeoff="review-queue-cost-category"]');
      if (category === null) await expect(picker).toHaveCount(0);
      else await picker.selectOption(category);
      await costForm.locator('[data-takeoff="review-queue-cost-input"]').fill(cost);
      if (category !== null) await queue(tab).screenshot({ path: path.resolve(__dirname, "../artifacts/cost-pricing/queue-cost-item.png") });
      await costForm.locator('[data-takeoff="review-queue-cost-save"]').click();
      await expect(queue(tab).locator('[data-takeoff="review-queue-priced"]')).toHaveText(said, { timeout: 30_000 });
    };
    await answer("ZZ-E2E studs", "2", null, "ZZ-E2E studs: $2.61 per ea, with your markup");
    await answer("ZZ-E2E hang and finish", "30", "LABOR", "ZZ-E2E hang and finish: $39.20 per hr, with your markup");

    const lines = await prisma.jobLineItem.findMany({ where: { jobId }, orderBy: { createdAt: "asc" }, select: { budgetedUnitCost: true, unitPrice: true, costCategory: true } });
    expect(lines.map((l) => [l.budgetedUnitCost?.toString(), l.unitPrice?.toString(), l.costCategory])).toEqual([
      ["2", "2.61", "MATERIAL"],
      ["30", "39.2", "LABOR"],
    ]);
    await tab.close();
  });

  test("4. the bid total follows the costs and the markup: $653.00", async () => {
    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "the estimate after costs", { monitor });
    expect(await linesTotal()).toBe("Lines total $653.00");
    await page.screenshot({ path: path.resolve(__dirname, "../artifacts/cost-pricing/estimate-after-costs.png"), fullPage: true });
  });

  test("5. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
