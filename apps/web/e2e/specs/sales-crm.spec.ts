import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { CRASH_MARKERS, HealthMonitor, expectHealthy } from "../lib/health";
import { settleAction } from "../lib/journey";
import {
  IMPORT_EXPECTED,
  IMPORT_LISTING_TEXT,
  IMPORT_NOT_OUR_TRADE,
  IMPORT_OUR_TRADES,
  IMPORT_SLOT_DROPPED,
  IMPORT_SLOT_EXPECTED,
  IMPORT_SLOT_KEPT,
  IMPORT_SLOT_LISTING,
  IMPORT_SLOT_SOURCE_TITLE,
  IMPORT_SLOT_SOURCE_URL,
  IMPORT_SOURCE_TITLE,
  IMPORT_SOURCE_URL,
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

    // NOTHING IS SUBMITTED HERE, and that is now about ORDER rather than about
    // coupling. This paragraph used to end "driving a real paste would make this
    // spec depend on `lib/sub-listing/parse.ts`, which has its own 286-case unit
    // suite and is under active change in the other lane" — true when written,
    // and the sentence that kept the one path through this feature unclicked.
    // STEP 8 drives a real paste; it is appended at the END because importing
    // creates leads and steps 2, 3 and 7 count rows on `/sales`.
    //
    // What stays worth asserting right here is the EMPTY state: the submit
    // button names zero subcontractors and is disabled, so the surface is live
    // and refuses to import nothing. Opening it also runs the parser over "" in
    // the browser, so a reader that throws on an empty string takes the page
    // down here rather than in front of somebody reading a real award packet.
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

  /**
   * THE WHOLE CHAIN, IN ONE PIECE, FOR THE FIRST TIME.
   *
   * Step 4 above opens this surface and submits nothing, and its comment gives
   * the reason: driving a real paste would couple the spec to
   * `lib/sub-listing/parse.ts`, "under active change in the other lane".
   * **That was true when it was written and is not true now** — the parser is
   * this branch's own finished work, with 401 unit tests over it including a
   * 6,000-document generated corpus. The sentence had become the thing stopping
   * anybody clicking the one path through the feature.
   *
   * Every LINK in that chain was already measured and the chain never was:
   * `parse.ts` by unit tests, `leadMatch.ts` by an exhaustive 6,561-pair sweep,
   * `importSubListing` by 54 tests against a real Postgres up to the 60-row cap,
   * and this very component in real Chromium — **with the Server Action
   * stubbed.** Nothing had ever driven browser → action → Postgres → revalidated
   * page. That is the 2026-09-21 shape this suite exists for: four green checks
   * and 5,800 green unit tests while creating one invoice crashed every
   * authenticated page.
   *
   * ── WHY AT THE END AND NOT AT STEP 4 ──
   *
   * Importing CREATES LEADS, and steps 2, 3 and 7 locate rows and assert counts
   * on `/sales`. Pasting before them would change what they are measuring and
   * every later failure would be about this step. Appended, so the file reads as
   * one path and nothing above it moves.
   *
   * ── WHAT MAKES EACH ASSERTION HERE NON-VACUOUS ──
   *
   *   - the three company names are asserted ABSENT from `/sales` first. They
   *     cannot be on the page before the paste: nothing else in this suite
   *     writes them, and the textarea starts empty;
   *   - the submit button's number is composed by the product from what the
   *     parser read — THREE of the four rows, because the electrical one is not
   *     one of Prova's trades. A reader that could not see four rows would say
   *     the same thing, so the electrical row is separately asserted PRESENT on
   *     the review screen and ABSENT from the leads afterwards. An exclusion
   *     only means something if it discriminates;
   *   - the summary sentence is written from the Server Action's own return
   *     value, so it cannot appear without a round trip;
   *   - the claim asserted on the created lead carries `(line 11 of the
   *     listing)`. A line number is not a string this screen could compose
   *     without having read that row at that position.
   *
   * Every literal is gated by `e2e/lib/salesFixture.test.ts` in the UNIT suite,
   * which re-derives it from the app's own reader on every push — so a parser
   * change that moves a sentence fails in three minutes naming the fixture
   * rather than here, twenty minutes later, naming a missing string.
   */
  test("8. a real listing pastes, imports, and the subs arrive as leads with their evidence", async () => {
    await page.goto("/sales");
    await expectHealthy(page, "/sales before the import", { monitor });

    // THE ANCHOR. None of the three is on this page yet, and a count of zero is
    // the thing that makes every assertion below it mean something.
    for (const name of IMPORT_OUR_TRADES) {
      await expect(page.getByText(name, { exact: false })).toHaveCount(0);
    }
    await expect(page.getByText(IMPORT_NOT_OUR_TRADE, { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: "Read a subcontractor listing" }).click();
    const form = page
      .locator("form")
      .filter({ has: page.locator('textarea[name="listingText"]') });

    await form.locator('textarea[name="listingText"]').fill(IMPORT_LISTING_TEXT);
    await form.locator('input[name="sourceUrl"]').fill(IMPORT_SOURCE_URL);
    await form.locator('input[name="sourceTitle"]').fill(IMPORT_SOURCE_TITLE);
    // An AWARD, not a bid — so the GC_RELATIONSHIP and PROJECT claims are the
    // stronger wording. `signalsForSub` takes this as an argument and the
    // fixture's expected claims were derived with it, so the two must agree.
    await form
      .getByText("Yes — I am reading an award, and this prime got it")
      .click();

    // THE REVIEW SCREEN READ ALL FOUR ROWS. Including the one it will not
    // import — the parser hides nothing, which is the first thing this surface
    // promises.
    for (const name of [...IMPORT_OUR_TRADES, IMPORT_NOT_OUR_TRADE]) {
      await expect(form.getByText(name, { exact: false }).first()).toBeVisible();
    }
    await expect(
      form.getByText(`${IMPORT_EXPECTED.rowsParsed} subcontractor`, { exact: false }).first(),
    ).toBeVisible();

    // THREE, not four. The one number on screen that proves the trade default
    // ran over what the parser read.
    const submit = form.getByRole("button", { name: IMPORT_EXPECTED.submitButton, exact: true });
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();

    await settleAction(page, () => submit.click());

    // Composed from the action's return value — 15 signals, 3 new leads,
    // nothing attached, nothing skipped. Unreachable without the round trip.
    await expect(page.getByText(IMPORT_EXPECTED.doneFirstImport, { exact: true })).toBeVisible();
    await expectHealthy(page, "/sales after importing a listing", { monitor });

    // THE LEADS REACHED THE LIST, which is the revalidate as well as the write.
    for (const name of IMPORT_OUR_TRADES) {
      const row = page.locator("li").filter({ hasText: name });
      await expect(row).toHaveCount(1);
      // Five PROPOSED signals and not one confirmed, so an imported lead is as
      // thin as a lead nobody researched. If this ever reads otherwise, the
      // importer is banding a prospect on research nobody has checked, which is
      // the one thing this feature must not appear to do.
      await expect(row).toContainText(IMPORT_EXPECTED.bandAfterImport);
      await expect(row).toContainText(IMPORT_EXPECTED.awaitingReviewAfterImport);
    }

    // AND THE DISCRIMINATION. The electrical sub was read, shown, and is not a
    // lead. Without this, "three leads appeared" is satisfied by an importer
    // that creates one per row it can see.
    await expect(page.getByText(IMPORT_NOT_OUR_TRADE, { exact: false })).toHaveCount(0);

    // The evidence itself, on the lead's own page, reached by clicking — so the
    // claim is read out of the database rather than out of the paste still in
    // the browser.
    await page
      .locator("li")
      .filter({ hasText: IMPORT_OUR_TRADES[0]! })
      .locator('a[href^="/sales/"]')
      .first()
      .click();
    await page.waitForURL(/\/sales\/[A-Za-z0-9]+$/);
    await expectHealthy(page, "an imported lead's own page", { monitor });
    await expect(page.getByText(IMPORT_EXPECTED.firstLeadClaim, { exact: true })).toBeVisible();
    // Proposed, not confirmed — the review this product requires has not
    // happened, and nothing about importing may stand in for it.
    await expect(page.getByText(SALES_EXPECTED.signalProposed, { exact: true })).toHaveCount(5);
    await expect(page.getByText(/checked by/)).toHaveCount(0);
    // The source the paste was filed under, stored per claim rather than per
    // import, so a lead carrying two documents' claims still says which is which.
    await expect(page.getByText(IMPORT_SOURCE_TITLE, { exact: false }).first()).toBeVisible();
  });

  /**
   * THE ADDENDUM, AND THE DEFECT THIS BRANCH OPENED WITH.
   *
   * A reviewer re-reads a listing because an addendum revised it; that is the
   * normal case, not an edge one. Importing the same document twice used to
   * create a SECOND lead for every row — and every lead this importer writes is
   * permanently undeletable by design, so the duplicate could not be cleaned up
   * afterwards.
   *
   * There are 54 db tests over this against a real Postgres, including the whole
   * 60-row packet re-imported. None of them is a browser: the reviewer's own
   * path is to open the panel again and paste, and that path runs
   * `leadCandidatesFor` over the leads the FIRST import created and offers them
   * in a dropdown — code that exists only on the screen.
   *
   * `0 new leads` and `3 you already had` are mutually exclusive failures, so no
   * single bug produces both halves of that sentence by accident. A count of ONE
   * row per name is the other half: a re-import that made duplicates would
   * satisfy the sentence if the summary were wrong and the write were right, or
   * the reverse.
   */
  test("9. the same document pasted again recognises every lead and creates none", async () => {
    await page.goto("/sales");
    await page.getByRole("button", { name: "Read a subcontractor listing" }).click();
    const form = page
      .locator("form")
      .filter({ has: page.locator('textarea[name="listingText"]') });

    await form.locator('textarea[name="listingText"]').fill(IMPORT_LISTING_TEXT);
    await form.locator('input[name="sourceUrl"]').fill(IMPORT_SOURCE_URL);
    await form.locator('input[name="sourceTitle"]').fill(IMPORT_SOURCE_TITLE);
    await form
      .getByText("Yes — I am reading an award, and this prime got it")
      .click();

    // The same three, so the cap and the trade default are unchanged by the
    // leads now existing.
    const submit = form.getByRole("button", { name: IMPORT_EXPECTED.submitButton, exact: true });
    await expect(submit).toBeEnabled();

    await settleAction(page, () => submit.click());

    await expect(page.getByText(IMPORT_EXPECTED.doneReimport, { exact: true })).toBeVisible();
    await expectHealthy(page, "/sales after re-importing the same listing", { monitor });

    // ONE row per name, not two. The sentence above and this count are
    // independent observations of the same write.
    for (const name of IMPORT_OUR_TRADES) {
      await expect(page.locator("li").filter({ hasText: name })).toHaveCount(1);
      // And still nothing new to check: re-reading one document is not new
      // evidence, so the badge did not double either.
      await expect(page.locator("li").filter({ hasText: name })).toContainText(
        IMPORT_EXPECTED.awaitingReviewAfterImport,
      );
    }
  });

  /**
   * TWO FIRMS ON ONE LINE, AND THE THING THE ALIASING MADE IMPOSSIBLE.
   *
   * `readLabelledColumnsForm` emits one row per BIDDER COLUMN, all stamped with the
   * slot's own line — honestly, since the document prints them side by side. Until today
   * the selection travelled as LINE NUMBERS, and two consequences followed: the server
   * found more rows than keys and refused the whole paste, and on the screen
   * `chosen[row.line]` was ONE boolean for both firms, so unticking either unticked both
   * and one "Already a lead?" applied to both.
   *
   * The server half has five db cases against a real Postgres. **The screen half has
   * none and can have none** — the per-row state lives in the component and nothing in
   * this repo renders it. So this step does the thing that was impossible: it unticks ONE
   * firm of a slot and requires the other to keep its own state.
   *
   * What makes each assertion here non-vacuous:
   *
   *   - both names asserted ABSENT from `/sales` first;
   *   - the button says **2** before the untick and **1** after — a number the product
   *     composes from its own per-row state, and the singular/plural is part of it;
   *   - the kept row's checkbox asserted still CHECKED after the other is unticked. That
   *     is the regression, directly: with one boolean for both, it would be unchecked;
   *   - and the dropped firm asserted absent from the leads afterwards, so the untick
   *     reached the server rather than only the screen.
   *
   * The form's second slot is present and empty because the dispatcher needs two "Name of
   * Business" and two "License No." lines; a one-slot form takes the ordinary table path.
   * `salesFixture.test.ts` pins that premise, and that the two rows really share a line,
   * in the unit suite.
   */
  test("10. a form printing two firms on one line imports the one that stays ticked", async () => {
    await page.goto("/sales");
    await expectHealthy(page, "/sales before the slot-form import", { monitor });
    for (const name of [IMPORT_SLOT_KEPT, IMPORT_SLOT_DROPPED]) {
      await expect(page.getByText(name, { exact: false })).toHaveCount(0);
    }

    await page.getByRole("button", { name: "Read a subcontractor listing" }).click();
    const form = page
      .locator("form")
      .filter({ has: page.locator('textarea[name="listingText"]') });

    await form.locator('textarea[name="listingText"]').fill(IMPORT_SLOT_LISTING);
    await form.locator('input[name="sourceUrl"]').fill(IMPORT_SLOT_SOURCE_URL);
    await form.locator('input[name="sourceTitle"]').fill(IMPORT_SLOT_SOURCE_TITLE);
    await form.getByText("Yes — I am reading an award, and this prime got it").click();

    // BOTH READ, from one line. The reader hides neither.
    for (const name of [IMPORT_SLOT_KEPT, IMPORT_SLOT_DROPPED]) {
      await expect(form.getByText(name, { exact: false }).first()).toBeVisible();
    }
    await expect(
      form.getByRole("button", { name: IMPORT_SLOT_EXPECTED.submitBoth, exact: true }),
    ).toBeVisible();

    // THE REGRESSION, DIRECTLY. Untick one firm of the slot; the other must keep its own
    // state. Keyed by line, this single click unticked both and the button went to zero.
    const keptBox = form.getByLabel(`Add ${IMPORT_SLOT_KEPT}`, { exact: true });
    const droppedBox = form.getByLabel(`Add ${IMPORT_SLOT_DROPPED}`, { exact: true });
    await expect(keptBox).toBeChecked();
    await expect(droppedBox).toBeChecked();
    await droppedBox.uncheck();
    await expect(droppedBox).not.toBeChecked();
    await expect(keptBox, "unticking one firm of a slot unticked the other").toBeChecked();

    const submit = form.getByRole("button", { name: IMPORT_SLOT_EXPECTED.submitOne, exact: true });
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();

    await settleAction(page, () => submit.click());

    // Composed from the action's return value: one lead, five signals, nothing skipped.
    await expect(page.getByText(IMPORT_SLOT_EXPECTED.done, { exact: true })).toBeVisible();
    await expectHealthy(page, "/sales after importing one column of a slot", { monitor });

    const kept = page.locator("li").filter({ hasText: IMPORT_SLOT_KEPT });
    await expect(kept).toHaveCount(1);
    await expect(kept).toContainText(IMPORT_EXPECTED.bandAfterImport);
    // AND THE UNTICK REACHED THE SERVER. Without this the step is satisfied by a screen
    // that drew the right number and sent both rows anyway.
    await expect(page.getByText(IMPORT_SLOT_DROPPED, { exact: false })).toHaveCount(0);

    // The claim on the kept lead quotes the line the two firms SHARE, which is the
    // provenance being honest rather than inventing a line per column.
    await kept.locator('a[href^="/sales/"]').first().click();
    await page.waitForURL(/\/sales\/[A-Za-z0-9]+$/);
    await expectHealthy(page, "the slot-form lead's own page", { monitor });
    await expect(page.getByText(IMPORT_SLOT_EXPECTED.keptClaim, { exact: true })).toBeVisible();
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
