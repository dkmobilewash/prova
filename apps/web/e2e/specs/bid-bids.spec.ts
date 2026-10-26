import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { dataTour } from "../lib/dataTour";
import { settleAction } from "../lib/journey";
import { expectNoCrmLinks } from "../lib/bidLinks";
import { expectFitsTheViewport } from "../lib/viewport";

/**
 * C STREAM BID, THE BID LOG: log a bid, see it, open its project, start the
 * estimate, and land in /bid/estimates — with not one link into the CRM.
 *
 * `/bid/bids` renders the CRM's own bid log (`components/BidLog.tsx`) with
 * `surface="bid"`. The CRM's `bid-desk.spec.ts` proves the log works; this proves
 * the SAME screen, on Bid's routes, does the same things and sends the person
 * to Bid's estimate rather than the CRM's add-work stepper.
 *
 * NOT EXECUTED when it was written: this container cannot sign in to Clerk (its
 * egress proxy denies the FAPI host), so the first real run is the `e2e` job on
 * the PR. Read that job, not this comment, before believing it passes.
 *
 * TAKEOFF is the persona, as in `bid-estimates.spec.ts` and for its reason: a
 * shared company that a dozen specs already write their own rows into, and no
 * new Clerk user (one refused phone number blocks the suite). Everything this
 * file makes has a `ZZ-E2E` name of its own.
 *
 * SERIAL: step 3 needs the bid step 2 logged, and step 4 the estimate step 3
 * started.
 */
test.describe.configure({ mode: "serial" });

