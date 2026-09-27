import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { landOnDashboard } from "../lib/journey";

/**
 * THE PER-COMPANY AI SWITCH, AND THE ONE BUG IN IT THAT NOTHING ELSE CAN SEE.
 *
 * #533 put every model call behind `aiGate`, and a census
 * (`lib/ai/aiFeatureGateCensus.test.ts`) fails the build if a caller escapes
 * it. That census is about the SERVER. This file exists for a defect that
 * lives entirely in the BROWSER, and no test in this repo can reach it:
 *
 *   A DISABLED CHECKBOX POSTS NOTHING.
 *
 * With the master switch off, all seven per-feature boxes render `disabled`,
 * so a browser leaves every one of them out of the form submission.
 * `saveCompanyAiSettings` reads absence as "this feature is switched off" —
 * that is how an unticked box is meant to work — so saving while AI is off
 * would record ALL SEVEN as disabled and destroy whatever per-feature
 * choices the company had made.
 *
 * And the consequence is worse than losing a preference. Turn AI back on
 * afterwards and `aiEnabled` is true while `disabledFeatures` holds all seven,
 * so every feature refuses individually: a product that looks switched on and
 * does nothing, with a different sentence for each thing you try. The switch
 * becomes a trap, and the trap is armed by using it.
 *
 * The fix is hidden inputs, which are never disabled and therefore always
 * post. WHY A UNIT TEST CANNOT CHECK IT: the thing in question is real form
 * serialization — which fields a browser includes in a POST when their inputs
 * are disabled. The screen suite runs in happy-dom, which does not serialize
 * a form the way a browser does, so a unit test would either pass against the
 * bug or test something adjacent to it. Real Chromium doing a real submit is
 * the only instrument, which is what this file is.
 *
 * ── HOW IT AVOIDS PASSING VACUOUSLY ──
 *
 * CLAUDE.md's recurring scar is a check that answers a question nobody asked.
 * Two specific defences here:
 *
 *   - The final state is asserted as a COUNT (five ticked, two unticked) and
 *     the opening state is asserted FIRST as a different count (seven ticked).
 *     So the assertion that matters cannot have been true when the run began
 *     — the "needle already on the page" shape, which this repo has paid for
 *     with a stopwatch reading 101ms on a save that had not happened.
 *   - Every step calls `expectHealthy`, so a page that renders the error
 *     boundary fails naming the sentence it found, rather than failing later
 *     on a locator and being written up as a broken page. `settings-import`
 *     carries the same note for the same reason — a note saying that page was
 *     broken sat on main for two weeks when the real defect was the spec.
 *
 * ── AND ITS OWN BOUND, STATED RATHER THAN LEFT TO BE DISCOVERED ──
 *
 * This file proves the ROUND TRIP through a browser. It does not prove that
 * a switched-off feature refuses — `aiGate` and its refusal sentences are
 * covered in `lib/ai/settings.test.ts`, and asserting the Ask box's refusal
 * here would mean either spending a real model call or stubbing the endpoint
 * the gate runs behind, which tests the stub. The compliance refusal is left
 * to the click-list for the same reason: it needs a real upload.
 *
 * SERIAL, on AI_SWITCH's own company, because step 3 asks what step 2 wrote
 * and the whole point is what SURVIVES a save. And because this spec changes
 * what the application is willing to do rather than what data it holds, it
 * must not share a company with anything — see personas.ts.
 */
