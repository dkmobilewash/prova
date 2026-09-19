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
 */
test.describe("Money Rail: VIEW_COMPANY_FINANCIALS gates every dollar figure", () => {
  test("OWNER sees a dollar figure on the rail (positive control)", async ({ page }) => {
    await signInAs(page, PERSONAS.main.email);
    await page.goto("/dashboard");

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
