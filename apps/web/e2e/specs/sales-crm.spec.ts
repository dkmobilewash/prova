import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { CRASH_MARKERS, HealthMonitor, expectHealthy } from "../lib/health";
import { settleAction } from "../lib/journey";
import {
  PIPELINE_LEAD_NAME,
  PROJECT_CLAIM,
  RESEARCHED_LEAD_NAME,
  SALES_EXPECTED,
} from "../lib/salesFixture";

/**
 * PROVA'S OWN COLD-OUTBOUND CHANNEL, IN A REAL BROWSER, FOR THE FIRST TIME.
 *
 * `/sales` and `/sales/[id]` are where every imported lead is read, banded and
 * confirmed — the whole acquisition channel. Until 2026-10-05 no browser had
 * ever loaded either one, in this suite or anywhere else, and CI was green over
 * both. Not because anybody skipped them: both pages are gated on
 * `Company.isProvaOperator` AND role OWNER (the two checks are written out at
 * the top of each page, and `assertSalesAccess` applies the same pair to every
 * action), no persona in `lib/personas.ts` had the flag, and NO SCREEN IN THIS
 * PRODUCT SETS IT. So the pages were unreachable by construction, including by
 * `journey.spec.ts` step 10, which opens every destination the rail offers —
 * the rail does not advertise them to a company without the flag either.
 *
 * That is the vacuous green CLAUDE.md's Traps section exists to end: a crash on
 * either page would have failed nothing.
 *
 * ── WHAT MAKES EACH ASSERTION HERE NON-VACUOUS ──
 *
 * Every string this file looks for is one the PRODUCT composes, and the ones
 * that prove an event happened are ones that cannot be on the page before it:
 *
 *   - the fit band is derived from the signals on every read and stored
 *     nowhere, so "Call this one" is unreachable while the PROJECT signal is
 *     still PROPOSED — and this file asserts a count of ZERO for it first,
 *     twice, before confirming anything;
 *   - "checked by E2E SALES" is rendered from `reviewedByUserId`, which the
 *     seed deliberately leaves null on every row (see `lib/salesFixture.ts`);
 *   - the claim's OCCURRENCE COUNT crosses from one to two, because confirming
 *     a PROJECT signal makes its claim the band's reason as well as the row's
 *     text. A count, not a substring — CLAUDE.md's rule about a watcher whose
 *     needle is already on the page, which this repo has committed with an ARIA
 *     role and with a marketing sentence on the landing page;
 *   - the lead page is reached by CLICKING, and the URL it lands on carries a
 *     server-generated cuid this file never knew.
 *
 * `expectHealthy` (lib/health.ts) runs after every navigation and every action:
 * no crash sentence from this app's own boundaries, no uncaught exception, and
 * the page actually rendered something — a blank page cannot show an error
 * either. The LAST of those is what stops this file being green about an empty
 * render, which matters more here than usual: both halves of this gate fail by
 * rendering a short, perfectly healthy refusal page rather than by crashing.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT ASSERT ──
 *
 * `monitor.hydrationMismatches`. The signed-in shell has an open #418 race that
 * fires on roughly one authenticated page load in three and on a different set
 * of pages every run — CLAUDE.md's entry has the measurement and the two fixes
 * already landed. `journey.spec.ts` step 11 is the ONE place that is asserted,
 * on purpose, so the run goes red once and names every URL. Asserting it here
 * too would make this file fail for the shell's reason while saying "the sales
 * CRM is broken", which is the mis-attribution that entry spent three
 * investigations on. `expectHealthy` still fails on `monitor.crashes`.
 *
 * ── SERIAL, AND retries 0 ──
 *
 * Serial because the steps are one path: the lead has to open before its
 * signals can be reviewed. `retries: 0` for a sharper reason than the journey's
 * — THE CONFIRM IS IRREVERSIBLE. Nothing in this product can move a signal back
 * to PROPOSED (a wrong one is dismissed, which is a third state), so a retry
 * would re-run step 1 against a lead whose research has already been reviewed
 * and fail looking for a Confirm button that is correctly absent. A retry here
 * would be a test about a different fixture, reported under this file's name.
 * The seed replaces the signals on every RUN, which covers a re-run against a
 * surviving scratch database; it cannot cover a retry inside one run.
 */
