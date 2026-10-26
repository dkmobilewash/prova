import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { dataTour } from "../lib/dataTour";
import { openCollapsed } from "../lib/collapsed";
import { settleAction } from "../lib/journey";
import { expectNoCrmLinks } from "../lib/bidLinks";
import { expectFitsTheViewport } from "../lib/viewport";

/**
 * C STREAM BID, ESTIMATES: from the list to the proposal, and not one link
 * into the CRM on the way.
 *
 * Bid is the same product cut down to the pre-award chain — bid log, takeoff,
 * estimate and recap, proposal — and its promise is that a sub who lives in it
 * is never carried to a CRM page. `bidLinkCensus.test.ts` proves the source says
 * so; the CRM's own specs prove the shared screens work. What neither can see
 * is the Bid ROUTES end to end: that the list loads, that "Start an estimate"
 * lands on this estimate's takeoff rather than the CRM's add-work stepper, that
 * each of the four tabs renders with no error boundary, and that every anchor
 * the browser actually drew points back into Bid. This does that, in order.
 *
 * It is served on the preview/localhost host class, where `/bid/*` is reachable
 * directly (lib/bid/surface.ts) — the same paths the Bid host serves.
 *
 * TAKEOFF is the persona, deliberately and with a reason: twelve spec files
 * already share that company and write their own jobs into it, so one more job
 * with a name of its own moves nothing any of them counts. (ESTIMATING and
 * BAD_INPUTS each say their file is the only writer, and a new Clerk user is not
 * available — one refused phone number on the shared instance blocks the suite.)
 *
 * SERIAL, for the reason journey.spec.ts is: step 3 needs the estimate step 2
 * made. NO ASSERTION HERE JUDGES A MONEY FORMULA — the one figure checked is the
 * line's own extension, 100 x $2.50, arithmetic this file supplied itself.
 */
test.describe.configure({ mode: "serial" });