test.describe("the per-company AI switch", () => {
  test.describe.configure({ mode: "serial", retries: 0, timeout: 120_000 });

  /** The two this file switches off. Chosen because neither is reachable from
   *  any other spec against this company, and because they are far apart in
   *  the rendered list — a fix that happened to carry only the first or last
   *  box through would still fail. */
  const OFF = ["BID_RESEARCH", "LEAD_SEARCH"] as const;
  /** Every key the form renders, from the app's own enum order. Written out
   *  rather than imported: a spec that derived this list from the same
   *  constant the form renders from could not notice the list shrinking, and
   *  a form rendering six boxes for seven features is one of the two bugs
   *  this file is for. */
  const ALL = [
    "ASK",
    "WIP_NARRATIVE",
    "COMPLIANCE_EXTRACT",
    "DRAFT_ESTIMATE_LINES",
    "BID_RESEARCH",
    "LEAD_SEARCH",
    "PLAN_INGESTION",
  ] as const;

  let page: Page;
  let monitor: HealthMonitor;

  /** By the wire name, deliberately. Everything this file is about is which
   *  fields reach the server, so the field name is the right handle — and it
   *  is unambiguous, where the accessible name of each box includes its whole
   *  description paragraph. */
  const box = (feature: string): Locator => page.locator(`input[name="feature:${feature}"]`);
  const master = (): Locator => page.locator('input[name="aiEnabled"]');
  const save = (): Locator => page.getByRole("button", { name: "Save AI settings" });

  /** How many of the seven are ticked, read from the live DOM.
   *
   *  `isChecked()` on each rather than a CSS `:checked` count, because a
   *  hidden input carrying the same name would be counted by the latter — and
   *  this file must never confuse the fix with the thing being fixed. */
  async function tickedCount(): Promise<number> {
    let ticked = 0;
    for (const feature of ALL) {
      if (await box(feature).isChecked()) ticked += 1;
    }
    return ticked;
  }

  async function saveAndSettle(): Promise<void> {
    await save().click();
    // The action's own success sentence, not a timeout. A save that failed
    // renders its error in the same place, so waiting for this string is
    // also the assertion that it did not.
    await expect(page.getByText("Saved. This takes effect on the next question or upload.")).toBeVisible();
  }

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. the switch renders for an owner, with everything on", async () => {
    await signInAs(page, PERSONAS.aiSwitch.email);
    await landOnDashboard(page, monitor);

    await page.goto("/settings/assistant");
    await expectHealthy(page, "/settings/assistant", { monitor });

    await expect(page.getByRole("heading", { name: "What AI is allowed to do" })).toBeVisible();

    // ABSENT MEANS ON. This company has no CompanyAiSettings row at all, and
    // the one thing that must not happen on the day the migration lands is
    // the product arriving switched off. Asserted as the OPENING state so
    // that every count below is a change from it.
    await expect(master()).toBeChecked();
    expect(await tickedCount()).toBe(ALL.length);

    // Seven boxes for seven features. A form that renders six would silently
    // disable the seventh on every save, because absence is "off".
    for (const feature of ALL) {
      await expect(box(feature), `no checkbox for ${feature}`).toHaveCount(1);
    }
  });

  test("2. switching two features off saves, and only those two are off", async () => {
    for (const feature of OFF) await box(feature).uncheck();
    await saveAndSettle();

    await page.reload();
    await expectHealthy(page, "/settings/assistant after saving two off", { monitor });

    expect(await tickedCount()).toBe(ALL.length - OFF.length);
    for (const feature of OFF) await expect(box(feature), `${feature} should be off`).not.toBeChecked();
    await expect(master()).toBeChecked();
  });

  test("3. turning AI OFF entirely does not destroy the per-feature choices", async () => {
    // THE ASSERTION THIS FILE EXISTS FOR.
    await master().uncheck();

    // While off, every feature box is disabled — which is what makes a
    // browser drop them from the POST. Asserted, because if they stop being
    // disabled the hidden inputs below become dead code and the next person
    // deletes them.
    for (const feature of ALL) await expect(box(feature)).toBeDisabled();

    await saveAndSettle();
    await page.reload();
    await expectHealthy(page, "/settings/assistant with AI off", { monitor });

    await expect(master()).not.toBeChecked();
    // FIVE, not zero and not seven. Zero is the bug: the browser dropped the
    // disabled boxes, the action read absence as off, and the company's
    // choices are gone. Seven would mean something re-enabled them.
    expect(await tickedCount()).toBe(ALL.length - OFF.length);
    for (const feature of OFF) await expect(box(feature), `${feature} should still be off`).not.toBeChecked();
  });

  test("4. turning AI back on restores exactly what it was, not everything", async () => {
    await master().check();
    await saveAndSettle();

    await page.reload();
    await expectHealthy(page, "/settings/assistant switched back on", { monitor });

    await expect(master()).toBeChecked();
    // The whole cycle is a no-op on the per-feature choices. If this reads
    // seven, off-then-on silently re-enabled a feature somebody had
    // deliberately switched off — the opposite failure to step 3's, and just
    // as invisible.
    expect(await tickedCount()).toBe(ALL.length - OFF.length);
    for (const feature of OFF) await expect(box(feature), `${feature} should have survived`).not.toBeChecked();
  });

  test("5. an unknown model is refused rather than stored", async () => {
    // The select offers only ids `modelFor` knows, so a person cannot reach
    // this through the UI — which is the point. `saveCompanyAiSettings`
    // validates on write because a stored id nothing routes to would read on
    // this very page as the model the company runs on while every call ran on
    // something else. Driven by adding the option the app does not offer,
    // which is the shape a stale saved value or a tampered post takes.
    const select = page.locator('select[name="modelOverride"]');
    await expect(select).toBeVisible();
    await select.selectOption({ label: "Recommended (we choose per feature)" });

    await select.evaluate((element) => {
      const option = document.createElement("option");
      option.value = "claude-opus-5-20260101";
      option.textContent = "not a real model";
      element.appendChild(option);
      (element as HTMLSelectElement).value = "claude-opus-5-20260101";
    });
    await save().click();

    // The action's sentence, and NOT the success sentence. Both render in the
    // same place, so asserting the refusal is also asserting it did not save.
    await expect(
      page.getByText("That isn't a model this app can use. Leave it on the default unless C Stream has told you otherwise."),
    ).toBeVisible();
    await expect(page.getByText("Saved. This takes effect on the next question or upload.")).toHaveCount(0);

    await page.reload();
    await expectHealthy(page, "/settings/assistant after a refused model", { monitor });
    // Still the default, and the per-feature choices still intact — a refused
    // save must not half-write.
    await expect(select).toHaveValue("");
    expect(await tickedCount()).toBe(ALL.length - OFF.length);
  });
});
