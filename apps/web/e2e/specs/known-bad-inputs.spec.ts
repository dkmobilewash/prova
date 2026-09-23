import { test as base, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import {
  estimateRow,
  finishWizard,
  invoiceForm,
  landOnDashboard,
  markContracted,
  readableRefusal,
  recordExecutedSubcontract,
  retainageForm,
  settleOutcome,
  startJob,
  submitInvoice,
  submitLineItem,
} from "../lib/journey";

/**
 * THE INPUTS THAT TOOK THE PRODUCT DOWN ON 2026-09-21, each as its own
 * case, written to the CORRECT behaviour rather than to what the code did
 * that day:
 *
 *   - quantity `2,800` on step 2 of a new job threw the redacted
 *     "Server Components render" sentence instead of adding the line;
 *   - invoice amount `12,500` took the whole billing tab to an error
 *     boundary;
 *   - retainage `0.10` saved 0.1% in silence — a hundredfold error on a
 *     figure the GC receives.
 *
 * The rule each case asserts is the one CLAUDE.md's error entry already
 * states: a person's input either saves, or is refused in a sentence they
 * can read and act on. NEVER a crash, and never a wrong value with nothing
 * on screen to say so. What "saves" means for a thousands comma is up to
 * the fix (#414 accepts `2,800` as 2800; it could equally have refused it
 * by name) — so each case passes on EITHER an accepted result or a
 * readable refusal, and fails only on the two shapes that are always
 * wrong: a crash marker, or nothing happening at all.
 *
 * STATUS, stated so it cannot be misread: as of this file's first commit
 * these cases FAIL on `main`, because the fix (#414, `cyrus/number-inputs`)
 * had not merged. That is the point of writing them first. A red case here
 * names a bug that is still live; a green one means the fix stayed fixed.
 *
 * INDEPENDENT of journey.spec.ts and of each other. The BAD_INPUTS persona
 * (lib/personas.ts) is this file's own company, and the contracted job the
 * invoice and retainage cases need is built once per worker by the fixture
 * below, through the same real screens the journey uses. Each case then
 * opens its own signed-in page, so a refused or half-saved input in one
 * case cannot change what another sees.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Playwright's own idiom for "no test-scoped fixtures added"
const test = base.extend<{}, { contractedJob: { jobId: string } }>({
  contractedJob: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const monitor = new HealthMonitor(page);
      await signInAs(page, PERSONAS.badInputs.email);
      await landOnDashboard(page, monitor);
      const jobId = await startJob(page, monitor, {
        name: `ZZ-E2E Bad inputs — contracted ${Date.now()}`,
        gcName: "ZZ-E2E Bad Inputs GC",
      });
      await submitLineItem(page, { description: "Level 2 corridor drywall", quantity: "2800", unit: "SF", unitPrice: "1.25" });
      await expect(estimateRow(page, "Level 2 corridor drywall")).toBeVisible();
      await finishWizard(page, monitor, jobId);
      await recordExecutedSubcontract(page, monitor, jobId);
      await markContracted(page, monitor, jobId);
      await context.close();
      await use({ jobId });
    },
    { scope: "worker", timeout: 180_000 },
  ],
});

test.describe("known-bad inputs from 2026-09-21", () => {
  test.describe.configure({ timeout: 120_000 });

  async function signedIn(page: Page): Promise<HealthMonitor> {
    const monitor = new HealthMonitor(page);
    await signInAs(page, PERSONAS.badInputs.email);
    return monitor;
  }

  /**
   * Puts WHAT WAS OBSERVED into the report, pass or fail. A case that
   * passes because the input was accepted and one that passes because it
   * was refused are both correct, but a reader should not have to open a
   * trace to learn which — and a pass whose recorded outcome reads
   * "accepted" while the fix has not merged is a pass to distrust.
   */
  async function recordOutcome(page: Page, outcome: string): Promise<void> {
    const text = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    test.info().annotations.push({ type: "observed outcome", description: outcome });
    await test.info().attach("page text after submit", { body: text, contentType: "text/plain" });
  }

  test("a quantity of 2,800 on step 2 adds the line or says why not — never a redacted error", async ({ page }) => {
    test.info().annotations.push({
      type: "known-bad input",
      description: "2026-09-21: rendered 'An error occurred in the Server Components render…' on the second screen of a first job. Fix: #414.",
    });
    const monitor = await signedIn(page);
    await landOnDashboard(page, monitor);
    await startJob(page, monitor, { name: `ZZ-E2E Bad inputs — comma quantity ${Date.now()}`, gcName: "ZZ-E2E Bad Inputs GC" });

    const description = "Level 3 corridor drywall (comma quantity)";
    await submitLineItem(page, { description, quantity: "2,800", unit: "SF", unitPrice: "1.25" });

    const outcome = await settleOutcome(
      page,
      estimateRow(page, description).filter({ hasText: /2,?800/ }),
      readableRefusal(page),
    );
    await recordOutcome(page, outcome);
    await expectHealthy(page, "step 2 after typing 2,800", { monitor });
    expect(
      outcome,
      "typing 2,800 must either add the line (as 2800) or show a sentence a person can act on — it did neither",
    ).not.toBe("neither");
  });

  test("an invoice amount of 12,500 creates the invoice or says why not — never an error boundary", async ({ page, contractedJob }) => {
    test.info().annotations.push({
      type: "known-bad input",
      description: "2026-09-21: took the billing tab to 'This page didn't load'. Fix: #414.",
    });
    const monitor = await signedIn(page);
    await page.goto(`/jobs/${contractedJob.jobId}/billing`);
    await expectHealthy(page, "billing tab", { monitor });

    await submitInvoice(page, { description: "Deposit (comma amount)", amount: "12,500", dueAt: "2026-10-15" });

    const outcome = await settleOutcome(page, page.locator("main").getByText("$12,500.00"), readableRefusal(page));
    await recordOutcome(page, outcome);
    await expectHealthy(page, "billing tab after typing 12,500", { monitor });
    expect(
      outcome,
      "typing 12,500 must either create a $12,500.00 invoice or show a sentence a person can act on — it did neither",
    ).not.toBe("neither");

    // Whatever happened to the amount, the rest of the product must still load.
    await page.goto("/dashboard");
    await expectHealthy(page, "dashboard after the 12,500 attempt", { monitor });
    await page.goto(`/jobs/${contractedJob.jobId}/billing`);
    await expectHealthy(page, "billing tab, reopened after the 12,500 attempt", { monitor });
    await expect(invoiceForm(page)).toBeVisible();
  });

  test("a retainage of 0.10 is never saved as 0.1% in silence", async ({ page, contractedJob }) => {
    test.info().annotations.push({
      type: "known-bad input",
      description:
        "2026-09-21: saved 0.1% and said nothing — $105 withheld where $10,500 was meant. Fix (#414) keeps the stored value but states what it withholds in dollars; a refusal or reading it as 10% would also pass here.",
    });
    const monitor = await signedIn(page);
    await page.goto(`/jobs/${contractedJob.jobId}/retainage`);
    await expectHealthy(page, "retainage tab", { monitor });

    const form = retainageForm(page);
    const percent = form.locator('input[name="retainagePercent"]');
    await percent.fill("0.10");

    // A dollar sentence shown WHILE typing counts: the fix's own design is
    // "under it what the rate comes to in money … recomputed as you type".
    const moneySentence = /withholds\s+\$[\d,]+\.\d\d/i;
    const explainedWhileTyping = moneySentence.test(await page.locator("main").innerText());

    const saved = page.waitForResponse((response) => response.request().method() === "POST");
    await form.getByRole("button", { name: "Save" }).click();
    await saved;
    const refusal = await settleOutcome(page, page.locator("__never__"), readableRefusal(page), 3_000);

    await page.reload();
    await expectHealthy(page, "retainage tab after saving 0.10", { monitor });

    const storedValue = await retainageForm(page).locator('input[name="retainagePercent"]').inputValue();
    const explainedAfterSave = moneySentence.test(await page.locator("main").innerText());
    await recordOutcome(
      page,
      `stored "${storedValue}"; refusal: ${refusal}; dollar sentence while typing: ${explainedWhileTyping}; after save: ${explainedAfterSave}`,
    );

    const acceptable =
      refusal === "refused" || // told the person 0.10 is not a rate this field takes
      storedValue === "10" || // read as the ten percent that was meant
      explainedWhileTyping ||
      explainedAfterSave; // kept as typed, with the dollars it withholds on screen

    expect(
      acceptable,
      `retainage reads back as "${storedValue}" with no refusal and no dollar figure on screen — ` +
        "that is 0.10 saved as a tenth of a percent in silence, the 2026-09-21 defect",
    ).toBe(true);
  });
});
