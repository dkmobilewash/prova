import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { dataTour } from "../lib/dataTour";
import { finishWizard, jobTab, landOnDashboard, settleAction, startJob, submitLineItem } from "../lib/journey";

/**
 * THE ESTIMATING DESK, IN A REAL BROWSER, FOR THE FIRST TIME.
 *
 * Between 22 and 24 Sep 2026 thirteen estimating and takeoff features merged
 * to `main` — #435, #460, #467, #470, #476, #491, #492, #494, #496, #499,
 * #500, #502 — and every one of them arrived with the same sentence in its
 * PR body: "Nobody has clicked it." The pure arithmetic under them has unit
 * tests; not one screen had any coverage of any kind. A page could render an
 * error boundary, a form could refuse in silence, and nothing in this repo
 * would know. This file and its two siblings (takeoff-plan.spec.ts,
 * bid-desk.spec.ts) are the machine doing the clicking, the same way
 * journey.spec.ts is for the pilot spine.
 *
 * WHAT IT COVERS, one step per feature:
 *
 *   #467  wall types (the company library) and a job's wall schedule, with
 *         the estimate lines the schedule derives
 *   #470  the bid recap — cost type per line, markup rates saved, applied to
 *         the line prices
 *   #499  an estimate template created on /catalog and applied to the job
 *   #435  the labor hours + production rate fields, saved and read back
 *   #460  the proposal clause library and a job's proposal document
 *   #500  Job.grossAreaSqFt, and the conceptual $/SF calculator on /pipeline
 *
 * SERIAL, for journey.spec.ts's reason: every one of those screens needs an
 * ESTIMATE-stage job with a priced line on it, and building one per case
 * would spend five minutes proving the bid wizard works six more times. A
 * failure at step N skips N+1 onward rather than letting them fail for a
 * reason that is really step N's.
 *
 * NO ASSERTION HERE JUDGES A MONEY FORMULA, deliberately. What a markup or a
 * spread SHOULD come to is Diego's call, and a figure pinned by something
 * that cannot see the screen is worse than no figure at all. So the money
 * assertions are structural — the direct cost equals the line's own extension
 * (1,000 x $2.00, arithmetic this file supplied itself), the bid total is a
 * rendered dollar figure, applying names the lines it touched, and the unit
 * price afterwards is READ BACK from the server and is no longer what was
 * typed. The exact totals go to a human on the click-list.
 *
 * ESTIMATING is this file's own company (lib/personas.ts) so nothing else can
 * move the rows under it, and `expectHealthy` runs after every navigation and
 * every write — always with the monitor, which is what makes it look at what
 * the browser threw rather than only at what the page says.
 */