test.describe("Prova's own sales CRM, behind the operator flag", () => {
  test.describe.configure({ mode: "serial", retries: 0, timeout: 120_000 });

  let page: Page;
  let monitor: HealthMonitor;
  /** The researched lead's own URL, learned by clicking rather than by
   *  construction — see step 5. */
  let leadUrl: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. /sales renders for the operator, and the rail offers it", async () => {
    await signInAs(page, PERSONAS.sales.email);
    await page.goto("/sales");
    await expectHealthy(page, "/sales as the operator", { monitor });

    await expect(page.getByRole("heading", { name: "Sales CRM", exact: true })).toBeVisible();

    // NEITHER REFUSAL, asserted by name. Both are short, healthy pages — the
    // flag half and the OWNER half — so without this a seed that lost the flag
    // would fail further down on a missing figure and name nothing.
    await expect(page.getByRole("heading", { name: SALES_EXPECTED.nonOperatorRefusal })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Owner only" })).toHaveCount(0);

    // The rail's "Internal" group, which `app/(app)/layout.tsx` appends only
    // when `isProvaOperator && role === "OWNER"`. Not a security boundary and
    // not asserted as one; it is the cheapest proof that the layout agrees with
    // the page about who this viewer is.
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sales CRM" }),
    ).toBeVisible();
  });

  test("2. the pipeline band renders the figures its seeded deals produce", async () => {
    const band = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Pipeline", exact: true }) });
    await expect(band).toHaveCount(1);

    // Read as text rather than as six locators: the band is a grid of cards
    // plus a <dl>, and asserting its sentences is the thing that matters —
    // every one of them is arithmetic over the opportunities, computed on this
    // request and stored nowhere.
    const bandText = await band.innerText();
    expect(bandText, "the Trial card and the Open line, both from one priced open deal").toContain(
      SALES_EXPECTED.openSlice,
    );
    expect(bandText, "one won, one lost").toContain(SALES_EXPECTED.wonLost);
    expect(bandText, "a rate exists only because something has been decided").toContain(
      SALES_EXPECTED.winRate,
    );

    // THE BRANCH THAT MUST NOT BE THE ONE RENDERING. With no opportunities the
    // band is replaced by this sentence, and that page is healthy, non-blank,
    // and would pass every other check in this file. `salesFixture.test.ts`
    // pins the arithmetic; this pins that the arithmetic ran at all.
    expect(bandText).not.toContain("No opportunities recorded against any lead yet");

    // "Sitting longest" renders only for an open deal with a recorded stage
    // history, so its presence proves the SalesStageChange rows seeded too —
    // and its link is the only unambiguous link to the pipeline lead.
    expect(bandText).toContain("Sitting longest");
    await expect(page.getByRole("link", { name: PIPELINE_LEAD_NAME, exact: true })).toBeVisible();
  });

  test("3. both leads are listed, and NEITHER is strong yet", async () => {
    const row = page.locator("li").filter({ hasText: RESEARCHED_LEAD_NAME });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(SALES_EXPECTED.bandBeforeConfirm);
    await expect(row).toContainText(SALES_EXPECTED.reasonBeforeConfirm);
    // Research waiting to be read is the only thing on this page that is
    // somebody's job, and it is what this spec is here to exercise.
    await expect(row).toContainText(SALES_EXPECTED.awaitingReviewBadge);

    // The pipeline lead, which has no signals at all — a different band and a
    // different reason, so one row cannot be mistaken for the other.
    await expect(page.getByText(SALES_EXPECTED.reasonNoSignals, { exact: true })).toBeVisible();

    // THE ANCHOR FOR EVERYTHING BELOW: the strong band is nowhere on this page.
    // If it were, every later assertion about the confirm would pass without
    // the confirm having done anything.
    await expect(page.getByText(SALES_EXPECTED.bandAfterConfirm, { exact: true })).toHaveCount(0);
  });

  test("4. the listing-import surface opens", async () => {
    // Collapsed behind a button, per this app's list-page convention. Opening
    // it runs the parser over an empty paste in the browser, so a parser that
    // throws on "" takes the page down here rather than in front of somebody
    // reading a real award packet.
    await page.getByRole("button", { name: "Read a subcontractor listing" }).click();

    await expect(
      page.getByRole("heading", { name: "Read a subcontractor listing" }),
    ).toBeVisible();
    const form = page.locator("form").filter({ has: page.locator('textarea[name="listingText"]') });
    await expect(form).toHaveCount(1);
    await expect(form.locator('input[name="sourceUrl"]')).toBeVisible();
    // The question that keeps an imported claim honest — a listing is filed
    // with the bid by every prime, so "did this prime win" is not optional.
    await expect(form.getByText("Did the prime on this form win the job?")).toBeVisible();

    // NOTHING IS SUBMITTED. With an empty paste the submit button names zero
    // subcontractors and is disabled, which is the state worth asserting: the
    // surface is live and refuses to import nothing. Driving a real paste would
    // make this spec depend on `lib/sub-listing/parse.ts`, which has its own
    // 286-case unit suite and is under active change in the other lane.
    const submit = form.getByRole("button", { name: /^Add \d+ subcontractors?$/ });
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();

    await expectHealthy(page, "/sales with the import surface open", { monitor });
    await form.getByRole("button", { name: "Cancel" }).click();
  });

  test("5. the researched lead opens on its own page, with its research unread", async () => {
    const link = page.locator('a[href^="/sales/"]').filter({ hasText: RESEARCHED_LEAD_NAME });
    await expect(link).toHaveCount(1);
    await link.click();

    // A cuid this file never knew, so arriving here cannot be a redirect back
    // to the list or a route that quietly matched.
    await page.waitForURL(/\/sales\/[A-Za-z0-9]+$/);
    leadUrl = page.url();
    expect(leadUrl, "the lead page is its own URL, not /sales").not.toMatch(/\/sales\/?$/);
    await expectHealthy(page, "/sales/[id]", { monitor });

    for (const heading of ["Edit lead", "What we know", "Opportunities", "Activity"]) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }

    // RESEARCH NOBODY HAS READ COUNTS FOR NOTHING. The PROPOSED signal is on
    // the page and the band is still the weaker one — otherwise the band would
    // measure how much searching happened rather than what is known, which is
    // the whole reason SalesSignalState exists.
    await expect(page.getByText(SALES_EXPECTED.signalProposed, { exact: true })).toHaveCount(1);
    await expect(page.getByText(SALES_EXPECTED.bandBeforeConfirm, { exact: true })).toBeVisible();
    await expect(page.getByText(SALES_EXPECTED.bandAfterConfirm, { exact: true })).toHaveCount(0);
    await expect(page.getByText(SALES_EXPECTED.reasonBeforeConfirm, { exact: true })).toBeVisible();

    // The two things the confirm will produce, proved ABSENT first. Neither is
    // a string a form preview, a placeholder or a seeded row can render: the
    // seed leaves every reviewer null, and the claim becomes the band's reason
    // only once the signal counts.
    await expect(page.getByText(/checked by/)).toHaveCount(0);
    await expect(page.getByText(PROJECT_CLAIM, { exact: true })).toHaveCount(1);
  });

  test("6. confirming the research moves the band and records who checked it", async () => {
    const confirm = page.getByRole("button", { name: "Confirm", exact: true });
    // Exactly one, so this cannot press the wrong row's button — and a count of
    // zero here means the fixture arrived already reviewed, which is a failure
    // of the seed and should say so rather than time out on a click.
    await expect(confirm).toHaveCount(1);

    // Waits for the Server Action's own POST, identified by the `next-action`
    // header — not for the first POST of any kind, which on a signed-in page is
    // Clerk's and resolves before the write has happened (lib/journey.ts).
    await settleAction(page, () => confirm.click());

    // Written by the review, from a relation the seed leaves null on every row.
    await expect(page.getByText(SALES_EXPECTED.reviewedBy)).toBeVisible();
    await expect(page.getByText(SALES_EXPECTED.signalProposed, { exact: true })).toHaveCount(0);
    await expect(page.getByText(SALES_EXPECTED.signalConfirmed, { exact: true }).first()).toBeVisible();

    // The band moved, and the claim is now the reason as well as the row's own
    // text — one occurrence before, two after. A count, so no amount of
    // pre-existing page text can satisfy it.
    await expect(page.getByText(SALES_EXPECTED.bandAfterConfirm, { exact: true })).toBeVisible();
    await expect(page.getByText(SALES_EXPECTED.reasonBeforeConfirm, { exact: true })).toHaveCount(0);
    await expect(page.getByText(PROJECT_CLAIM, { exact: true })).toHaveCount(2);

    await expectHealthy(page, "/sales/[id] after confirming a signal", { monitor });
  });

  test("7. the list agrees with the lead page, so the revalidate reached it", async () => {
    // `reviewSalesLeadSignal` revalidates BOTH paths. The band on /sales is
    // derived from the same signals, so a revalidate that missed the list would
    // leave two screens disagreeing about the same lead — and the list is the
    // one somebody works from.
    await page.goto("/sales");
    await expectHealthy(page, "/sales after the review", { monitor });

    const row = page.locator("li").filter({ hasText: RESEARCHED_LEAD_NAME });
    await expect(row).toContainText(SALES_EXPECTED.bandAfterConfirm);
    await expect(row).not.toContainText(SALES_EXPECTED.awaitingReviewBadge);

    // And the lead page is still reachable by its own URL after the write.
    await page.goto(leadUrl);
    await expectHealthy(page, "/sales/[id] revisited", { monitor });
  });
});

