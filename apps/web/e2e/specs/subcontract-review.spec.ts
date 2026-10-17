import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { landOnDashboard, settleAction } from "../lib/journey";
import { SEEDED_CLAUSES, SEEDED_FINDINGS, SUBCONTRACT_REVIEW_JOB } from "../lib/subcontractReviewFixture";

/**
 * AI SUBCONTRACT REVIEW — the person's half, in a real browser.
 *
 * The review is SEEDED (`subcontractReviewFixture.ts` says why: CI forces the
 * model key empty, so no review could finish here). What this file proves is
 * everything after: the page is reachable from the job, carries the disclaimer,
 * shows each finding with its quote and the page code located, and every
 * decision — accept, negotiate with a note, dismiss, undo — is saved and
 * survives a reload. Each assertion is a string the page cannot already be
 * showing before the action it checks (the #61 watcher scar): the status words
 * are asserted BEFORE each click as well as after.
 */

test.describe("AI subcontract review", () => {
  test.describe.configure({ mode: "serial", retries: 0, timeout: 120_000 });

  let page: Page;
  let monitor: HealthMonitor;
  let reviewUrl = "";

  const card = (key: string): Locator => page.locator(`[data-subcontract-finding="${key}"]`);
  const status = (key: string): Locator => card(key).locator('[data-subcontract-review="status"]');
  const [payIfPaid, lds, notice] = SEEDED_FINDINGS;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. the job's contract version links to its review, which carries the disclaimer", async () => {
    await signInAs(page, PERSONAS.subcontractReview.email);
    await landOnDashboard(page, monitor);

    await page.goto("/jobs");
    await page.getByRole("link", { name: SUBCONTRACT_REVIEW_JOB }).first().click();
    await expectHealthy(page, "the review job's Overview", { monitor });

    await page.getByRole("link", { name: "Review before signing" }).click();
    await expect(page).toHaveURL(/\/subcontract-review\?version=/);
    reviewUrl = page.url();
    await expectHealthy(page, "/jobs/[id]/subcontract-review", { monitor });

    await expect(page.getByRole("heading", { name: "Subcontract review" })).toBeVisible();
    await expect(page.locator('[data-subcontract-review="not-legal-advice"]')).toHaveText(
      "This is not legal advice. Have an attorney review high-risk terms.",
    );
  });

  test("2. every finding shows its quote, its page and section, and starts undecided", async () => {
    for (const finding of SEEDED_FINDINGS) {
      await expect(card(finding.key)).toHaveCount(1);
      await expect(card(finding.key)).toContainText(finding.quote);
      await expect(card(finding.key)).toContainText(`p. ${finding.pageStart} · § ${finding.sectionRef}`);
      await expect(status(finding.key)).toHaveText("Not reviewed yet");
    }
    // Grouped, HIGH first: payment before notice in canonical order.
    await expect(page.locator('[data-subcontract-category="PAYMENT"]')).toBeVisible();
    await expect(page.locator('[data-subcontract-category="NOTICE"]')).toBeVisible();
    // The honesty lines: the unread scanned page and the dropped finding.
    await expect(page.locator('[data-subcontract-review="unread"]')).toContainText("pages 5");
    await expect(page.locator('[data-subcontract-review="dropped"]')).toContainText("1 finding was thrown away");
  });

  test("3. accept, negotiate with a note, and dismiss — each saved, each surviving a reload", async () => {
    await settleAction(page, () => card(lds.key).getByRole("button", { name: "Accept as written" }).click());
    await expect(status(lds.key)).toHaveText("Accepted as written");

    await card(payIfPaid.key).getByRole("button", { name: "Edit or add a note" }).click();
    await card(payIfPaid.key).getByLabel("Note").fill("Raised with the PM — asked for pay-when-paid.");
    await settleAction(page, () => card(payIfPaid.key).getByRole("button", { name: "Save" }).click());
    await expect(status(payIfPaid.key)).toHaveText("Negotiating");
    await expect(card(payIfPaid.key)).toContainText("Your note: Raised with the PM — asked for pay-when-paid.");

    await settleAction(page, () => card(notice.key).getByRole("button", { name: "Dismiss" }).click());
    await expect(status(notice.key)).toHaveText("Dismissed");

    await page.reload();
    await expectHealthy(page, "the review after three decisions", { monitor });
    await expect(status(lds.key)).toHaveText("Accepted as written");
    await expect(status(payIfPaid.key)).toHaveText("Negotiating");
    await expect(status(notice.key)).toHaveText("Dismissed");
    // A dismissed MEDIUM no longer counts: 2 high, retainage the only medium, the two scope facts low.
    await expect(page.locator('[data-subcontract-review="summary-line"]')).toContainText("2 high risk, 1 medium risk, 2 low risk");
  });

  test("4. undo takes two steps and puts the finding back to undecided", async () => {
    await card(notice.key).getByRole("button", { name: "Undo" }).click();
    await settleAction(page, () => card(notice.key).getByRole("button", { name: "Clear it" }).click());
    await expect(status(notice.key)).toHaveText("Not reviewed yet");
    await page.goto(reviewUrl);
    await expect(status(notice.key)).toHaveText("Not reviewed yet");
  });

  test("5. against the bid: the sum matches, the retainage and addenda differences are named, and both scope gaps are shown", async () => {
    const scope = page.locator('[data-subcontract-review="scope-check"]');
    await expect(scope.locator('[data-subcontract-review="money"]')).toContainText("$412,000.00");
    await expect(scope.locator('[data-subcontract-review="money"]')).toContainText("Matches your awarded bid.");
    await expect(scope.locator('[data-subcontract-review="retainage"]')).toContainText("withholds 10%; this job is set to 5%");
    await expect(scope.locator('[data-subcontract-review="addenda"]')).toContainText("Not logged on your bid: 3");
    await expect(scope.locator('[data-subcontract-review="addenda"]')).toContainText("Never acknowledged on your bid: Addendum 2");

    // The contradiction quotes the CONTRACT; the not-carried gap quotes OUR proposal and says so.
    await expect(scope).toContainText("furnish and install firestopping and fire caulking");
    const notCarried = scope.locator("article", { hasText: SEEDED_CLAUSES.cleaning });
    await expect(notCarried).toContainText("Your proposal's words — not found anywhere in the subcontract's readable pages");
    await expect(notCarried.locator('[data-subcontract-review="status"]')).toHaveText("Not reviewed yet");
    await settleAction(page, () => notCarried.getByRole("button", { name: "Negotiate" }).click());
    await expect(notCarried.locator('[data-subcontract-review="status"]')).toHaveText("Negotiating");
  });

  test("6. the one-page summary prints from the same decisions, with the disclaimer", async () => {
    await page.locator('[data-subcontract-review="summary-link"]').click();
    await expect(page).toHaveURL(/\/subcontract-review\/[^/]+\/summary$/);
    await expectHealthy(page, "/jobs/[id]/subcontract-review/[reviewId]/summary", { monitor });
    await expect(page.locator('[data-subcontract-review="not-legal-advice"]')).toHaveText(
      "This is not legal advice. Have an attorney review high-risk terms.",
    );
    await expect(page.locator('[data-subcontract-summary="top-risks"]')).toContainText("Pay-if-paid");
    await expect(page.locator('[data-subcontract-summary="money"]')).toContainText("matches your awarded bid of $412,000.00");
    await expect(page.locator('[data-subcontract-summary="scope"]')).toContainText(SEEDED_CLAUSES.cleaning);
    await expect(page.locator('[data-subcontract-summary="questions"]')).toContainText("Will you accept pay-when-paid with a 60-day outside date?");
    await expect(page.locator('[data-subcontract-summary="unread"]')).toContainText("pages 5");
    await expect(page.getByRole("button", { name: /print/i })).toBeVisible();
    await page.goto(reviewUrl);
  });

  test("7. starting a review on a file outside our store is refused with a sentence, and nothing changes", async () => {
    await page.getByRole("button", { name: "Run the review again on this version" }).click();
    await page.locator('[data-subcontract-review="start"]').click();
    await expect(page.locator('[data-subcontract-review="error"]')).toBeVisible();
    await expect(card(payIfPaid.key)).toHaveCount(1);
    await expect(status(lds.key)).toHaveText("Accepted as written");
  });
});
