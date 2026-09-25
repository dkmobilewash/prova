import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * /bids GREW FOUR WHOLE PANELS IN THREE DAYS AND NOBODY OPENED IT.
 *
 * #492 (alternates, unit prices, allowances), #494 (levelling the quotes you
 * collected), #496 (bid-form compliance) and #491 (a won bid linked to the job
 * it became) all render inside one row of that list, one after another, from
 * one query. Four features, one page, no coverage of any kind — so a single
 * null in any of them takes the whole page to an error boundary and the other
 * three with it. That is the specific risk this file exists to retire.
 *
 * WHAT EACH STEP ASSERTS IS A DERIVED SENTENCE, not a stored one. Every one of
 * these panels earns its keep by SAYING something — "this alternate has no
 * answer, so the total is provisional", "an unacknowledged addendum is the most
 * common reason a low bid is thrown out", "Acme is lowest but excludes the
 * soffits and Baker does not". A row that saves and says nothing is the failure
 * mode, and a check that only looked for the row would pass through it.
 *
 * THE FIGURES ARE THIS FILE'S OWN ARITHMETIC, never read off the screen and
 * blessed: a $120,000 base plus a $12,400 alternate the GC took is $132,400,
 * and $82,000 against $79,000 is a $3,000 spread. Anything that needs a
 * judgement about estimating — what a variance means, what a recap total
 * should be — is on the click-list for a person instead.
 *
 * SERIAL, on BID_DESK's own company: every panel hangs off one bid invitation
 * row, and the last step needs a job for that bid to have become.
 */
