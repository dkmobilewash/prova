import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import {
  estimateRow,
  finishWizard,
  jobTab,
  landOnDashboard,
  markContracted,
  recordExecutedSubcontract,
  retainageForm,
  startJob,
  submitLineItem,
} from "../lib/journey";

/**
 * THE LAUNCH-VIDEO RUN SHEET, REHEARSED BY A MACHINE THE NIGHT BEFORE THE
 * SHOOT.
 *
 * Cyrus films the launch VSL tomorrow morning off a run sheet that names,
 * for every beat, the result the screen must produce — and for three beats,
 * the wrong result that means "stop and retake". Every one of those promises
 * is a claim about the product that nobody had checked in a browser. This
 * file checks the ones this environment can reach, and says out loud which
 * ones it cannot, because a rehearsal that quietly tests something adjacent
 * is worse than no rehearsal: it converts "unchecked" into "checked" without
 * passing through "true".
 *
 * ════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS *NOT*, AND WHY THAT MATTERS MORE THAN WHAT IT IS
 * ════════════════════════════════════════════════════════════════════════
 *
 * THE SHOOT RUNS ON THE DEMO DATASET. THIS SUITE DOES NOT HAVE IT.
 * Riverside Medical Office Building, Lakeshore Retail Fit-Out and Northgate
 * Apartments come from `packages/db/scripts/seed-demo.mjs` and live on the
 * demo Neon project (`ep-patient-lake`). This suite boots a throwaway
 * Postgres and seeds nothing but its own personas, so there is no Riverside
 * here and there never will be. Every beat below is therefore walked against
 * a job THIS FILE BUILDS, on its own company, and the arithmetic is checked
 * against figures this file chose. That proves the MECHANISM the beat rests
 * on. It cannot prove any figure the run sheet quotes about Riverside.
 *
 * Where a beat needs data this environment cannot produce at all, it is NOT
 * substituted with something else wearing the beat's name. It is recorded as
 * unreachable, with the specific reason, in a test that asserts the reason —
 * see steps 8 and 9. A `test.skip()` would be the wrong tool: `e2e/verdicts.mjs`
 * treats a skip as a failure, deliberately and with no opt-out, because a
 * suite that skipped 18 specs and exited 0 is the vacuous green this whole
 * directory exists to end.
 *
 * TWO BEATS CALL A LIVE MODEL AND THIS SUITE CANNOT. `playwright.config.ts`
 * FORCES `ANTHROPIC_API_KEY: ""` into the server under test — not "leaves it
 * unset", forces it, so that no spec can spend a model call by accident
 * (there is a scar behind that: an eval run once emptied the shared
 * balance). Beats 2 and 3 are the run sheet's two model beats. Step 2 below
 * proves the absence FROM THE SCREEN rather than asserting it from this
 * comment, and if somebody ever removes that override, step 2 goes red
 * naming it — which is the correct alarm, because it would mean this suite
 * had started billing Anthropic.
 *
 * ════════════════════════════════════════════════════════════════════════
 * THE THREE THINGS THIS FILE FOUND WRONG WITH THE RUN SHEET
 * ════════════════════════════════════════════════════════════════════════
 *
 * They are assertions rather than footnotes, so that a later change to the
 * product turns them red instead of leaving a stale note on `main`.
 *
 *   1. BEAT 2'S "RIGHT" CONDITION CANNOT HAPPEN, AND THE SHEET TELLS HIM TO
 *      RETAKE WHEN THE APP IS CORRECT (step 7). The sheet says the retainage
 *      total "matches the rail figure", and that a difference "by any amount"
 *      means stop and retake. The rail's "Getting paid" figure is
 *      `unbilledContractValue + retainageHeld` (lib/moneyRail.ts), and its
 *      own caption on screen says so: "Active contract value not yet
 *      invoiced, plus retainage held". So it equals retainage held only on a
 *      company whose active jobs are billed to the last dollar. Step 7 builds
 *      exactly the ordinary case — one contracted job, part billed — and
 *      measures the gap.
 *
 *   2. BEAT 4'S "CO #2" TAG IS NOT ON THE TAB BEAT 4 STAYS ON (step 6). The
 *      sheet's clicks keep the camera on the Estimate tab and then say to
 *      point at "the new line tagged CO #2". The `CO #n` badge is rendered by
 *      `components/ContractSummary.tsx`, which the Estimate tab does not use
 *      — it is on the job OVERVIEW tab. The contract total and % complete DO
 *      move on the Estimate tab; the tag does not appear there.
 *
 *   3. BEAT A'S FALLBACK DESCRIBES A STATE THE PRODUCT CANNOT REACH (step 8).
 *      The sheet says "Nothing is red → a payroll register was imported".
 *      `lib/wh347.ts` adds `statementOfCompliance` to the blocking set
 *      UNCONDITIONALLY — page 2 of the form is not built — so `fileable` is
 *      false on every week of every job forever and the red banner cannot be
 *      absent. Good news for the take; a false sentence on the sheet.
 *
 * ════════════════════════════════════════════════════════════════════════
 * HOW IT AVOIDS PASSING VACUOUSLY
 * ════════════════════════════════════════════════════════════════════════
 *
 * CLAUDE.md's most-repeated scar is a check that answers a question nobody
 * asked — a watcher that fired on the first tick because its needle was
 * already on the page, once from a pre-existing row and once from a form's
 * own live preview. Four specific defences here:
 *
 *   - Every money and percent assertion is an EXACT figure this file put
 *     there, read back from the server after a reload, and every one of them
 *     is asserted as a CHANGE from a value captured first. "Contract value
 *     rose by exactly the proposal amount" is checked as before/after
 *     arithmetic, not as the presence of a string.
 *   - The retainage beat asserts an empty state DISAPPEARING: the Retainage
 *     tab's `[data-retainage-empty]` element must be present before the pay
 *     application and gone after it. A page that failed to render would fail
 *     the "present" half; a page that never billed anything would fail the
 *     "gone" half.
 *   - Step 9 does NOT look for the string "can't be judged" on
 *     /union-compliance, even though that is exactly what beat B points the
 *     camera at. That string is in the page's standing explanatory paragraph,
 *     which renders on an empty company with no union data at all — so a
 *     check for it would go green here and mean nothing. It is written down
 *     because it is the trap the next person will walk into.
 *   - Every step calls `expectHealthy`, so a page showing an error boundary
 *     fails naming the sentence it found rather than failing later on a
 *     locator and being written up as a broken feature.
 *
 * SERIAL, on SHOOT's own company, because the run sheet is itself serial —
 * beat 5 bills the line beat 4 created — and because beat 5 creates an
 * INVOICE, which this product cannot delete. See lib/personas.ts.
 */
