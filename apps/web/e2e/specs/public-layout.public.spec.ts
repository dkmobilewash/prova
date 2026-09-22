import { test, expect, type Page } from "@playwright/test";
import { expectHealthy } from "../lib/health";
import { PUBLIC_ROUTES } from "../lib/publicRoutes";
import { expectFitsTheViewport } from "../lib/viewport";

/**
 * EVERY PAGE A PERSON CAN REACH WITHOUT SIGNING IN, AT EVERY VIEWPORT IN
 * `playwright.public.config.ts` — the check that had never run anywhere.
 *
 * THREE ASSERTIONS PER PAGE, AND THE ORDER MATTERS. A blank page has no
 * horizontal overflow and a layout viewport exactly the size of the
 * device, so a width assertion on its own is the vacuous watcher CLAUDE.md
 * keeps finding here — it would go green on a 500 forever. So each page
 * must first prove it RENDERED (`expectHealthy`, plus a string only this
 * page's own content produces), and only then is its width worth
 * believing.
 */

/** Suppresses Clerk's development-instance dev-browser redirect. See
 * playwright.public.config.ts's header for the measurement behind it and
 * for why it is not an auth bypass — every request here is anonymous. */
async function allowAnonymousNavigation(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "__clerk_db_jwt", value: "dvb_e2e_public_suite", domain: "127.0.0.1", path: "/" },
    { name: "__clerk_db_jwt", value: "dvb_e2e_public_suite", domain: "localhost", path: "/" },
  ]);
}

for (const route of PUBLIC_ROUTES) {
  test(`${route.label} fits the viewport and renders`, async ({ page }, testInfo) => {
    const where = `${route.label} at ${testInfo.project.name}`;
    await allowAnonymousNavigation(page);

    const response = await page.goto(route.path);
    expect(response?.status(), `${where}: expected 200`).toBe(200);

    await expectHealthy(page, where, { signedIn: false });
    await expect(
      page.locator("body"),
      `${where}: the page did not render its own content, so its width means nothing`,
    ).toContainText(route.mustShow);

    await expectFitsTheViewport(page, where);
  });
}

/**
 * The GC's job page, reached the way a GC reaches it. Separate from the
 * loop above because it needs a job id the seed does not hand out — see
 * PUBLIC_ROUTE_EXCLUSIONS, where its absence from the table is recorded
 * rather than left silent.
 *
 * This is the page carrying a five-column money table on a phone, so it is
 * the one most likely to be the next finding.
 */
test("the GC's job page, reached from the portal, fits the viewport", async ({ page }, testInfo) => {
  const where = `GC portal job page at ${testInfo.project.name}`;
  await allowAnonymousNavigation(page);

  await page.goto(PUBLIC_ROUTES.find((r) => r.pattern === "/portal/[token]")!.path);
  await page.getByRole("link", { name: /Riverside Medical Center/ }).first().click();
  await page.waitForURL(/\/portal\/[^/]+\/jobs\/[^/]+$/);

  await expectHealthy(page, where, { signedIn: false });
  await expect(page.getByText("Level 5 finish including primer-sealer")).toBeVisible();
  await expectFitsTheViewport(page, where);
});
