import type { Page } from "@playwright/test";

/**
 * Opens Run takeoff's menu in the full-screen workspace, where Find the rooms,
 * Review walls, Check these are walls, Find demolition and Read this sheet live
 * behind its arrow. A no-op on the takeoff tab, which has no arrow and keeps
 * them all in its toolbar. The menu closes on the next click, so call this
 * before each one.
 */
export async function openFinders(page: Page): Promise<void> {
  const more = page.locator('[data-takeoff="run-more"]');
  if ((await more.count()) === 0) return;
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
}