test.describe("C Stream Bid — the bid log, from a logged bid to its estimate", () => {
  const STAMP = Date.now();
  const GC_NAME = `ZZ-E2E Bid Log GC ${STAMP}`;
  const PROJECT = `ZZ-E2E Bid Log Project ${STAMP}`;

  let page: Page;
  let monitor: HealthMonitor;
  let estimateId: string;

  const bidNav = () => page.getByRole("navigation", { name: "C Stream Bid" });
  const bidRow = (): Locator => page.locator(dataTour("bids-list")).locator("li").filter({ hasText: PROJECT }).first();

  async function expectBidPage(step: string) {
    await expectHealthy(page, step, { monitor, signedIn: false });
    await expect(bidNav(), `${step}: the Bid header is missing`).toBeVisible();
    await expectNoCrmLinks(page, step);
  }

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. sign in; the bid log loads inside Bid, with its own heading and Log a bid", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await page.goto("/bid/bids?view=all");
    await expectBidPage("the bid log");
    await expect(page.getByRole("heading", { name: "Bids", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Log a bid" })).toBeVisible();
    await expect(bidNav().getByRole("link", { name: "Bids" })).toHaveAttribute("aria-current", "page");
    // The CRM's heading and its way to the CRM are not here.
    await expect(page.getByRole("heading", { name: "Bid history" })).toHaveCount(0);
  });

  test("2. log a bid (a GC added in Bid's settings first), and see it on the log", async () => {
    // A bid needs a GC and Bid has no contacts page: it is added in Settings.
    await page.goto("/bid/settings");
    await expectBidPage("settings");
    const gcForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add GC" }) });
    await gcForm.locator('input[name="name"]').fill(GC_NAME);
    await settleAction(page, () => gcForm.getByRole("button", { name: "Add GC" }).click());

    await page.goto("/bid/bids?view=all");
    await page.getByRole("button", { name: "+ Log a bid" }).click();
    const logForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Log invitation" }) });
    await logForm.locator('select[name="contactId"]').selectOption({ label: GC_NAME });
    await logForm.locator('input[name="projectName"]').fill(PROJECT);
    await logForm.locator('select[name="tradeScope"]').selectOption("METAL_FRAMING_DRYWALL");
    await logForm.locator('input[name="dueDate"]').fill("2026-12-15");
    await settleAction(page, () => logForm.getByRole("button", { name: "Log invitation" }).click());

    await page.goto("/bid/bids?view=all");
    await expectBidPage("the bid log with a bid on it");
    await expect(bidRow()).toBeVisible();
    await expect(bidRow()).toContainText(GC_NAME);
    await expect(bidRow()).toContainText("Metal framing / drywall");
    await expect(bidRow()).toContainText("Invited");
    // The GC is a word here (Bid has no GC page); the bid's name is a link to
    // the bid's own page inside Bid, not to the CRM's /ai/bids/<id>.
    await expect(bidRow().getByRole("link", { name: GC_NAME })).toHaveCount(0);
    await expect(bidRow().getByRole("link", { name: PROJECT })).toHaveAttribute("href", /^\/bid\/bids\/[^/]+$/);
  });

  test("3. open its project and start the estimate; it lands in /bid/estimates", async () => {
    const controls = bidRow().locator('details[data-bids="project-controls"]');
    await controls.locator("summary").click();
    const start = bidRow().getByRole("button", { name: "Start the estimate" });
    await expect(start).toBeVisible();
    await start.click();
    // The action redirects: Bid's estimate, which opens on its takeoff — not the
    // CRM's /jobs/new/<id>/items stepper.
    await page.waitForURL(/\/bid\/estimates\/[^/]+\/takeoff$/, { timeout: 20_000 });
    estimateId = page.url().match(/\/bid\/estimates\/([^/]+)\/takeoff$/)![1];
    expect(estimateId).not.toBe("new");
    await expectBidPage("the estimate started from the bid");
    // Pre-filled from the project: its name is the estimate's.
    await expect(page.getByRole("heading", { name: PROJECT, level: 1 })).toBeVisible();
  });

  test("4. back on the log: the estimate and the GC's proposal are Bid links", async () => {
    await page.goto("/bid/bids?view=all");
    await expectBidPage("the bid log after starting the estimate");
    // The bid's name now also links to its own page, so name the estimate link by its target.
    const estimateLink = bidRow().locator(`a[href="/bid/estimates/${estimateId}"]`).first();
    await expect(estimateLink).toHaveAttribute("href", `/bid/estimates/${estimateId}`);
    const proposal = bidRow().getByRole("link", { name: "Proposal" });
    await expect(proposal).toHaveAttribute("href", new RegExp(`^/bid/estimates/${estimateId}/proposal\\?invitation=`));
    // And "Start the estimate" is gone: the project has its one estimate.
    await expect(bidRow().getByRole("button", { name: "Start the estimate" })).toHaveCount(0);

    await proposal.click();
    await page.waitForURL(new RegExp(`/bid/estimates/${estimateId}/proposal\\?invitation=`));
    await expectBidPage("the proposal for one GC");
  });

  test("5. the estimate is on the estimates list, and the bid log fits a phone", async () => {
    await page.goto("/bid/estimates");
    await expectBidPage("the estimates list");
    await expect(page.getByRole("link").filter({ hasText: PROJECT })).toHaveAttribute("href", `/bid/estimates/${estimateId}`);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/bid/bids?view=all");
    await expectBidPage("the bid log at 375px");
    await expectFitsTheViewport(page, "the bid log at 375px");
  });

  // NOT EXECUTED (see the header): the bid's page and its regret letter, opened
  // from the log, with every link staying in /bid. The viewport is still 375px
  // from step 5, so this doubles as the phone check for both new pages.
  test("6. open the bid's page from the log: its steps load, and every link stays in /bid", async () => {
    await page.goto("/bid/bids?view=all");
    await expectBidPage("the bid log, before opening a bid");
    const bidLink = bidRow().getByRole("link", { name: PROJECT }).first();
    const href = await bidLink.getAttribute("href");
    expect(href, "the bid's name links to its own page in Bid").toMatch(/^\/bid\/bids\/[^/]+$/);
    const bidId = href!.split("/").pop()!;

    await bidLink.click();
    await page.waitForURL(new RegExp(`/bid/bids/${bidId}$`));
    await expectBidPage("the bid's page");
    await expectFitsTheViewport(page, "the bid's page at 375px");
    await expect(page.getByRole("heading", { name: PROJECT, level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "← Back to your bids" })).toHaveAttribute("href", "/bid/bids");
    // Bid has no Ask and no GC page: neither is on the page.
    await expect(page.getByText("Ask about this bid")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open the bid" })).toHaveCount(0);

    const steps = page.getByRole("navigation", { name: "Bid steps" });
    for (const step of ["Estimate", "Addenda", "Decision", "Research"]) {
      await steps.getByRole("link", { name: new RegExp(`^${step}`) }).click();
      await expectBidPage(`the bid's ${step} step`);
      await expectFitsTheViewport(page, `the bid's ${step} step at 375px`);
    }

    // Back to the log by the page's own link.
    await page.getByRole("link", { name: "← Back to your bids" }).click();
    await page.waitForURL(/\/bid\/bids$/);
    await expectBidPage("the bid log, back from the bid's page");

    // The regret letter: written for any bid (this one is still Invited, so the
    // sender is told so), and its only link goes back to Bid's log.
    await page.goto(`/bid/bids/${bidId}/regret`);
    await expectBidPage("the regret letter");
    await expectFitsTheViewport(page, "the regret letter at 375px");
    await expect(page.locator('[data-regret="letter"]')).toContainText(GC_NAME);
    await expect(page.getByText("This bid is still marked")).toBeVisible();
    await expect(page.getByRole("link", { name: "← Back to bids" })).toHaveAttribute("href", "/bid/bids");
  });
});
