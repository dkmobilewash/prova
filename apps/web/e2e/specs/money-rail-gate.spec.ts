import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";

/**
 * Invariant (#350): a field-function member sees no money figures on the
 * rail. The gate is apps/web/app/(app)/layout.tsx:
 *   can(principal, "VIEW_COMPANY_FINANCIALS") ? getMoneyRailStages(...) : Promise.resolve([])
 * — for a viewer without the capability, `stages` is `[]` and no
 * StageFigure (the yellow dollar amount under a nav heading,
 * components/Sidebar.tsx) renders at all.
 *
 * Both personas sign into the SAME company (MAIN) — see
 * lib/seedDatabase.ts, which creates FIELD as a second User inside
 * MAIN's company with role MEMBER, jobFunction FIELD. Testing only the
 * FIELD case would be exactly the kind of vacuous check CLAUDE.md warns
 * about repeatedly (a needle that was never going to be found proves
 * nothing) — so the OWNER case is asserted first as a positive control,
 * proving the sidebar DOES render a dollar figure on this exact company
 * before proving FIELD doesn't see one.
 *
 * THAT CONTROL WAS DEAD UNTIL 2026-09-21, which is exactly the vacuous
 * shape the paragraph above warns about. MAIN's company was seeded
 * without `businessScopeAskedAt`, so `/dashboard` sent its OWNER to
 * `/welcome` (lib/onboarding-gate.ts). That screen has no nav rail, so
 * test 1 failed looking for one, and only the FIELD test ever ran. The seed
 * now marks MAIN as an established account (seedDatabase.ts,
 * `ESTABLISHED_ACCOUNT_ASKED_AT`, pinned by seedDatabase.test.ts). If test
 * 1 fails, read which URL it failed on before you read anything else. A
 * `/welcome` there means the seed regressed, not the rail.
 *
 * What the control does and does not prove: the seeded job carries no
 * contract value, so the figure it finds may be "$0.00". That still proves
 * a StageFigure renders dollar amounts for this viewer on this company.
 * That is the claim the FIELD test needs as its opposite. It says nothing
 * about the amount being right; lib/moneyRail.test.ts covers that.
 */
test.describe("Money Rail: VIEW_COMPANY_FINANCIALS gates every dollar figure", () => {
  test("OWNER sees a dollar figure on the rail (positive control)", async ({ page }) => {
    await signInAs(page, PERSONAS.main.email);
    await page.goto("/dashboard");
    // Named first so a seed regression reads as one, not as a missing rail.
    await expect(page, "MAIN is an established account and lands on the dashboard, not /welcome").toHaveURL(
      /\/dashboard(\?|$)/,
    );

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    // Not every stage figure is money (some are a bare count), so this
    // requires at least one dollar figure rather than a specific count.
    await expect(nav.locator("text=/\\$[0-9,]+/").first()).toBeVisible();
  });

  test("a FIELD-function member sees no money figures on the rail", async ({ page }) => {
    await signInAs(page, PERSONAS.field.email);
    await page.goto("/dashboard");

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    await expect(nav.locator("text=/\\$[0-9,]+/")).toHaveCount(0);
  });
});