test.describe("the estimating desk", () => {
  test.describe.configure({ mode: "serial", retries: 0, timeout: 180_000 });

  const JOB_NAME = "ZZ-E2E Estimating — Building D level 2 drywall";
  const GC_NAME = "ZZ-E2E Estimating GC";
  /** 1,000 SF at $2.00 — the only priced line, so the recap's direct cost is
   * this and nothing else. */
  const LINE = { description: "ZZ-E2E 5/8in Type X, hung and finished", quantity: "1000", unit: "SF", unitPrice: "2.00" };
  const DIRECT_COST = "$2,000.00";
  const RUN_LABEL = "ZZ-E2E Level 2 corridor";
  const TEMPLATE_NAME = "ZZ-E2E TI, metal stud + drywall";
  const TEMPLATE_LINE = "ZZ-E2E template line — corner bead";
  const CLAUSE_TEXT = "ZZ-E2E Excluded: owner-furnished dumpsters and hoisting";

  let page: Page;
  let monitor: HealthMonitor;
  let jobId: string;

  /** The section a walkthrough anchor names. Those anchors are the
   * walkthrough's, not a test's — they are read rather than added, so nothing
   * here asks the app to carry a selector for this file's benefit. Built
   * through `dataTour()` and never spelled literally: `walkthroughCensus.test.ts`
   * counts the literal with `git grep` over all of `apps/web` and requires the
   * import walk from the app's own pages to reach every one, and a spec file is
   * not in any page's render graph — see lib/dataTour.ts, which exists for
   * exactly this and which this file first ignored and paid for. */
  const section = (name: string): Locator => page.locator(dataTour(name));

  /** How many line items the estimate carries. Counted inside the line-items
   * section only: nothing else in it has a `description` input — the draft
   * form posts `scopeText` and the typed takeoff form posts `label` — so this
   * is the row count and not a form's field. */
  const lineItemCount = () => section("job-line-items").locator('input[name="description"]').count();

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. sign in and reach an estimate-stage job", async () => {
    await signInAs(page, PERSONAS.estimating.email);
    await landOnDashboard(page, monitor);

    jobId = await startJob(page, monitor, {
      name: JOB_NAME,
      scope: "Metal stud framing, hang, tape and finish, level 3.",
      gcName: GC_NAME,
    });
    await submitLineItem(page, LINE);
    await expect(page.locator("li").filter({ hasText: LINE.description })).toBeVisible();
    await finishWizard(page, monitor, jobId);
  });

  test("2. the Estimate tab loads and carries every panel the three days added", async () => {
    await jobTab(page, "Estimate").click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/estimate$`));
    await expectHealthy(page, "estimate tab", { monitor });

    // Each of these is a whole feature's entry point. A heading missing here
    // means the panel did not render at all, which is the failure mode a
    // typecheck cannot see.
    for (const heading of ["Wall schedule", "Bid recap", "Line items (estimate)", "Add line item", "Estimate versions"]) {
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
        `the Estimate tab should show the "${heading}" panel`,
      ).toBeVisible();
    }
    expect(await lineItemCount(), "the wizard's one line is on the estimate").toBe(1);

    // #467's own empty state, before any wall type exists: the schedule says
    // where to go rather than showing an unusable form.
    await expect(section("job-wall-schedule").getByRole("link", { name: "Open wall types" })).toBeVisible();

    // The Takeoff tab (#476) is reachable from here and from the rail.
    await expect(jobTab(page, "Takeoff")).toBeVisible();
    await expect(section("job-line-items").getByRole("link", { name: "Measure off a plan" })).toBeVisible();
  });

  test("3. wall types: the starter partition schedule (#467)", async () => {
    await page.goto("/wall-types");
    await expectHealthy(page, "/wall-types", { monitor });
    // `exact` because the empty state's own heading, "No wall types yet",
    // CONTAINS the page title — and `getByRole` matches by substring unless
    // told otherwise, which is a strict-mode violation rather than a pass.
    await expect(page.getByRole("heading", { name: "Wall types", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No wall types yet", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Start from two common wall types" }).click();
    // The action returns what it added and the button's own message says so.
    await expect(page.getByText("Added W1 and W2.")).toBeVisible();

    await page.reload();
    await expectHealthy(page, "/wall-types after the starter types", { monitor });
    const list = page.locator(dataTour("wall-types-list"));
    await expect(list).toBeVisible();
    // Each card is an edit-in-place form, so the tag is an input's value and
    // not page text — read it the way it is rendered.
    await expect(list.locator('input[name="code"][value="W1"]')).toHaveCount(1);
    await expect(list.locator('input[name="code"][value="W2"]')).toHaveCount(1);
  });

  test("4. a wall run turns into estimate lines (#467)", async () => {
    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "estimate tab with wall types in the library", { monitor });

    const form = section("job-wall-schedule")
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "Add run" }) });
    await form.locator('input[name="label"]').fill(RUN_LABEL);
    // W1 is the first option and the select defaults to it; named anyway, so
    // a reordered library cannot silently change what this run is made of.
    await form.locator('select[name="wallTypeId"]').selectOption({ label: "W1" });
    await form.locator('input[name="lengthFt"]').fill("100");
    // The starter types carry no default height, so the run must state one —
    // and "Add run" stays disabled until the preview has quantities.
    await form.locator('input[name="heightFt"]').fill("10");

    const addRun = form.getByRole("button", { name: "Add run" });
    await expect(addRun, "a length and a height are enough to work the run out").toBeEnabled();
    await addRun.click();

    // The action's own summary, not the live preview above it: the preview
    // renders as you type and would be on the page whether the save landed or
    // not (CLAUDE.md, the watcher whose needle is already on the page).
    await expect(page.getByText(/^Estimate updated: 4 lines added\.$/)).toBeVisible();
    await expectHealthy(page, "estimate tab after adding a wall run", { monitor });

    await page.reload();
    await expectHealthy(page, "estimate tab reloaded after the wall run", { monitor });
    // W1 has four parts — studs, track, board, hang-and-finish — so the run
    // is four derived lines on top of the wizard's one.
    expect(await lineItemCount(), "one typed line plus W1's four parts").toBe(5);
    await expect(section("job-line-items").getByText("From wall schedule").first()).toBeVisible();
    // The run's own row is an edit-in-place form, like the wall-type cards, so
    // its name is an input's VALUE and not page text. Read it that way — the
    // first version of this looked for an <li> containing the label and found
    // none, while the four derived lines above proved the run had saved.
    await expect(
      section("job-wall-schedule").locator(`input[name="label"][value="${RUN_LABEL}"]`),
      "the run is on the schedule it was added to",
    ).toHaveCount(1);
  });

  test("5. the bid recap: cost type, rates, and applying them (#470)", async () => {
    const recap = section("job-bid-recap");
    await expect(recap.getByText("Direct cost of the work")).toBeVisible();
    await expect(recap.getByText("Bid total")).toBeVisible();

    // Only the typed line carries a price, so the direct cost is its own
    // extension — 1,000 x $2.00, arithmetic this file supplied itself rather
    // than a figure read off the screen and blessed.
    await expect(recap.getByText(DIRECT_COST).first()).toBeVisible();
    // The four derived lines have no cost type yet, and the panel says so
    // rather than marking them up at some default.
    await expect(recap.getByText(/have no cost type/)).toBeVisible();

    // Each of these posts a Server Action. `settleAction` waits for the answer,
    // so the reload below cannot race the write it is about to read back.
    await settleAction(page, () =>
      recap.getByRole("combobox", { name: `Cost type for ${LINE.description}` }).selectOption("MATERIAL"),
    );
    await recap.locator('input[name="materialMarkupPercent"]').fill("10");
    await recap.locator('input[name="overheadPercent"]').fill("5");
    await recap.locator('input[name="profitPercent"]').fill("8");
    await settleAction(page, () => recap.getByRole("button", { name: "Save rates" }).click());

    await page.reload();
    await expectHealthy(page, "estimate tab after saving the recap rates", { monitor });
    const saved = section("job-bid-recap");
    // Read back from the server, not from the boxes that were typed into.
    await expect(saved.locator('input[name="materialMarkupPercent"]')).toHaveValue("10");
    await expect(saved.locator('input[name="overheadPercent"]')).toHaveValue("5");
    await expect(saved.locator('input[name="profitPercent"]')).toHaveValue("8");
    await expect(
      saved.getByRole("combobox", { name: `Cost type for ${LINE.description}` }),
      "the line's cost type is stored, not held in the panel",
    ).toHaveValue("MATERIAL");

    const apply = saved.getByRole("button", { name: "Apply to line prices" });
    await expect(apply, "rates that add something make applying possible").toBeEnabled();
    await apply.click();
    // One priced line, so one line is re-priced — and the sentence says which.
    await expect(page.getByText(/^Applied to 1 line — they now total \$[\d,]+\.\d\d\.$/)).toBeVisible();
    await expectHealthy(page, "estimate tab after applying the recap", { monitor });

    await page.reload();
    await expectHealthy(page, "estimate tab reloaded after applying the recap", { monitor });
    await expect(section("job-bid-recap").getByText(/^Last applied /)).toBeVisible();

    // WHAT THE FIGURE SHOULD BE is Diego's call and is on the click-list.
    // What this asserts is that applying reached the database: the unit price
    // the wizard typed is not what the server now holds, and it went up.
    const priced = section("job-line-items")
      .locator("form")
      .filter({ has: page.locator(`input[name="description"][value="${LINE.description}"]`) })
      .first();
    const unitPrice = await priced.locator('input[name="unitPrice"]').inputValue();
    expect(Number(unitPrice), `the applied unit price (${unitPrice}) should be above the $2.00 direct price`).toBeGreaterThan(
      2,
    );
  });

  test("6. labor hours and a production rate on a line (#435)", async () => {
    const row = section("job-line-items")
      .locator("form")
      .filter({ has: page.locator(`input[name="description"][value="${LINE.description}"]`) })
      .first();
    await row.locator('input[name="laborHours"]').fill("40");
    await row.locator('input[name="productionRate"]').fill("25");
    await settleAction(page, () => row.getByRole("button", { name: "Save" }).click());

    await page.reload();
    await expectHealthy(page, "estimate tab after saving hours and a rate", { monitor });
    const saved = section("job-line-items")
      .locator("form")
      .filter({ has: page.locator(`input[name="description"][value="${LINE.description}"]`) })
      .first();
    await expect(saved.locator('input[name="laborHours"]')).toHaveValue("40");
    await expect(saved.locator('input[name="productionRate"]')).toHaveValue("25");

    // The live hint on the ADD form is the client half of the same feature:
    // hours with no craft cannot be priced, and it says which is missing
    // rather than leaving a blank space.
    const addForm = section("job-add-line-item");
    await addForm.locator('input[name="laborHours"]').fill("12");
    await expect(addForm.getByText("Pick a craft to price these hours")).toBeVisible();
    await addForm.locator('input[name="laborHours"]').fill("");
  });

  test("7. an estimate template, created on /catalog (#499)", async () => {
    await page.goto("/catalog");
    await expectHealthy(page, "/catalog", { monitor });
    await expect(page.getByRole("heading", { name: "Estimate templates" })).toBeVisible();

    await page.getByRole("button", { name: "Create a template" }).click();
    const templateForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Create template" }) });
    await templateForm.locator('input[name="name"]').fill(TEMPLATE_NAME);
    await templateForm.getByRole("button", { name: "Create template" }).click();

    // `exact` because `ConfirmDelete`'s describe text — rendered as a hidden
    // tooltip in the same row — quotes the template's name back.
    await expect(page.getByText(TEMPLATE_NAME, { exact: true })).toBeVisible();
    // A template with no lines on it says so, because it would add nothing.
    await expect(page.getByText(/No lines on it yet/)).toBeVisible();
    await expectHealthy(page, "/catalog after creating a template", { monitor });

    await page.getByRole("button", { name: "Lines", exact: true }).click();
    await page.getByRole("button", { name: "Add a line" }).click();
    const itemForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add line", exact: true }) });
    await itemForm.locator('input[name="description"]').fill(TEMPLATE_LINE);
    await itemForm.locator('input[name="unit"]').fill("LF");
    await itemForm.locator('input[name="defaultQuantity"]').fill("250");
    await settleAction(page, () => itemForm.getByRole("button", { name: "Add line", exact: true }).click());

    await page.reload();
    await expectHealthy(page, "/catalog after putting a line on the template", { monitor });
    const templateRow = page.locator("li").filter({ hasText: TEMPLATE_NAME }).first();
    await expect(templateRow.getByText(TEMPLATE_NAME, { exact: true })).toBeVisible();
    await expect(templateRow).toBeVisible();
    await expect(templateRow.getByText("1 line", { exact: true })).toBeVisible();
  });

  test("8. applying that template appends its lines to the estimate (#499)", async () => {
    await page.goto(`/jobs/${jobId}/estimate`);
    await expectHealthy(page, "estimate tab with a template in the library", { monitor });
    const before = await lineItemCount();

    await page.getByRole("button", { name: "Start from a template" }).click();
    // Picked by the option that NAMES the template rather than by its position:
    // the picker also offers every untagged template, and an index would
    // silently apply a different one.
    const picker = page.getByRole("combobox", { name: "Template" });
    const templateValue = await picker.locator("option", { hasText: TEMPLATE_NAME }).first().getAttribute("value");
    expect(templateValue, "the template should be offered on this job").toBeTruthy();
    await picker.selectOption(templateValue!);
    // The button counts what it is about to add, before it is pressed.
    const add = page.getByRole("button", { name: "Add 1 line" });
    await expect(add).toBeEnabled();
    await settleAction(page, () => add.click());

    // The panel's own preview lists the description before anything is added,
    // so the proof is the ROW COUNT on the estimate, read after a reload.
    await page.reload();
    await expectHealthy(page, "estimate tab after applying the template", { monitor });
    expect(await lineItemCount(), "applying a one-line template adds one line").toBe(before + 1);
    await expect(
      section("job-line-items").locator(`input[name="description"][value="${TEMPLATE_LINE}"]`),
    ).toHaveCount(1);
  });

  test("9. the proposal clause library and the job's proposal (#460)", async () => {
    await page.goto("/proposals");
    await expectHealthy(page, "/proposals", { monitor });
    await expect(page.getByRole("heading", { name: "Proposal clauses", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No clauses yet", exact: true })).toBeVisible();

    const library = page.locator("form").filter({ has: page.getByRole("button", { name: "Add clause" }) });
    await library.getByRole("combobox", { name: "Kind" }).selectOption("EXCLUSION");
    await library.locator('input[name="text"]').fill(CLAUSE_TEXT);
    await settleAction(page, () => library.getByRole("button", { name: "Add clause" }).click());

    await page.reload();
    await expectHealthy(page, "/proposals after adding a clause", { monitor });
    // The library row is an edit-in-place form, so the clause is an input's
    // VALUE and not page text. Read it the way it is rendered — the job's
    // proposal below is where it prints as prose.
    await expect(
      page.locator(dataTour("proposals-list")).getByLabel("Clause text"),
      "the clause is stored, not held in the form that added it",
    ).toHaveValue(CLAUSE_TEXT);

    await page.goto(`/jobs/${jobId}/proposal`);
    await expectHealthy(page, "job proposal", { monitor });
    await expect(page.getByRole("heading", { name: `Proposal — ${JOB_NAME}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Schedule of values" })).toBeVisible();
    // The schedule of values is the job's own line items, so every one of them
    // prints — and the document totals them.
    // Every one of the job's lines prints, and the row that says "Total bid"
    // is the row that carries the figure.
    await expect(
      page.locator("main").getByText(LINE.description, { exact: true }),
      "the schedule of values is the job's own line items",
    ).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: "Total bid" })).toContainText(/\$[\d,]+\.\d\d/);

    await settleAction(page, () => page.getByRole("button", { name: "Add from library" }).click());
    await page.reload();
    await expectHealthy(page, "job proposal after adding a clause from the library", { monitor });
    await expect(page.getByRole("heading", { name: "Exclusions" })).toBeVisible();
    // `exact` because the builder's "From your library" picker is still on the
    // page below the document, and its <option> reads "Exclusion — <the clause>"
    // — the clause text a second time, inside a longer string.
    await expect(page.locator("main").getByText(CLAUSE_TEXT, { exact: true })).toBeVisible();
  });

  test("10. the job's gross area, and the conceptual $/SF calculator (#500)", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expectHealthy(page, "job overview", { monitor });

    const details = page.locator("form").filter({ has: page.getByRole("button", { name: "Save details" }) });
    await details.locator('input[name="grossAreaSqFt"]').fill("40000");
    await details.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

    await page.reload();
    await expectHealthy(page, "job overview after saving the gross area", { monitor });
    await expect(
      page.locator("form").filter({ has: page.getByRole("button", { name: "Save details" }) }).locator('input[name="grossAreaSqFt"]'),
    ).toHaveValue("40000");

    await page.goto("/pipeline");
    await expectHealthy(page, "/pipeline", { monitor });
    await page.getByRole("button", { name: "Add a pursuit" }).click();
    await expect(page.locator('[data-testid="bid-pursuit-form"]')).toBeVisible();

    // The calculator is fetched ON OPEN — it reads every finished job's costs
    // and is deliberately not in /pipeline's render path.
    await page.getByRole("button", { name: "What has similar work run at?" }).click();
    await expect(page.getByText("Not saved — this is a calculator, not part of the pursuit.")).toBeVisible();
    await expect(page.getByText("Enter the building's gross area to see what similar work has run at.")).toBeVisible();

    // `exact`, and the reason is worth knowing rather than just working around.
    // `ConceptualEstimateHelper` is rendered INSIDE the "Estimated value of our
    // scope" `<label>` (BidPursuitList.tsx), so that field's accessible name is
    // its own text PLUS everything the calculator renders — including "Gross
    // area of the building (SF)". Two textboxes therefore answer to this name by
    // substring. Only one answers to it exactly.
    //
    // The a11y consequence is real and is reported rather than fixed here: a
    // screen reader announcing the pursuit's value field reads the whole
    // calculator as its label. Moving the helper to a sibling of the label —
    // the comment above it already says "BESIDE the field, never inside it" —
    // would fix both. That is Diego's markup and his call.
    await page
      .getByRole("textbox", { name: "Gross area of the building (SF)", exact: true })
      .fill("40000");
    // This company has finished nothing, so the honest answer is the reason
    // and NOT a range. A $/SF figure here would be the invented number
    // lib/conceptual-estimate.ts is written to refuse.
    await expect(
      page.getByText(
        "No finished job has a gross area recorded yet, so there is nothing to compare a new project against.",
      ),
    ).toBeVisible();
    await expect(page.locator("main").getByText(/middle \$/)).toHaveCount(0);
    await expectHealthy(page, "/pipeline with the conceptual calculator open", { monitor });
  });

  test("11. every estimating destination still loads, and nothing crashed the browser", async () => {
    for (const target of [
      "/bids",
      "/catalog",
      "/pipeline",
      "/proposals",
      "/wall-types",
      `/jobs/${jobId}`,
      `/jobs/${jobId}/estimate`,
      `/jobs/${jobId}/takeoff`,
      `/jobs/${jobId}/proposal`,
    ]) {
      await page.goto(target);
      await expectHealthy(page, `after a whole estimate exists: ${target}`, { monitor });
    }

    // A REAL CRASH FAILS THIS STEP; THE SHELL'S KNOWN HYDRATION RACE IS
    // RECORDED INSTEAD OF ASSERTED, AND THAT IS A DELIBERATE CALL.
    //
    // `monitor.crashes` is an uncaught exception — a page that fell over — and
    // nothing excuses one.
    //
    // `monitor.hydrationMismatches` is React #418 from the SIGNED-IN SHELL,
    // diagnosed in #501 with Diego's fix pending. It fires on roughly one
    // authenticated page load in three, on /jobs/new and on every job tab, and
    // `journey.spec.ts`'s step 11 ALREADY fails the whole run over it — by
    // name, listing every URL it happened on. Asserting it again here would
    // make four specs red for one defect that belongs to none of them, and
    // would bury whether the screens this file exists for actually work. It is
    // attached to this test's report instead: visible, counted, and not
    // pretending the defect is gone.
    //
    // The moment #501 lands this goes back to being an assertion. It is one
    // line, and it is this comment's job to make sure somebody does it.
    if (monitor.hydrationMismatches.length > 0) {
      test.info().annotations.push({
        type: "known-hydration-race-501",
        description:
          `${monitor.hydrationMismatches.length} React #418 hydration mismatch(es) on the signed-in shell — ` +
          `journey.spec.ts step 11 is what fails the run over this:\n${monitor.hydrationMismatches.join("\n")}`,
      });
    }
    expect(monitor.crashes, "an uncaught exception reached the browser").toEqual([]);
  });
});
