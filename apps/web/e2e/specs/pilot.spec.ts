import { test, expect } from "@playwright/test";

/**
 * /pilot: the public early-tester page (WWCCA members land here, no auth
 * needed — see CLAUDE.md, /pilot is deliberately absent from
 * middleware.ts's protected-route list). Purely functional: headline
 * renders, the sign-up link goes to Clerk's sign-up card.
 */
test.describe("/pilot (signed out)", () => {
  test("headline renders and Sign up goes to the Clerk sign-up card", async ({ page }) => {
    await page.goto("/pilot");

    await expect(page.getByRole("heading", { name: "Your whole job, in one place." })).toBeVisible();

    const signUp = page.getByRole("link", { name: "Sign up — it takes a minute" });
    await expect(signUp).toHaveAttribute("href", "/sign-up");

    await signUp.click();
    await page.waitForURL("**/sign-up");
    // Clerk's own DOM is out of this repo's control, so this checks only
    // that SOMETHING interactive rendered rather than a blank/error page —
    // the exact card markup is Clerk's contract, not ours.
    await expect(page.locator("input").first()).toBeVisible();
  });
});