test.describe("C Stream Bid — an estimate, from the list to the proposal", () => {
  const STAMP = Date.now();
  const JOB_NAME = `ZZ-E2E Bid Estimate ${STAMP}`;
  const GC_NAME = `ZZ-E2E Bid GC ${STAMP}`;
  const LINE = { description: `ZZ-E2E Bid line — 5/8in board ${STAMP}`, quantity: "100", unit: "SF", unitPrice: "2.50", cost: "1.75" };
  const LINE_TOTAL = "$250.00";

  let page: Page;
  let monitor: HealthMonitor;
  let estimateId: string;

  const bidNav = () => page.getByRole("navigation", { name: "C Stream Bid" });
  const estimateTabs = () => page.getByRole("navigation", { name: "This estimate" });

  /** The page is healthy, wears the Bid shell, and links nowhere out of Bid.
   * `signedIn: false` because that option switches off the CRM's "Main"
   * navigation assertion, which Bid's shell (its own nav) is not. */
  async function expectBidPage(step: string, options: { shell?: boolean } = {}) {
    await expectHealthy(page, step, { monitor, signedIn: false });
    if (options.shell !== false) await expect(bidNav(), `${step}: the Bid header is missing`).toBeVisible();
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

  test("1. sign in; the estimates list loads inside Bid", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await page.goto("/bid/estimates");
    await expectBidPage("the estimates list");
    await expect(page.getByRole("heading", { name: "Estimates", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start an estimate" })).toBeVisible();
    // The nav says where we are, and Estimates is it.
    await expect(bidNav().getByRole("link", { name: "Estimates" })).toHaveAttribute("aria-current", "page");
  });

  test("2. start an estimate; it lands on THIS estimate's takeoff, not the CRM's stepper", async () => {
    await page.getByRole("link", { name: "Start an estimate" }).click();
    await page.waitForURL(/\/bid\/estimates\/new$/);
    await expectBidPage("start an estimate");
    await expect(page.getByRole("heading", { name: "Start an estimate", level: 1 })).toBeVisible();
    // The CRM's wizard strip is not drawn (it links /jobs/new…).
    await expect(page.getByRole("navigation", { name: "New job steps" })).toHaveCount(0);

    await page.locator('input[name="jobName"]').fill(JOB_NAME);
    await page.locator('textarea[name="scope"]').fill("Metal stud framing, hang, tape and finish.");
    // This company may or may not already have a GC (twelve specs write here):
    // pick the first real one if there is a picker, else add this spec's own.
    // Either way the form is the CRM's, and `createJob` is its action.
    const picker = page.locator('select[name="contactId"]');
    if ((await picker.count()) > 0) {
      await page.getByRole("button", { name: "+ Add a new GC" }).click();
    }
    await page.locator('input[name="contactName"]').fill(GC_NAME);

    await page.getByRole("button", { name: "Start the estimate — upload the drawings next →" }).click();
    await page.waitForURL(/\/bid\/estimates\/[^/]+\/takeoff$/, { timeout: 15_000 });
    estimateId = page.url().match(/\/bid\/estimates\/([^/]+)\/takeoff$/)![1];
    expect(estimateId, "the new estimate's id is in the URL").not.toBe("new");

    await expectBidPage("the new estimate's takeoff");
    // The guide leads (lib/bid/guide): the rail names the job and its GC, shows
    // the five steps, and the one thing a brand-new estimate needs is its
    // drawings — and none of the CRM job header.
    const rail = page.getByRole("complementary", { name: "This bid" });
    await expect(rail.getByRole("heading", { name: JOB_NAME, level: 1 })).toBeVisible();
    await expect(rail.getByText(GC_NAME)).toBeVisible();
    await expect(rail.locator('[data-guide="steps"] > li')).toHaveCount(5);
    await expect(page.locator('[data-guide="ask"]')).toContainText(`No drawings are uploaded for ${JOB_NAME} yet.`);
    await expect(page.getByRole("navigation", { name: "Job stages" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Job sections" })).toHaveCount(0);
  });

  test("3. the four tabs, in the order of the chain", async () => {
    const labels = await estimateTabs().getByRole("link").allInnerTexts();
    expect(labels).toEqual(["Takeoff", "Estimate", "Bid recap", "Proposal"]);
    await expect(estimateTabs().getByRole("link", { name: "Takeoff" })).toHaveAttribute("aria-current", "page");
    // The index path has no content of its own and opens on the takeoff.
    await page.goto(`/bid/estimates/${estimateId}`);
    await page.waitForURL(new RegExp(`/bid/estimates/${estimateId}/takeoff$`));
  });

  test("4. Takeoff: no drawing yet, and the full-screen workspace says so without a CRM link", async () => {
    await expect(page.getByRole("heading", { name: "Takeoff", level: 2 })).toBeVisible();
    await expect(page.getByText("No drawing on this job yet")).toBeVisible();
    await expectBidPage("takeoff tab");

    // The workspace route sits OUTSIDE the Bid shell (it needs the viewport),
    // so it has no Bid header — but its way back is a Bid link.
    await page.goto(`/bid/workspace/${estimateId}`);
    await expectHealthy(page, "the takeoff workspace, no drawing", { monitor, signedIn: false });
    await expect(page.getByText("No drawing on this job yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the takeoff tab" })).toHaveAttribute(
      "href",
      `/bid/estimates/${estimateId}/takeoff`,
    );
    await expectNoCrmLinks(page, "the takeoff workspace", { minLinks: 1 });
  });

  test("5. Estimate: a line goes on, and the rail's bid so far follows it", async () => {
    await page.goto(`/bid/estimates/${estimateId}/takeoff`);
    await estimateTabs().getByRole("link", { name: "Estimate" }).click();
    await page.waitForURL(new RegExp(`/bid/estimates/${estimateId}/estimate$`));
    await expectBidPage("estimate tab");
    await expect(page.getByRole("heading", { name: "Line items (estimate)" })).toBeVisible();
    await expect(page.getByText("No line items yet")).toBeVisible();
    // Nothing past the award is offered here.
    await expect(page.getByRole("heading", { name: "Ready to lock this in?" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Job costing/ })).toHaveCount(0);

    // The estimate's own links to its neighbours are Bid's.
    await expect(page.getByRole("link", { name: "Measure off a plan" })).toHaveAttribute(
      "href",
      `/bid/estimates/${estimateId}/takeoff`,
    );
    await expect(page.getByRole("link", { name: "open the takeoff workspace" })).toHaveAttribute(
      "href",
      `/bid/workspace/${estimateId}`,
    );

    const addForm = page.locator(dataTour("job-add-line-item"));
    await openCollapsed(addForm, "Add line item", addForm.locator('input[name="description"]'));
    await addForm.locator('input[name="description"]').fill(LINE.description);
    await addForm.locator('input[name="quantity"]').fill(LINE.quantity);
    await addForm.locator('input[name="unit"]').fill(LINE.unit);
    await addForm.locator('input[name="unitPrice"]').fill(LINE.unitPrice);
    await addForm.locator('input[name="budgetedUnitCost"]').fill(LINE.cost);
    await settleAction(page, () =>
      addForm.locator("form").getByRole("button", { name: "Add line item", exact: true }).click(),
    );

    await page.reload();
    await expectBidPage("estimate tab after adding a line");
    await expect(page.getByText(LINE.description).first()).toBeVisible();
    // The rail's "Bid so far" (the card from lg up, the inline line below it) is
    // the same bidTotalOf the old header read.
    await expect(page.locator('[data-guide^="bid-so-far"]:visible').getByText(LINE_TOTAL)).toBeVisible();
  });

  test("6. Bid recap: its own tab, over the same line", async () => {
    await estimateTabs().getByRole("link", { name: "Bid recap" }).click();
    await page.waitForURL(new RegExp(`/bid/estimates/${estimateId}/recap$`));
    await expectBidPage("bid recap tab");
    await expect(page.getByRole("heading", { name: "Bid recap", level: 2 }).first()).toBeVisible();
    await expect(estimateTabs().getByRole("link", { name: "Bid recap" })).toHaveAttribute("aria-current", "page");
  });

  test("7. Proposal: the document, and its way back is the Estimate tab", async () => {
    await estimateTabs().getByRole("link", { name: "Proposal" }).click();
    await page.waitForURL(new RegExp(`/bid/estimates/${estimateId}/proposal$`));
    await expectBidPage("proposal tab");
    await expect(page.getByRole("heading", { name: `Proposal — ${JOB_NAME}` })).toBeVisible();
    // A proposal is a LUMP SUM until the sender picks otherwise (feat/gc-proposal):
    // the GC sees one price and none of the sub's own lines.
    await expect(page.getByText("Lump sum for the work described in this proposal")).toBeVisible();
    await expect(page.getByText(LINE.description)).toHaveCount(0);
    // The presentation links stay inside Bid; Itemized brings the schedule of values.
    const itemized = page.getByRole("navigation", { name: "Price presentation" }).getByRole("link", { name: "Itemized" });
    await expect(itemized).toHaveAttribute("href", `/bid/estimates/${estimateId}/proposal?mode=itemized`);
    await itemized.click();
    await page.waitForURL(new RegExp(`/bid/estimates/${estimateId}/proposal\\?mode=itemized$`));
    await expectBidPage("proposal tab, itemized");
    await expect(page.getByRole("heading", { name: "Schedule of values" })).toBeVisible();
    await expect(page.getByText(LINE.description).first()).toBeVisible();

    const back = page.getByRole("link", { name: "← Back to the estimate" });
    await expect(back).toHaveAttribute("href", `/bid/estimates/${estimateId}/estimate`);
    await back.click();
    await page.waitForURL(new RegExp(`/bid/estimates/${estimateId}/estimate$`));
    await expectBidPage("estimate tab, back from the proposal");
  });

  test("8. the estimate is on the list, with its total", async () => {
    await page.goto("/bid/estimates");
    await expectBidPage("the estimates list, with an estimate on it");
    const row = page.getByRole("link").filter({ hasText: JOB_NAME });
    await expect(row).toBeVisible();
    await expect(row).toContainText(LINE_TOTAL);
    await expect(row).toHaveAttribute("href", `/bid/estimates/${estimateId}`);
  });

  test("9. Price book and Settings: what the chain reads, still inside Bid", async () => {
    await bidNav().getByRole("link", { name: "Price book" }).click();
    await page.waitForURL(/\/bid\/price-book$/);
    await expectBidPage("price book");
    await expect(page.getByRole("heading", { name: "Price book", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a catalog entry" })).toBeVisible();

    await bidNav().getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/bid\/settings$/);
    await expectBidPage("settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Default markup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Proposal clauses" })).toBeVisible();

    // Add a GC: the CRM's createContact, with no contact page to link to.
    const gcForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add GC" }) });
    const settingsGc = `ZZ-E2E Bid Settings GC ${STAMP}`;
    await gcForm.locator('input[name="name"]').fill(settingsGc);
    await settleAction(page, () => gcForm.getByRole("button", { name: "Add GC" }).click());
    await page.reload();
    await expectBidPage("settings after adding a GC");
    await expect(page.locator("[data-bid='gc-list']").getByText(settingsGc)).toBeVisible();
  });

  test("10. at 375px every tab fits the phone", async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    const paths = [
      "/bid/estimates",
      `/bid/estimates/${estimateId}/takeoff`,
      `/bid/estimates/${estimateId}/estimate`,
      `/bid/estimates/${estimateId}/recap`,
      `/bid/estimates/${estimateId}/proposal`,
      "/bid/price-book",
      "/bid/settings",
    ];
    for (const path of paths) {
      await page.goto(path);
      await expectBidPage(`${path} at 375px`);
      await expectFitsTheViewport(page, `${path} at 375px`);
    }
  });
});