test.describe("the launch-video run sheet, beat by beat", () => {
  test.describe.configure({ mode: "serial", retries: 0, timeout: 180_000 });

  const JOB_NAME = "ZZ-E2E Shoot — Beat rehearsal job";
  const GC_NAME = "ZZ-E2E Shoot GC";

  /**
   * The base estimate line. Every figure below is derived from these four
   * numbers rather than written twice, so a change here cannot leave a stale
   * expectation somewhere down the file.
   *
   * `budgetedUnitCost` is load-bearing and not decoration: `% complete` is
   * `costOnForecastLines / forecastCost` (lib/wip.ts), and `forecastCost`
   * comes from `currentEstimatedUnitCost`, which the create actions default
   * from `budgetedUnitCost`. With no cost figure at all the WIP block renders
   * "—" for % complete and beat 4's third promise has nothing to move.
   */
  const LINE = {
    description: '5/8" Type X drywall, level 3 corridor',
    quantity: "2000",
    unit: "SF",
    unitPrice: "3.00",
    budgetedUnitCost: "2.00",
  };
  /** 2000 × $3.00. */
  const BASE_CONTRACT = 6000;
  /** 2000 × $2.00 — the cost forecast % complete divides by. */
  const BASE_FORECAST = 4000;
  /** Logged against the base line, so % complete is a real number and not 0%. */
  const COST_LOGGED = 1000;
  /** 1000 / 4000. */
  const PERCENT_BEFORE = "25.0%";

  /** The change order's added scope — beat 4's "proposal amount" is 100 × $20. */
  const CO_LINE = { description: "2-hr rated deflection track at mechanical rooms", unit: "LF", quantity: "100", unitPrice: "20.00", budgetedUnitCost: "10.00" };
  const CO_VALUE = 2000;
  /** 1000 / (4000 + 1000). The move beat 4 promises, worked out rather than observed. */
  const PERCENT_AFTER = "20.0%";

  /** Beat 5 types percents, never dollars — that is the whole line of the
   * beat ("I didn't type a single dollar figure"). Two rows, not the sheet's
   * three, because this job has two schedule-of-values lines and Riverside
   * has four plus a change order. Said here rather than quietly differing. */
  const PCT_BASE = 62;
  const PCT_CO = 48;
  const RETAINAGE_PERCENT = 10;

  const billedBase = (BASE_CONTRACT * PCT_BASE) / 100; // 3720
  const billedCo = (CO_VALUE * PCT_CO) / 100; // 960
  const INVOICE_TOTAL = billedBase + billedCo; // 4680
  const RETAINAGE_WITHHELD = (INVOICE_TOTAL * RETAINAGE_PERCENT) / 100; // 468
  const CONTRACT_AFTER_CO = BASE_CONTRACT + CO_VALUE; // 8000
  const UNBILLED_AFTER = CONTRACT_AFTER_CO - INVOICE_TOTAL; // 3320
  /** What the rail's "Getting paid" stage actually is. Beat 2's sheet says
   * this should equal RETAINAGE_WITHHELD; it is that plus UNBILLED_AFTER. */
  const RAIL_GETTING_PAID = UNBILLED_AFTER + RETAINAGE_WITHHELD; // 3788

  /** The rail stage's own caption (lib/moneyRail.ts). Used as the handle for
   * the figure AND asserted as text, so that a rail redefined to mean
   * something else fails here instead of silently agreeing with the sheet. */
  const GETTING_PAID_DETAIL = "Active contract value not yet invoiced, plus retainage held";

  let page: Page;
  let monitor: HealthMonitor;
  let jobId: string;
  let coNumber: number;

  const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  /**
   * A labelled figure out of one of this app's stat grids — the
   * `<p>label</p><p>value</p>` pair the Estimate tab's WIP block and the
   * Retainage tab both use.
   *
   * By XPath on an EXACT label, and the count is asserted, for a measured
   * reason: the Estimate tab also renders per-line spans reading
   * "% complete 25.0%", and a substring locator would resolve to both and
   * then silently read whichever Playwright reached first. A locator that is
   * ambiguous must fail as a defect in this spec, which is a different thing
   * from a broken page and must not be reported as one.
   */
  async function statValue(label: string): Promise<string> {
    const cell = page.locator(`xpath=//p[normalize-space(text())=${JSON.stringify(label)}]/following-sibling::p[1]`);
    await expect(cell, `"${label}" should be exactly one labelled figure on ${page.url()}`).toHaveCount(1);
    return (await cell.innerText()).trim();
  }

  /** `$3,788.00` → 3788. Fails loudly rather than returning NaN for a caller
   * to compare against a number and pass. */
  function dollars(text: string, where: string): number {
    const match = text.match(/-?\$[\d,]+\.\d\d/);
    expect(match, `${where}: "${text}" does not contain a dollar figure`).not.toBeNull();
    return Number(match![0].replace(/[$,]/g, ""));
  }

  /**
   * RUNS A SERVER ACTION AND WAITS FOR *ITS* POST, THEN FOR A CONSEQUENCE ON
   * SCREEN. Both halves are scars from this file's own CI runs.
   *
   * `settleAction` in lib/journey.ts waits for `response.request().method()
   * === "POST"` — the FIRST post of any kind. A signed-in page is not quiet:
   * Clerk's client talks to its own FAPI host over POST, so that wait can be
   * satisfied by a request that has nothing to do with the action, and the
   * `page.reload()` after it then navigates out from under the write it was
   * about to check. On the third CI run of this file that is what beat 4
   * looked like from the outside: `settleAction` returned, the reload
   * happened, and the contract total "moved by $0.00" — the same code having
   * passed twice before it with the figure exactly right. So the POST is
   * filtered to THIS ORIGIN, which is where a Next Server Action posts.
   *
   * And a filtered POST is still only "the server answered". The second
   * argument is the thing on screen that cannot be there until the write
   * landed, which is what the repo's own discipline asks for — assert the
   * accepted state, not the request. Given both, a flake has to beat two
   * independent checks.
   */
  async function settleOnThisOrigin(what: string, run: () => Promise<unknown>, landed?: Locator): Promise<void> {
    const origin = new URL(page.url()).origin;
    const posted = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().startsWith(origin),
    );
    await run();
    await posted;
    if (landed) {
      await expect(
        landed,
        `${what}: the action's POST came back and nothing on screen said it had landed`,
      ).toBeVisible({ timeout: 20_000 });
    }
  }

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  // ─────────────────────────────────────────────────────────── beat 1
  test("beat 1: /dashboard loads signed in, and nothing is thrown", async () => {
    await signInAs(page, PERSONAS.shoot.email);
    await landOnDashboard(page, monitor);

    // The run sheet's own pre-flight, in the order it gives it: the app
    // shell, then the rail, then the Ask launcher beat 2 clicks into. Beat 1
    // is filmed with the cursor still, so "it rendered" IS the whole beat —
    // which is why `expectHealthy` (no crash sentence, no uncaught
    // exception, real content, the shell's navigation) is the assertion and
    // not a warm-up for one.
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.locator("[data-ask-launcher]")).toBeVisible();
  });

  // ─────────────────────────────────────────────────────── beats 2 & 3
  test("beats 2 and 3 are NOT proved here: this environment has no model, said by the screen", async () => {
    // THE HONEST RECORD, ASSERTED RATHER THAN COMMENTED.
    //
    // Beat 2 asks the assistant for retainage by job; beat 3 asks it who
    // showed up and requires a REFUSAL. Both are answers from a live model,
    // and `playwright.config.ts` forces `ANTHROPIC_API_KEY: ""` into the
    // server under test. So there is no answer to judge, and stubbing
    // `/api/ask` to produce one would test the stub — the same objection
    // `ai-switch.spec.ts` states about asserting its own refusals.
    //
    // What IS worth proving is the run sheet's own pre-flight step: Settings
    // → Assistant → "Check connection" tells him, before the camera rolls,
    // whether beats 2 and 3 can be filmed at all. That button works here, and
    // what it says here is the reason those two beats are unproved.
    await page.goto("/settings/assistant");
    await expectHealthy(page, "/settings/assistant", { monitor });

    // Absence is not the AI switch being off — that would be a different
    // sentence and a different fix. Asserted first so the refusal below can
    // only be about the key.
    await expect(page.locator('input[name="aiEnabled"]')).toBeChecked();
    await expect(page.locator('input[type="checkbox"][name="feature:ASK"]')).toBeChecked();

    await page.getByRole("button", { name: "Check connection" }).click();

    // `lib/ask/connection.ts`'s `not_configured` sentence, verbatim. If this
    // ever fails because the check CONNECTED, the override above was removed
    // and this suite has started spending real model calls on every run —
    // which is the alarm, not the inconvenience.
    await expect(
      page.getByText("No Anthropic API key is set on this server."),
      "the e2e server is built with a blank ANTHROPIC_API_KEY on purpose, so beats 2 and 3 cannot be rehearsed by a machine — they have to be walked by hand against a deployment that has a key",
    ).toBeVisible();
  });

  // ─────────────────────────────────── the job every later beat needs
  test("build the job the shoot's beats act on (Riverside's stand-in, and not Riverside)", async () => {
    jobId = await startJob(page, monitor, {
      name: JOB_NAME,
      scope: "Metal stud framing, hang, tape and finish, level 3.",
      gcName: GC_NAME,
    });
    await submitLineItem(page, LINE);
    const row = estimateRow(page, LINE.description);
    await expect(row).toBeVisible();
    await expect(row).toContainText(money(BASE_CONTRACT));

    await finishWizard(page, monitor, jobId);
    await recordExecutedSubcontract(page, monitor, jobId);
    await markContracted(page, monitor, jobId);
  });

  test("set retainage at 10% BEFORE anything is billed — beat 5's figures depend on the order", async () => {
    // `Invoice.retainageWithheld` is snapshotted when the invoice is created
    // (lib/actions/billing.ts), so a percentage saved after the pay
    // application withholds nothing on it. The run sheet has beat 5 walk
    // Billing → Retainage in that order and never mentions setting a rate,
    // because the demo seed already carries 5% on Riverside. On a fresh job
    // it is a prerequisite, and getting it wrong shows up as a Retainage tab
    // reading $0.00 with no explanation.
    await jobTab(page, "Retainage").click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/retainage$`));
    await expectHealthy(page, "retainage tab", { monitor });

    // THE EMPTY STATE, ASSERTED HERE SO ITS DISAPPEARANCE IN STEP 7 MEANS
    // SOMETHING. Nothing is billed yet, so the tab must be showing its
    // "Nothing withheld yet" panel rather than three figures.
    await expect(page.locator("[data-retainage-empty]")).toHaveCount(1);

    const form = retainageForm(page);
    await settleOnThisOrigin("saving the retainage percentage", async () => {
      await form.locator('input[name="retainagePercent"]').fill(String(RETAINAGE_PERCENT));
      await form.getByRole("button", { name: "Save" }).click();
    });

    await page.reload();
    await expectHealthy(page, "retainage tab after saving 10%", { monitor });
    await expect(retainageForm(page).locator('input[name="retainagePercent"]')).toHaveValue(
      String(RETAINAGE_PERCENT),
    );
  });

  test("log a cost, so beat 4's third promise (% complete moves) has something to move", async () => {
    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "estimate tab", { monitor });

    // Exactly one line item exists at this point, so exactly one "Log cost"
    // form does. Asserted rather than assumed: after the change order lands
    // there will be two, and a spec that silently logged against whichever
    // one it found first would make every figure below unreproducible.
    const costForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Log cost" }) });
    await expect(costForm, "one line item, one cost form").toHaveCount(1);

    await settleOnThisOrigin(
      "logging a cost against the base line",
      async () => {
        await costForm.locator('input[name="description"]').fill("ZZ-E2E Shoot — board delivery");
        await costForm.locator('input[name="amount"]').fill(String(COST_LOGGED));
        await costForm.getByRole("button", { name: "Log cost" }).click();
      },
      // The cost row the estimate tab renders under its line. It cannot be on
      // the page before the write.
      page.getByText("ZZ-E2E Shoot — board delivery"),
    );

    await page.reload();
    await expectHealthy(page, "estimate tab after logging a cost", { monitor });

    // Read back from the server. These two are beat 4's "before" figures and
    // the whole beat is the arithmetic between them and the "after" ones.
    expect(await statValue("Contract value")).toBe(money(BASE_CONTRACT));
    expect(await statValue("Actual cost to date")).toBe(money(COST_LOGGED));
    expect(
      await statValue("% complete"),
      `${COST_LOGGED} of a ${BASE_FORECAST} cost forecast — if this reads "—" the line carries no cost forecast and beat 4 has no third promise to keep`,
    ).toBe(PERCENT_BEFORE);
  });

  // ─────────────────────────────────────────────────────────── beat 4
  test("beat 4: approving the change order moves the contract total by exactly the proposal, and % complete with it", async () => {
    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "estimate tab, at the change orders section", { monitor });

    const contractBefore = dollars(await statValue("Contract value"), "contract value before the CO");
    const percentBefore = await statValue("% complete");
    expect(contractBefore).toBe(BASE_CONTRACT);
    expect(percentBefore).toBe(PERCENT_BEFORE);

    // Beat 4 as the sheet writes it opens an EXISTING pending change order
    // ("Upgrade to Type X at mechanical rooms") that the demo seed put on
    // Riverside. There is none here, so the draft is raised through the same
    // three screens a person uses — which tests more of the product, and is
    // the reason the CO number below is #1 and not the sheet's #2.
    const draftForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Start draft" }) });
    await settleOnThisOrigin(
      "starting the change-order draft",
      async () => {
        await draftForm.locator('input[name="title"]').fill("Upgrade to Type X at mechanical rooms");
        await draftForm.locator('input[name="description"]').fill("Architect's RFI response — two-hour rated wall not on bid drawings.");
        await draftForm.getByRole("button", { name: "Start draft" }).click();
      },
      page.getByText(/CO #\d+: Upgrade to Type X at mechanical rooms/),
    );
    await page.reload();
    await expectHealthy(page, "estimate tab with a change-order draft", { monitor });

    // The number the badge must carry, read off the card rather than assumed
    // to be 1. `ChangeOrderCounter` only increments, so a re-run against a
    // scratch database that was not recreated gets #2, #3 … and the badge
    // assertion below has to follow it.
    const card = page.locator("li").filter({ hasText: "Upgrade to Type X at mechanical rooms" }).first();
    const heading = await card.locator("p").first().innerText();
    const numberMatch = heading.match(/CO #(\d+)/);
    expect(numberMatch, `the change-order card should name its number — got "${heading}"`).not.toBeNull();
    coNumber = Number(numberMatch![1]);

    // "Add scope" is the default kind, so the ADD form is already on screen.
    const addForms = page.locator("form").filter({ has: page.getByRole("button", { name: "Add to CO" }) });
    await expect(addForms, "one draft change order, one open proposal form").toHaveCount(1);
    const addForm = addForms.first();
    await settleOnThisOrigin(
      "adding the priced scope to the draft",
      async () => {
      await addForm.locator('input[name="itemDescription"]').fill(CO_LINE.description);
      await addForm.locator('input[name="unit"]').fill(CO_LINE.unit);
      await addForm.locator('input[name="quantity"]').fill(CO_LINE.quantity);
      await addForm.locator('input[name="unitPrice"]').fill(CO_LINE.unitPrice);
      await addForm.locator('input[name="budgetedUnitCost"]').fill(CO_LINE.budgetedUnitCost);
      await addForm.getByRole("button", { name: "Add to CO" }).click();
      },
      // The proposal row on the card. Nothing renders it until the proposal
      // exists, and "Send to GC" stays disabled while there are none.
      page.getByText(CO_LINE.description).first(),
    );
    await page.reload();
    await expectHealthy(page, "estimate tab with a priced proposal on the draft", { monitor });

    // A DRAFT MOVES NOTHING. The sheet's own line — "Until the GC says yes,
    // it's nowhere: not in my contract, not in my billing" — is a claim about
    // the product, and it is checked here rather than trusted. If this fails,
    // beat 4's narration is wrong before the Approve click.
    expect(
      dollars(await statValue("Contract value"), "contract value with the proposal still a draft"),
      "a drafted change order must not be in the contract value — beat 4 says so out loud",
    ).toBe(BASE_CONTRACT);

    await settleOnThisOrigin(
      "sending the change order to the GC",
      async () => {
        await page.getByRole("button", { name: "Send to GC" }).first().click();
      },
      // The status chip the SUBMITTED band renders, and the Decision panel's
      // own buttons — neither exists on a draft.
      page.getByRole("button", { name: "Approve", exact: true }).first(),
    );
    await page.reload();
    await expectHealthy(page, "estimate tab with the change order sent", { monitor });

    // Still nothing, now that it is with the GC and not a draft — the sheet
    // calls this a PCO and says it is not in the contract sum.
    expect(
      dollars(await statValue("Contract value"), "contract value while the CO is pending with the GC"),
      "a change order sent but not answered must not be in the contract value",
    ).toBe(BASE_CONTRACT);

    // [press Approve]
    //
    // THE ONE PRESS THE WHOLE BEAT IS ABOUT, so it waits for the state
    // change and not for a request. "Executed" is `STATUS_LABEL.APPROVED`
    // (components/changeOrderStates.ts) and is the chip the card grows only
    // once the approval has been written; the Decision panel that carried
    // this very button is gone by then. Without this the reload below can
    // race the write, and what that looks like is "the contract total moved
    // by $0.00" — a sentence that reads like the product being broken.
    await settleOnThisOrigin(
      "approving the change order",
      async () => {
        await page.getByRole("button", { name: "Approve", exact: true }).first().click();
      },
      page.getByText("Executed", { exact: true }).first(),
    );
    await page.reload();
    await expectHealthy(page, "estimate tab after approving the change order", { monitor });

    // PROMISE 1 — "Contract value went up by exactly that."
    const contractAfter = dollars(await statValue("Contract value"), "contract value after approval");
    expect(
      contractAfter - contractBefore,
      `the contract total moved by ${money(contractAfter - contractBefore)} and the proposal was ${money(CO_VALUE)} — beat 4 reads both numbers out loud on camera, so this arithmetic IS the beat`,
    ).toBe(CO_VALUE);
    expect(contractAfter).toBe(CONTRACT_AFTER_CO);

    // PROMISE 3 — "Percent complete moved." A CHANGE, not a value: the same
    // cost over a larger forecast.
    const percentAfter = await statValue("% complete");
    expect(percentAfter, "% complete must not read the same before and after the approval").not.toBe(percentBefore);
    expect(percentAfter).toBe(PERCENT_AFTER);

    // PROMISE 2 — "a new line tagged CO #n" — AND THE RUN SHEET SENDS THE
    // CAMERA TO THE WRONG TAB FOR IT.
    //
    // The badge is rendered by components/ContractSummary.tsx, and the
    // Estimate tab does not render that component: the job OVERVIEW does.
    // Both halves are asserted, because the useful finding is not "the tag
    // exists" but "it is not where beat 4 points".
    //
    // Counted as a TABLE ROW carrying both the scope and the badge, not as
    // the string "CO #n" — which IS on the Estimate tab, on the change-order
    // card's own heading ("CO #1: Upgrade to Type X at mechanical rooms").
    // A bare string check here would find that heading and report the sheet
    // as correct, which is the needle-already-on-the-page trap doing its
    // usual work. What beat 4 points at is a SCHEDULE LINE wearing a tag.
    const taggedLineOn = async () =>
      page
        .locator("tr")
        .filter({ hasText: CO_LINE.description })
        .filter({ hasText: `CO #${coNumber}` })
        .count();
    const taggedOnEstimate = await taggedLineOn();
    // The contract summary as a whole is absent from the Estimate tab, which
    // is the reason the tag is: its total line is the cheapest proof.
    const summaryTotalOnEstimate = await page.getByText(/^Total: \$[\d,]+\.\d\d$/).count();

    await page.goto(`/jobs/${jobId}`);
    await expectHealthy(page, "job overview after approving the change order", { monitor });
    const contractRow = page.locator("tr").filter({ hasText: CO_LINE.description });
    await expect(contractRow, "the change order's scope should be a line on the contract summary").toHaveCount(1);
    await expect(
      contractRow.getByText(`CO #${coNumber}`),
      "the contract summary's line should carry the change-order badge",
    ).toBeVisible();
    await expect(page.getByText(`Total: ${money(CONTRACT_AFTER_CO)}`)).toBeVisible();

    expect(
      { taggedOnEstimate, summaryTotalOnEstimate },
      `the run sheet keeps beat 4 on the Estimate tab and then says to point at "the new line tagged CO #${coNumber}". That badge is rendered by components/ContractSummary.tsx, which only the job OVERVIEW tab uses — the Estimate tab showed ${taggedOnEstimate} tagged schedule lines and ${summaryTotalOnEstimate} contract-summary totals. If this ever goes red because both are 1, the sheet has become right and this assertion should be deleted rather than loosened.`,
    ).toEqual({ taggedOnEstimate: 0, summaryTotalOnEstimate: 0 });
    expect(await taggedLineOn(), "the OVERVIEW tab is where the tagged line is").toBe(1);
  });

  // ─────────────────────────────────────────────────────────── beat 5
  test("beat 5: percents in and no dollars typed, a G702 block above the G703 grid, and retainage worked out from it", async () => {
    await page.goto(`/jobs/${jobId}/billing`);
    await expectHealthy(page, "billing tab", { monitor });

    await expect(page.getByText("No pay applications submitted yet.")).toBeVisible();
    await page.getByRole("button", { name: "Submit pay application" }).click();

    // THE % BOX HAS NO `name` AND IS NEVER SUBMITTED. It fills the money box
    // beside it, on BLUR or Enter only (components/PayApplications.tsx), and
    // deliberately not on every keystroke. So a person who types the last
    // percent and goes straight to the button submits without it — which is
    // exactly the failure the run sheet describes as "you typed no
    // percentages, so it has no line items". `press("Enter")` is what the
    // component treats as "this number has settled", and it is what beat 5
    // depends on.
    for (const [description, pct] of [
      [LINE.description, PCT_BASE],
      [CO_LINE.description, PCT_CO],
    ] as const) {
      const box = page.getByLabel(`Percent complete on ${description}`);
      await box.fill(String(pct));
      await box.press("Enter");
      // The component's own note, which only appears once the percent has
      // been converted into dollars. Waiting on it rather than on a timeout
      // is what makes this a settled figure rather than a hopeful one.
      await expect(page.getByText(`Takes this line to ${pct.toFixed(1)}% complete`)).toBeVisible();
    }

    // The running total the form computes through the SAME parse the action
    // uses. Asserted before the submit, so a wrong figure is caught while it
    // is still only a form.
    await expect(
      page.getByText(`This application comes to ${money(INVOICE_TOTAL)}`),
      "the form's own total must agree with 62% of the base line plus 48% of the change-order line",
    ).toBeVisible();

    await settleOnThisOrigin(
      "submitting the pay application",
      async () => {
        await page.getByRole("button", { name: "Submit pay application" }).click();
      },
      // THE NUMBERED APPLICATION, not the form closing. The form's own
      // submit button and the opener that replaces it carry THE SAME LABEL,
      // so "the opener came back" is satisfied by the button that was
      // already on screen — the needle-already-on-the-page trap, one
      // refactor deep. A link reading "Application #n" cannot exist until
      // the invoice does.
      page.getByRole("link", { name: /^Application #\d+$/ }),
    );
    await page.reload();
    await expectHealthy(page, "billing tab after submitting the pay application", { monitor });

    // The empty state is gone and a numbered application is there — both
    // halves, because either alone is satisfiable by a broken page.
    await expect(page.getByText("No pay applications submitted yet.")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Application #\d+$/ })).toHaveCount(1);

    // "View pay application →" is on the INVOICE, in the Invoices section
    // above — not in the Pay applications list, whose link reads
    // "Application #n". The run sheet's click list says the former; worth
    // knowing they are two different links to the same page.
    const view = page.getByRole("link", { name: "View pay application →" });
    await expect(
      view,
      "the invoice should offer its continuation sheet — the run sheet's check that the percents actually reached the server",
    ).toHaveCount(1);
    await view.click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/pay-applications/[^/]+$`));
    await expectHealthy(page, "the pay application document", { monitor });

    // THE G702 BLOCK ABOVE THE G703 GRID, MEASURED RATHER THAN ASSUMED.
    // Real Chromium is the only instrument that can answer "above": the unit
    // suite runs in happy-dom, where getBoundingClientRect returns zeros
    // (CLAUDE.md, the "Cancel inherits the delete pixel" entry).
    const g702 = page.locator("div").filter({ hasText: "Contract sum to date" }).last();
    const g703 = page.locator("table").first();
    await expect(g702).toBeVisible();
    await expect(g703).toBeVisible();
    const summaryBox = await g702.boundingBox();
    const gridBox = await g703.boundingBox();
    expect(summaryBox, "the G702 summary block should have a box").not.toBeNull();
    expect(gridBox, "the G703 continuation grid should have a box").not.toBeNull();
    expect(
      summaryBox!.y + summaryBox!.height,
      `the G702 summary ends at y=${summaryBox!.y + summaryBox!.height} and the G703 grid starts at y=${gridBox!.y} — beat 5 says the summary sits ABOVE the grid`,
    ).toBeLessThanOrEqual(gridBox!.y);

    // The six G702 lines the document promises, and the one figure the beat
    // could get wrong without anyone noticing: current payment due is the
    // application net of retainage.
    for (const label of [
      "Contract sum to date",
      "Total completed & stored to date",
      "Retainage to date",
      "Total earned less retainage",
      "Less previous certificates for payment",
      "Current payment due",
    ]) {
      await expect(page.getByText(label, { exact: true }), `the G702 block should carry "${label}"`).toBeVisible();
    }
    expect(await statValue("Contract sum to date")).toBe(money(CONTRACT_AFTER_CO));
    expect(await statValue("Total completed & stored to date")).toBe(money(INVOICE_TOTAL));
    expect(await statValue("Retainage to date")).toBe(money(RETAINAGE_WITHHELD));
    expect(await statValue("Current payment due")).toBe(money(INVOICE_TOTAL - RETAINAGE_WITHHELD));

    // [Retainage tab] "withheld, released, still out. Worked out from the
    // invoices, not from memory."
    await page.goto(`/jobs/${jobId}/retainage`);
    await expectHealthy(page, "retainage tab after the pay application", { monitor });
    await expect(
      page.locator("[data-retainage-empty]"),
      "the Retainage tab's empty state must be GONE now that an invoice has withheld something — this is the half of the assertion that could not have been true before the submit",
    ).toHaveCount(0);
    expect(await statValue("Total withheld")).toBe(money(RETAINAGE_WITHHELD));
    expect(await statValue("Total released")).toBe(money(0));
    expect(await statValue("Outstanding balance")).toBe(money(RETAINAGE_WITHHELD));

    // The sheet says there is no "Expected release" line on Riverside and
    // that this is correct, not missing. Same here, and for the same reason:
    // it is gated on the job's expected substantial-completion date, which
    // nobody has entered.
    await expect(page.getByText(/^Expected release:/)).toHaveCount(0);
  });

  // ────────────────────────────────────────────── union add-on, beat A
  test("beat A: the WH-347 refuses to look finished, and it can never stop refusing", async () => {
    await page.goto(`/jobs/${jobId}/crew`);
    await expectHealthy(page, "crew & time tab", { monitor });

    await page.getByRole("link", { name: "Certified payroll report →" }).click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/certified-payroll`));
    await expectHealthy(page, "certified payroll for the week", { monitor });

    await page.getByRole("link", { name: "Form WH-347 for this week →" }).click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/certified-payroll/wh-347`));
    await expectHealthy(page, "form WH-347", { monitor });
    await expect(page.getByRole("heading", { name: "Form WH-347" })).toBeVisible();

    // THE RED BANNER, AND THE COUNT IN IT. A banner reading "0 things are
    // missing" would satisfy a substring check and refute the beat.
    const banner = page.getByText(/^This is not ready to file\. \d+ things? (is|are) missing\./);
    await expect(banner, "beat A's whole point is on this banner").toBeVisible();
    const countMatch = (await banner.innerText()).match(/(\d+) things?/);
    expect(countMatch, "the banner should say how many things are missing").not.toBeNull();
    expect(
      Number(countMatch![1]),
      "a banner that names nothing is the beat failing, not passing",
    ).toBeGreaterThan(0);

    // IT NAMES THE BOXES. The beat's line is "it names every box it can't
    // fill", so the list is the evidence and not the headline — and the list
    // is read out of THE BANNER, not out of any `ul` on the page, so a
    // sidebar or a form's own list cannot stand in for it.
    const bannerPanel = page.locator("div").filter({ has: page.getByText(/^This is not ready to file\./) }).last();
    const reasons = bannerPanel.locator("li");
    const reasonCount = await reasons.count();
    expect(
      reasonCount,
      "the banner should list the fields it cannot fill — a red panel naming nothing is the beat failing",
    ).toBe(Number(countMatch![1]));
    for (const text of await reasons.allInnerTexts()) {
      expect(text.trim().length, "every named box should say what is missing, not just be a bullet").toBeGreaterThan(20);
    }

    // ════════════════════════════════════════════════════════════════════
    // THE RUN SHEET'S FALLBACK FOR THIS BEAT IS REACHABLE NOW, AND THIS
    // COMMENT SAID THE OPPOSITE.
    //
    // It read: the sheet's "Nothing is red → a payroll register was imported"
    // branch "cannot happen", because `lib/wh347.ts` added
    // `statementOfCompliance` to the blocking set unconditionally, so
    // `fileable` was false on every week of every job, register or no
    // register. Every word of that was true when it was written, and it is
    // the reason the assertion under it pinned the sentence "It is not built
    // yet." Page 2 is built, that sentence is gone, and this assertion was
    // RED the moment it went.
    //
    // What is true now: the blocker clears when page 2's facts are recorded
    // (who signs, their title, the section 4 fringe election) AND the job
    // carries a contract number. The demo job has neither, so beat A's
    // redness still holds for the shoot — but it is now a state somebody can
    // leave rather than one nothing can reach, so the shooter's fallback is a
    // line he could actually deliver on a job that has been filled in.
    //
    // Pinned on the NEW sentence, which names what to do instead of saying
    // the feature does not exist.
    // ════════════════════════════════════════════════════════════════════
    await expect(
      page.getByText(/Page 2, the Statement of Compliance, needs the person who will sign it/),
      "the statement-of-compliance blocker should now say what to fill in, not that page 2 is unbuilt",
    ).toBeVisible();

    // AND THE FORM THAT CLEARS IT IS ON THE PAGE. The blocker naming a thing
    // to do is only useful if the thing is reachable from here — this whole
    // session has been about features that work and cannot be reached.
    await expect(
      page.getByRole("heading", { name: "Page 2 — Statement of Compliance" }),
      "the blocker tells the reader to fill page 2 in below, so it has to be below",
    ).toBeVisible();
    await expect(
      page.getByText("Paid to approved plans, funds or programs — section 4(a)"),
      "the section 4 election is the fact C Stream cannot derive, so the form must offer it",
    ).toBeVisible();

    // SEVEN DATED DAY COLUMNS — the other half of beat A's promise, and the
    // one that would break silently if the week arithmetic ever drifted.
    // Counted out of the form's own header cell, and checked for being seven
    // CONSECUTIVE days rather than just seven of something.
    const dayHeader = page.locator("th").filter({ hasText: "(4) Day and Date" });
    await expect(dayHeader).toHaveCount(1);
    const dates = (await dayHeader.innerText()).match(/\b\d{1,2}\/\d{1,2}\b/g) ?? [];
    expect(dates, `the WH-347 header should carry seven dated columns — found ${dates.length}: ${dates.join(", ")}`).toHaveLength(7);
    // The eighth cell in that grid is the "Hours Worked Each Day" label, not
    // a day. Asserted so that a regression adding an eighth DATE (the
    // eight-day-window defect the certified-payroll page's own comment
    // records) fails here rather than printing a foreign Sunday on a filing.
    await expect(dayHeader.getByText("Hours Worked Each Day")).toBeVisible();
  });

  // ────────────────────────────────────────────── union add-on, beat B
  test("beat B is NOT reproducible here, and this is what the page says instead", async () => {
    // ════════════════════════════════════════════════════════════════════
    // SAID PLAINLY RATHER THAN SUBSTITUTED FOR.
    //
    // Beat B needs three differently-marked apprentice-ratio day verdicts
    // (clean / over-ratio with an amount / can't be judged) and an "hours
    // could not be priced" sentence. Producing those needs a union local,
    // tiered craft classifications AND one deliberately untiered one, fringe
    // rate schedules effective on the days worked, an apprentice ratio rule,
    // and several shaped days of time entries inside the current calendar
    // month. `seed-demo.mjs` builds all of it on purpose — the comment above
    // its `laborDays` table lists the verdict each day is engineered to
    // produce — and it exists only on the demo project.
    //
    // This company has none of it, so there is no ratio here to judge and
    // nothing to remit. Building it through the UI would be a second spec the
    // size of this one, and every figure in it would be one this file chose
    // rather than one the shoot will see. So beat B is UNPROVED, and what is
    // asserted instead is that the page is honest about having no data —
    // which is worth something on its own: an empty union page that showed a
    // clean bill of health would be the worst defect this product could have.
    //
    // WHAT IS DELIBERATELY NOT ASSERTED, AND WHY IT IS THE TRAP: the string
    // "can't be judged" IS on this page right now, in the standing paragraph
    // under the heading, on a company with no union data whatsoever. A check
    // that looked for it would go green here and prove nothing about any
    // day's verdict — the needle-already-on-the-page shape CLAUDE.md records
    // twice. Whoever writes the real beat-B check must assert a per-day
    // verdict element, not that phrase.
    // ════════════════════════════════════════════════════════════════════
    await page.goto("/union-compliance");
    await expectHealthy(page, "/union-compliance", { monitor });
    await expect(page.getByRole("heading", { name: "Union fringe & apprenticeship" })).toBeVisible();

    // The two sections beat B points at exist, and both say they have nothing.
    await expect(page.getByRole("heading", { name: "Fringe remittance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Apprentice ratio" })).toBeVisible();
    await expect(
      page.getByText("No hours logged this month against a craft classification, so there is nothing to remit."),
    ).toBeVisible();
    await expect(page.getByText("No hours logged this month, so there is no ratio to judge.")).toBeVisible();
    await expect(page.locator("[data-testid='uc-start-here']")).toBeVisible();

    // A DAY VERDICT, ASSERTED ABSENT. This is the assertion that makes the
    // sentence above honest: there is no verdict on this page, so nothing in
    // this test can be mistaken for having checked one.
    await expect(
      page.getByText(/went over the ratio/),
      "no ratio verdict exists on this company, which is precisely why beat B is recorded as unproved rather than checked",
    ).toHaveCount(0);
  });

  // ─────────────────────────────────────────────────────────── beat 6
  test("beat 6: the logo goes back to the dashboard, with every figure the shoot moved still there", async () => {
    // Beat 6's only click. The run sheet offers "or cut back to face to
    // camera" as the better option, so the failure mode here is mild — but
    // the click is in the sheet, and a logo that does not navigate is the
    // kind of thing nobody checks.
    await page.goto(`/jobs/${jobId}/billing`);
    await expectHealthy(page, "billing tab, before beat 6's click", { monitor });

    await page.getByRole("link", { name: /go to the dashboard$/ }).click();
    await page.waitForURL(/\/dashboard(\?|$)/);
    await expectHealthy(page, "dashboard, after beat 6's click", { monitor });
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();

    // 2026-09-21, as a sentence: an invoice existed and every authenticated
    // page rendered an error boundary. This shoot's beat 5 creates one, so
    // the last thing this file does is walk the three screens the camera is
    // on either side of it.
    for (const target of ["/jobs", `/jobs/${jobId}`, `/jobs/${jobId}/estimate`, "/cash-flow"]) {
      await page.goto(target);
      await expectHealthy(page, `after the shoot's invoice: ${target}`, { monitor });
    }
    await expect(page.locator("main").getByText(JOB_NAME).first()).toBeVisible();
  });

  // ──────────────────────────────────────────── beat 2's cross-check
  //
  // LAST ON PURPOSE, and the reason is this file's own first CI run. This
  // describe block is SERIAL, so a failure here skips every test after it —
  // and on the first run it failed on a locator (see inside) and took beats
  // A, B and 6 down with it, which came back as four SKIPPED verdicts and
  // proved nothing about three beats that were fine. Beats A, B and 6 are
  // read-only and depend on nothing here, so the cheapest fix is ordering:
  // the test most likely to be about a locator goes after the ones that are
  // about the product. It still needs beat 5 to have run, which it has.
  test("beat 2's cross-check: the rail's 'Getting paid' figure is NOT the retainage total, and the sheet says retake", async () => {
    // ════════════════════════════════════════════════════════════════════
    // THE FINDING WITH THE MOST AT STAKE TOMORROW MORNING.
    //
    // Beat 2's narration points at the rail and says "Same number down
    // there, because it's the same sum", and the sheet's Wrong branch reads:
    // "The two numbers differ by any amount → stop and retake. That match is
    // the entire claim of the beat."
    //
    // They are not the same sum. `lib/moneyRail.ts` builds the Getting paid
    // stage as `unbilledContractValue + retainageHeld`, and prints that
    // definition on screen as the stage's own caption. On any company with
    // work left to invoice — which is every company that is trading — the
    // rail figure is LARGER than retainage held, by exactly the value not yet
    // billed.
    //
    // So the retake instruction fires on correct behaviour, and following it
    // costs the morning. Measured here on the smallest honest case: one
    // contracted job, part billed.
    // ════════════════════════════════════════════════════════════════════
    await page.goto("/dashboard");
    await expectHealthy(page, "dashboard, reading the money rail", { monitor });

    const railStage = page.locator(`nav[aria-label="Main"] [title=${JSON.stringify(GETTING_PAID_DETAIL)}]`);
    await expect(
      railStage,
      "the rail's Getting paid stage is found by its own caption — if this caption has changed, the stage may no longer mean what this test measures",
    ).toHaveCount(1);
    const railText = await railStage.innerText();
    expect(railText, "the rail stage should label itself").toContain("Getting paid");
    const railFigure = dollars(railText, "the rail's Getting paid figure");

    // The retainage total the assistant's own retainage answer sums, and the
    // figure /cash-flow puts on screen under "Retainage receivable".
    await page.goto("/cash-flow");
    await expectHealthy(page, "/cash-flow", { monitor });

    // ════════════════════════════════════════════════════════════════════
    // AND A FOURTH THING FOR WHOEVER POINTS A CAMERA AT THIS PAGE:
    // /cash-flow SAYS "Total outstanding" TWICE, ABOUT TWO DIFFERENT SUMS.
    //
    // One is the AR aging total, NET of retainage; the other is the
    // retainage receivable. Same three words, same type size, one section
    // apart. This spec's first run pinned the label without a section and
    // failed on the count rather than reading whichever one Playwright
    // reached first — which is the only reason it is written down here
    // instead of having produced a confidently wrong figure.
    //
    // It is asserted as TWO, deliberately: if the page ever grows a third,
    // or loses one, this says so. Beat 2's cross-check sends a finger at
    // "the retainage total on /cash-flow", and there are two candidates.
    // ════════════════════════════════════════════════════════════════════
    await expect(
      page.getByText(/^Total outstanding: /),
      '/cash-flow labels two different sums "Total outstanding" — the AR aging total (net of retainage) and the retainage receivable. Read the one inside the Retainage receivable section, never the first one on the page.',
    ).toHaveCount(2);

    // BY ITS HEADING, not by the section's `data-tour` hook — and that is a
    // constraint from a census rather than a preference.
    // `lib/walkthroughs/walkthroughCensus.test.ts` counts every tour-anchor
    // literal in the repo with `git grep` and requires the import walk from
    // the registered pages to reach every one of them. A literal written in a
    // spec file is an anchor in a file no walkthrough's page renders, so it
    // fails that census with an off-by-one — which is exactly what it did on
    // the first attempt at this fix. The heading is the stabler handle anyway:
    // it is the thing on screen that tells a person which total this is.
    const retainageSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Retainage receivable" }) });
    await expect(
      retainageSection,
      "the retainage section is found by its own heading, so the figure read below cannot be the aging total",
    ).toHaveCount(1);
    const outstanding = retainageSection.getByText(/^Total outstanding: /);
    await expect(
      outstanding,
      "/cash-flow should name the retainage outstanding — it is the number beat 2 claims the rail matches",
    ).toHaveCount(1);
    const cashFlowRetainage = dollars(await outstanding.innerText(), "/cash-flow retainage outstanding");

    // Both sides first, as exact figures, so that the inequality below is a
    // statement about two known numbers rather than about two unknowns.
    expect(cashFlowRetainage, "/cash-flow and the Retainage tab must agree on what the GC is holding").toBe(
      RETAINAGE_WITHHELD,
    );
    expect(railFigure).toBe(RAIL_GETTING_PAID);

    // THE REFUTATION.
    expect(
      railFigure,
      [
        `the rail reads ${money(railFigure)} and retainage held is ${money(cashFlowRetainage)}.`,
        `The gap is ${money(railFigure - cashFlowRetainage)}, which is this job's contract value not yet invoiced —`,
        "the rail's own caption says so. Beat 2's script calls these the same sum and its Wrong branch says to",
        "stop and retake when they differ. If this assertion has gone red, the rail has been REDEFINED to mean",
        "retainage alone, and beat 2's claim has become true — delete this test rather than loosening it.",
      ].join(" "),
    ).not.toBe(cashFlowRetainage);
    expect(railFigure - cashFlowRetainage).toBe(UNBILLED_AFTER);

    // And the caption, asserted as TEXT: it is the sentence on screen that
    // contradicts the narration, and it is what makes this a documentation
    // defect rather than a product one.
    await page.goto("/dashboard");
    await expect(page.locator(`nav[aria-label="Main"] [title=${JSON.stringify(GETTING_PAID_DETAIL)}]`)).toHaveCount(1);
  });

  test("the browser threw nothing the run sheet would have to explain on camera", async () => {
    // Crashes have already failed the step they happened on. This is the
    // hydration half, and it is reported SEPARATELY from the beats on
    // purpose: #418 is a known open defect in the signed-in shell that fires
    // on roughly one authenticated page load in three, on whichever pages
    // lose the race (CLAUDE.md's #418 entry). The run sheet already tells
    // Cyrus it is harmless to the recording.
    //
    // It is still asserted, because a rehearsal that shrugged at it would be
    // the first thing in this directory to do so — and because the list here
    // is a second, independent sample of a race `main`'s own journey has
    // never got two clean runs out of.
    expect(
      monitor.hydrationMismatches,
      [
        "the server's HTML and the browser's first render disagreed on these pages while walking the shoot.",
        "This is the open #418 race in the signed-in shell, NOT a fault in the pages named and NOT a beat failing —",
        "read it against CLAUDE.md's #418 entry, and report it apart from the beats.",
        "",
        `console errors captured (${monitor.consoleErrors.length}):`,
        ...monitor.consoleErrors.map((message) => `  - ${message}`),
      ].join("\n"),
    ).toEqual([]);
    expect(monitor.crashes).toEqual([]);
  });
});