test.describe("the bid desk", () => {
  test.describe.configure({ mode: "serial", retries: 0, timeout: 180_000 });

  const GC_NAME = "ZZ-E2E Bid Desk GC";
  const PROJECT = "ZZ-E2E Northside medical office build-out";
  const JOB_NAME = "ZZ-E2E Bid Desk — Northside MOB";
  const BID_AMOUNT = "120000";
  /** base $120,000 + the one accepted alternate $12,400. `money` on these
   * panels drops the cents. */
  const BASE = "$120,000";
  const ALTERNATE = "$12,400";
  const AWARDED = "$132,400";
  const ALLOWANCE = "$15,000";
  const CHEAPEST = "ZZ-E2E Acme Framing";
  const DEAREST = "ZZ-E2E Baker Drywall";

  let page: Page;
  let monitor: HealthMonitor;
  let jobId: string;

  /** The one bid row on /bids. Everything in this file is inside it, which is
   * also the point: four features share it. */
  const bidRow = (): Locator => page.locator("li").filter({ hasText: PROJECT }).first();

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. sign in, and /bids says there is nothing rather than nothing matching", async () => {
    await signInAs(page, PERSONAS.bidDesk.email);
    await landOnDashboard(page, monitor);

    await page.goto("/bids");
    await expectHealthy(page, "/bids, empty", { monitor });
    await expect(page.getByRole("heading", { name: "Bid history" })).toBeVisible();
    // Two states, two sentences: "no bids match this filter" on a brand-new
    // account would be a dead end for a filter nobody set.
    await expect(page.getByText("No bids logged yet")).toBeVisible();
    await expect(page.getByText("No bids match this filter.")).toHaveCount(0);
  });

  test("2. log a bid invitation on the GC's own record", async () => {
    await page.goto("/contacts");
    await expectHealthy(page, "/contacts", { monitor });
    await page.getByRole("button", { name: "Add a contact" }).first().click();
    const contactForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save contact" }) });
    await contactForm.locator('input[name="name"]').fill(GC_NAME);
    await contactForm.getByRole("button", { name: "Save contact" }).click();

    await page.getByRole("link", { name: new RegExp(GC_NAME) }).first().click();
    await page.waitForURL(/\/contacts\/[^/]+$/);
    await expectHealthy(page, "the GC's contact page", { monitor });

    // A bid is logged where the ask came from — the GC's page, not the list.
    const invitation = page.locator("form").filter({ has: page.getByRole("button", { name: "Log invitation" }) });
    await invitation.locator('input[name="projectName"]').fill(PROJECT);
    await invitation.locator('select[name="tradeScope"]').selectOption("METAL_FRAMING_DRYWALL");
    await invitation.locator('input[name="dueDate"]').fill("2026-10-30");
    await invitation.locator('input[name="bidAmount"]').fill(BID_AMOUNT);
    await invitation.getByRole("button", { name: "Log invitation" }).click();

    await expect(page.locator("li").filter({ hasText: PROJECT }).first()).toBeVisible();
    await expectHealthy(page, "the GC's contact page after logging a bid", { monitor });

    await page.goto("/bids");
    await expectHealthy(page, "/bids with one bid", { monitor });
    await expect(bidRow()).toContainText(PROJECT);
    await expect(bidRow()).toContainText("Metal framing / drywall");
    await expect(bidRow()).toContainText("$120,000.00");
  });

  test("3. alternates, a unit price and an allowance, and what each does to the total (#492)", async () => {
    await bidRow().getByRole("button", { name: "Add an alternate, unit price or allowance" }).click();

    const lineForm = () => bidRow().locator("form").filter({ has: page.getByRole("button", { name: "Add", exact: true }) });
    // An ALTERNATE — added or deducted if the GC takes it.
    await lineForm().locator('select[name="kind"]').selectOption("ALTERNATE");
    await lineForm().locator('input[name="label"]').fill("Alternate 1");
    await lineForm().locator('input[name="amount"]').fill("12400");
    await lineForm().locator('input[name="description"]').fill("Level 5 finish in the lobby");
    await lineForm().getByRole("button", { name: "Add", exact: true }).click();
    await expect(bidRow().getByText("Alternate 1")).toBeVisible();
    await expectHealthy(page, "/bids after adding an alternate", { monitor });

    // A UNIT PRICE holds a rate, and the form asks for a rate rather than an
    // amount — the two cannot be typed into the same box by design.
    await bidRow().getByRole("button", { name: "Add another" }).click();
    await lineForm().locator('select[name="kind"]').selectOption("UNIT_PRICE");
    await lineForm().locator('input[name="label"]').fill("Extra board");
    await lineForm().locator('input[name="unitPrice"]').fill("3.10");
    await lineForm().locator('input[name="unit"]').fill("SF of 5/8 board");
    await lineForm().getByRole("button", { name: "Add", exact: true }).click();
    await expect(bidRow().getByText("Extra board")).toBeVisible();

    // An ALLOWANCE is carried INSIDE the base, so it is never added to it.
    await bidRow().getByRole("button", { name: "Add another" }).click();
    await lineForm().locator('select[name="kind"]').selectOption("ALLOWANCE");
    await lineForm().locator('input[name="label"]').fill("Patch and repair allowance");
    await lineForm().locator('input[name="amount"]').fill("15000");
    await lineForm().getByRole("button", { name: "Add", exact: true }).click();

    await page.reload();
    await expectHealthy(page, "/bids with three bid lines", { monitor });
    const row = bidRow();
    await expect(row).toContainText(`Allowances inside the base ${ALLOWANCE}`);
    await expect(row).toContainText("1 unit price held");
    // The GC has not answered the alternate, so the award is the base alone
    // and the panel says the total is provisional rather than implying it.
    await expect(row).toContainText(`Alternates accepted $0 of ${ALTERNATE} offered`);
    await expect(row).toContainText(`Base plus accepted ${BASE}`);
    await expect(row).toContainText("One alternate has no answer from the GC yet, so this total is provisional.");

    // The GC takes it: three states, because "they have not said" is not
    // "they declined".
    const accepted = row.locator("form").filter({ has: page.locator('select[name="accepted"]') }).first();
    await accepted.locator('select[name="accepted"]').selectOption("yes");
    await accepted.getByRole("button", { name: "Save" }).click();

    await page.reload();
    await expectHealthy(page, "/bids after the GC takes the alternate", { monitor });
    await expect(bidRow()).toContainText(`Alternates accepted ${ALTERNATE} of ${ALTERNATE} offered`);
    await expect(bidRow(), "base plus the accepted alternate").toContainText(`Base plus accepted ${AWARDED}`);
    await expect(bidRow().getByText(/provisional/)).toHaveCount(0);
  });

  test("4. an unacknowledged addendum makes the bid non-responsive (#496)", async () => {
    await bidRow().getByRole("button", { name: "Log an addendum" }).click();
    // Identified by the field only this form has, so a form opened later in
    // the same row cannot be picked up by accident.
    const addendum = bidRow().locator("form").filter({ has: page.locator('input[name="reference"]') });
    await addendum.locator('input[name="reference"]').fill("Addendum 3");
    await addendum.locator('input[name="issuedOn"]').fill("2026-10-20");
    await addendum.locator('input[name="affectsPricedScope"]').check();
    await addendum.locator('input[name="impactNote"]').fill("soffit detail at grid C");
    await addendum.getByRole("button", { name: "Log addendum" }).click();

    await page.reload();
    await expectHealthy(page, "/bids with an unacknowledged addendum", { monitor });
    const row = bidRow();
    await expect(row).toContainText("Addendum 3");
    await expect(row).toContainText("not acknowledged");
    await expect(
      row,
      "the verdict sits above everything, and one blocking item is one blocking item",
    ).toContainText(
      "1 thing would make this bid non-responsive. A bid that misses one is rejected unread, whatever the price.",
    );
    await expect(row).toContainText(
      "Addendum 3 has not been acknowledged. An unacknowledged addendum is the most common reason a low bid is thrown out.",
    );
    // A number that may now be wrong is said SEPARATELY from a form that is
    // not filled in.
    await expect(row).toContainText("Addendum 3 changed work you had already priced — soffit detail at grid C");

    await row.getByRole("button", { name: "Acknowledge" }).click();
    await page.reload();
    await expectHealthy(page, "/bids after acknowledging the addendum", { monitor });
    await expect(bidRow().getByText("not acknowledged")).toHaveCount(0);
    await expect(bidRow()).toContainText(/acknowledged \d{4}-\d{2}-\d{2}/);
    await expect(bidRow()).toContainText(
      "Nothing outstanding that this app can see. It has not read the ITB itself, only what was typed in from it — check the form before you send.",
    );
    // Still said, because the addendum still changed priced work.
    await expect(bidRow()).toContainText("changed work you had already priced");
  });

  test("5. what the bid form asks for, outstanding and then done (#496)", async () => {
    await bidRow().getByRole("button", { name: "Add a bid-form requirement" }).click();
    const requirement = bidRow().locator("form").filter({ has: page.locator('input[name="satisfiedOn"]') });
    await requirement.locator('select[name="kind"]').selectOption("BID_BOND");
    await requirement.locator('input[name="label"]').fill("Bid bond, 10% of base bid");
    await requirement.getByRole("button", { name: "Add requirement" }).click();

    await page.reload();
    await expectHealthy(page, "/bids with an outstanding requirement", { monitor });
    await expect(bidRow()).toContainText("Bid bond, 10% of base bid");
    await expect(bidRow()).toContainText("outstanding");
    await expect(bidRow()).toContainText("Bid bond, 10% of base bid — not recorded as done.");
    await expect(bidRow()).toContainText("1 thing would make this bid non-responsive.");

    await bidRow().getByRole("button", { name: "Mark done" }).click();
    await page.reload();
    await expectHealthy(page, "/bids after the bond is recorded", { monitor });
    await expect(bidRow()).toContainText(/done \d{4}-\d{2}-\d{2}/);
    await expect(bidRow().getByText("1 thing would make this bid non-responsive.")).toHaveCount(0);
  });

  test("6. two quotes, and the caution that decides whether the low one is the best (#494)", async () => {
    await bidRow().getByRole("button", { name: "Log a quote you received" }).click();
    const quoteForm = () =>
      bidRow().locator("form").filter({ has: page.getByRole("button", { name: "Add quote" }) });

    // The cheaper one, which leaves the soffits out.
    await quoteForm().locator('input[name="packageLabel"]').fill("Metal stud framing");
    await quoteForm().locator('input[name="vendorName"]').fill(CHEAPEST);
    await quoteForm().locator('input[name="amount"]').fill("79000");
    await quoteForm().locator('input[name="quotedOn"]').fill("2026-10-18");
    await quoteForm().locator('textarea[name="exclusions"]').fill("Soffits");
    await quoteForm().getByRole("button", { name: "Add quote" }).click();
    await expect(bidRow().getByText(CHEAPEST)).toBeVisible();

    // The dearer one, which excludes nothing.
    await bidRow().getByRole("button", { name: "Log another quote" }).click();
    await quoteForm().locator('input[name="packageLabel"]').fill("Metal stud framing");
    await quoteForm().locator('input[name="vendorName"]').fill(DEAREST);
    await quoteForm().locator('input[name="amount"]').fill("82000");
    await quoteForm().locator('input[name="quotedOn"]').fill("2026-10-19");
    await quoteForm().getByRole("button", { name: "Add quote" }).click();

    await page.reload();
    await expectHealthy(page, "/bids with two quotes on one package", { monitor });
    const row = bidRow();
    await expect(row).toContainText("2 quotes · $3,000 between high and low");
    await expect(row, "the cheapest is named lowest, and never on its own").toContainText("lowest");
    // THE CAUTION, before the numbers. This is the whole feature.
    await expect(row).toContainText(
      `${CHEAPEST} is lowest but excludes Soffits — ${DEAREST} does not. These are not the same bid.`,
    );
    await expect(row).toContainText("excludes Soffits");
    await expect(row).toContainText("No exclusions recorded.");
    await expect(row.getByText("Same exclusions on every quote — these are comparable.")).toHaveCount(0);
  });

  test("7. a won bid, linked to the job it became (#491)", async () => {
    // A job for it to have become, built through the real wizard on the GC
    // this bid came from.
    jobId = await startJob(page, monitor, { name: JOB_NAME, gcName: GC_NAME });
    await finishWizard(page, monitor, jobId);

    // The status lives on the GC's record, which is where a win is recorded.
    await page.goto("/bids");
    await expect(bidRow().getByRole("button", { name: "Link to the job this became" })).toHaveCount(0);

    await bidRow().getByRole("link", { name: new RegExp(PROJECT) }).click();
    await page.waitForURL(/\/contacts\/[^/]+$/);
    await expectHealthy(page, "the GC's contact page", { monitor });
    const statusForm = page
      .locator("li")
      .filter({ hasText: PROJECT })
      .locator("form")
      .filter({ has: page.locator('select[name="status"]') })
      .first();
    await statusForm.locator('select[name="status"]').selectOption("WON");
    await statusForm.getByRole("button", { name: "Update" }).click();

    await page.goto("/bids");
    await expectHealthy(page, "/bids with a won bid", { monitor });
    // Only a WON bid can be linked, so the control appears with the win.
    const link = bidRow().getByRole("button", { name: "Link to the job this became" });
    await expect(link).toBeVisible();
    await link.click();
    // By the option that names the job — `jobPickerLabel` decorates it with the
    // GC and the status (issue #65: fifteen jobs, seven with the same name), so
    // the label is not a string this file can spell.
    const jobPicker = bidRow().getByRole("combobox", { name: "Which job did this become?" });
    const jobValue = await jobPicker.locator("option", { hasText: JOB_NAME }).first().getAttribute("value");
    expect(jobValue, "the job should be offered to link").toBeTruthy();
    await jobPicker.selectOption(jobValue!);
    await bidRow().getByRole("button", { name: "Link", exact: true }).click();

    await page.reload();
    await expectHealthy(page, "/bids with the bid linked to its job", { monitor });
    const row = bidRow();
    await expect(row).toContainText("Became");
    await expect(row).toContainText(JOB_NAME);
    await expect(row).toContainText(`Bid ${BASE}`);
    // The job has not finished, so there is no verdict — and the panel gives
    // the REASON rather than a variance computed from a job three weeks in.
    // `costVsBid` is null BY CONSTRUCTION until the status says COMPLETE, so
    // there is no figure for the screen to print by forgetting to check.
    await expect(row, "an unfinished job gets a reason, never a variance").toContainText(
      "This job is still running",
    );
    await expect(row).toContainText("is not a question that can be answered until it finishes.");
    // `settledSentence` is the only thing that prints one, and it returns
    // null for anything not SETTLED.
    await expect(row.getByText(/than it was bid at/)).toHaveCount(0);
  });

  test("8. every panel survives a reload together, and the browser threw nothing", async () => {
    // One row, four features, one query. This is the check that a null in any
    // of them has not taken the page — and /pipeline reads the same bid.
    for (const target of ["/bids", "/bids?status=WON", "/bids?trade=METAL_FRAMING_DRYWALL", "/pipeline", `/jobs/${jobId}`]) {
      await page.goto(target);
      await expectHealthy(page, `with a fully worked bid: ${target}`, { monitor });
    }
    await page.goto("/bids?status=LOST");
    await expectHealthy(page, "/bids filtered to nothing", { monitor });
    // The other half of step 1's pair of sentences.
    await expect(page.getByText("No bids match this filter.")).toBeVisible();

    expect(
      monitor.hydrationMismatches,
      "the server's HTML and the browser's first render disagreed on these pages (CLAUDE.md, Dates)",
    ).toEqual([]);
    expect(monitor.crashes).toEqual([]);
  });
});
