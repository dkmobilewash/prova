import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";

/**
 * THE WAY OFF A PAGE ON A PHONE.
 *
 * REWRITTEN 2026-10-10 for Concept G. This spec used to press MobileNav.tsx's
 * hamburger and check the drawer it opened. The left rail and the drawer are
 * gone: below Tailwind's `md` the phone's navigation is the bottom tab bar
 * (components/shell/BottomTabs.tsx — Home · Jobs · Money · Schedule), and
 * every other page is under the avatar's "All pages" panel. The property the
 * old spec guarded is unchanged — a phone page has a NAMED navigation
 * landmark, and it can reach everything — so it is asserted on the new shape:
 *
 *   1. The tabs are a navigation landmark named "Main", visible at 375px.
 *   2. They mark the page you are on (`aria-current="page"`, generated from
 *      the pathname, so it cannot be true before the tabs render).
 *   3. The avatar opens a menu whose "All pages" opens a panel listing a
 *      page that is NOT a tab — /punch-lists — and Escape closes it.
 *
 * EMPTY persona and read-only pages: nothing here writes a row.
 */
test("the phone shell's tabs are a named landmark and All pages reaches the rest", async ({ page }) => {
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.empty.email);
  await page.goto("/schedule");

  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs, 'the bottom tabs must be a navigation landmark named "Main"').toBeVisible();
  await expect(tabs.locator('[aria-current="page"]'), "the tabs must mark the page you are on").toHaveAttribute(
    "href",
    "/schedule",
  );

  await expectHealthy(page, "/schedule at 375px", { monitor });

  await page.getByRole("button", { name: /^Your menu/ }).click();
  await page.getByRole("button", { name: "All pages" }).click();

  const all = page.getByRole("dialog", { name: "All pages" });
  await expect(all).toBeVisible();
  await expect(all.locator('a[href="/punch-lists"]'), "All pages must reach pages that are not tabs").toBeVisible();

  await page.keyboard.press("Escape");
  await expect(all).toBeHidden();
});
