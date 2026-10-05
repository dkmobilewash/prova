import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { settleAction } from "../lib/journey";

/**
 * `/sales` AND `/sales/[id]` HAD NEVER BEEN LOADED BY A BROWSER, AND COULD NOT
 * BE.
 *
 * Raised by Cyrus in `#prova-build` on 2026-10-04, and the diagnosis is the
 * reason this file needed a new persona rather than a new spec: both pages are
 * gated on two things deliberately kept OUT of `lib/permissions.ts` — the
 * company must be Prova's own operator (`Company.isProvaOperator`) and the
 * viewer must be its OWNER. No persona in this suite was seeded either way,
 * and no company in it could be: every one except MAIN is auto-created on
 * first sign-in by `requireCompanyContext`, which leaves that flag false, and
 * nothing in the product sets it.
 *
 * SO THE NAV WALK WAS ALREADY REACHING `/sales` AND PASSING ON THE REFUSAL.
 * That page returns 200, renders cleanly, and says "Nothing here for this
 * account." `expectHealthy` is satisfied by it — correctly, nothing crashed —
 * so the suite was green about a page that had declined to show itself, for
 * weeks, beside a money spine proved click by click on every commit. The
 * vacuous green this directory exists to end, in the one lane nobody had
 * looked at.
 *
 * ── THE CONTROL IS THE HALF THAT MAKES THE REST READABLE ──
 *
 * The last case signs in as a NON-operator and asserts the refusal. Without
 * it, every assertion above could pass on a gate that had quietly stopped
 * working — "the pipeline renders" proves nothing if it renders for everybody,
 * and a gate that fails open on an internal page is worse than one nobody
 * tested. Pair, not a single arm, the same way the #418 probes earned their
 * zero.
 *
 * Serial: the lead created in case 2 is what case 3 opens, and `/sales/[id]`
 * needs an id that exists.
 */
test.describe.configure({ mode: "serial" });

const LEAD = "ZZ-E2E Prospect Drywall";

test.describe("the operator's own sales pipeline", () => {
  test("1. an operator OWNER sees the real page, not the refusal", async ({ page }) => {
    const monitor = new HealthMonitor(page);
    await signInAs(page, PERSONAS.operator.email);
    await page.goto("/sales");
    await expectHealthy(page, "/sales as the operator", { monitor });

    // THE ASSERTION THAT MATTERS IS THE NEGATIVE ONE. A refusal page is a
    // healthy 200, so "it loaded" is not evidence the gate was passed — only
    // the absence of the refusal is.
    await expect(page.getByRole("heading", { name: "Sales CRM" })).toBeVisible();
    await expect(page.getByText("Not part of your access")).toHaveCount(0);
    await expect(page.getByText("Owner only")).toHaveCount(0);
  });

  test("2. a lead can be added, and the empty state goes with it", async ({ page }) => {
    const monitor = new HealthMonitor(page);
    await signInAs(page, PERSONAS.operator.email);
    await page.goto("/sales");

    // The empty state first, so the row appearing below is attributable to
    // this case rather than to something already there.
    await expect(page.getByText("No leads recorded yet.")).toBeVisible();

    await page.getByRole("button", { name: "Add a lead" }).click();
    await page.locator('input[name="companyName"]').fill(LEAD);
    await settleAction(page, () => page.getByRole("button", { name: "Save", exact: true }).click());

    await expectHealthy(page, "/sales after adding a lead", { monitor });
    await expect(page.getByText(LEAD)).toBeVisible();
    await expect(page.getByText("No leads recorded yet.")).toHaveCount(0);
  });

  test("3. the lead's own page opens and renders", async ({ page }) => {
    const monitor = new HealthMonitor(page);
    await signInAs(page, PERSONAS.operator.email);
    await page.goto("/sales");

    await page.getByRole("link", { name: new RegExp(LEAD) }).first().click();
    await page.waitForURL(/\/sales\/[^/]+$/);
    await expectHealthy(page, "/sales/[id] as the operator", { monitor });

    // Reached by its id, which is the half `/sales` alone cannot prove.
    await expect(page.getByText(LEAD)).toBeVisible();
    await expect(page.getByText("Not part of your access")).toHaveCount(0);
  });

  test("4. CONTROL: a non-operator company is refused, so the gate is real", async ({ page }) => {
    const monitor = new HealthMonitor(page);
    // EMPTY is never mutated by any spec and its company is auto-created, so
    // its `isProvaOperator` is false — which is the ordinary state of every
    // customer account.
    await signInAs(page, PERSONAS.empty.email);
    await page.goto("/sales");
    await expectHealthy(page, "/sales as a non-operator", { monitor });

    await expect(page.getByText("Not part of your access")).toBeVisible();
    // And it names nothing it would have shown — the page's own header says
    // a non-operator "sees nothing distinct from any other page it hasn't
    // been given a link to".
    await expect(page.getByRole("heading", { name: "Sales CRM" })).toHaveCount(0);
    await expect(page.getByText(LEAD)).toHaveCount(0);
  });
});