/**
 * THE OTHER HALF OF THE GATE, AND THE CONTROL THAT MAKES THE FILE ABOVE MEAN
 * SOMETHING.
 *
 * Everything above runs as the one persona whose company carries
 * `isProvaOperator`. On its own that proves the page renders for somebody; it
 * does not prove the flag is why. This signs in as MAIN — an ordinary tenant,
 * seeded without the flag and never mutated by any spec — and requires the same
 * URL to render the refusal instead.
 *
 * So the pair is a positive and a negative control on one measurement: the
 * operator sees the CRM, a tenant sees "Nothing here for this account", and
 * neither outcome is available to the other. If this test ever goes green on
 * both pages, the gate is open and the suite says so.
 *
 * `expectHealthy` is deliberately NOT used here. The refusal is two short
 * paragraphs, well under the 120 visible characters that check requires — and
 * it should be: its own page says "nothing here names what the page would have
 * shown". So the crash sentences are read from the same CRASH_MARKERS list
 * instead, which is the half of `expectHealthy` that applies.
 */
test("a tenant company is refused /sales, which is what makes the operator flag load-bearing", async ({
  page,
}) => {
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.main.email);
  await page.goto("/sales");

  await expect(
    page.getByRole("heading", { name: SALES_EXPECTED.nonOperatorRefusal }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sales CRM", exact: true })).toHaveCount(0);

  // The rail does not advertise a door that will not open. Not a boundary — the
  // page above is — but a tenant finding the link would be its own defect.
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sales CRM" }),
  ).toHaveCount(0);

  // The refusal must be a refusal, not a boundary wearing one's clothes.
  const bodyText = await page.locator("body").innerText();
  for (const marker of CRASH_MARKERS) {
    expect(bodyText, `/sales as a tenant shows "${marker}"`).not.toContain(marker);
  }
  expect(monitor.crashes, "/sales as a tenant: uncaught exception(s)").toEqual([]);
});
