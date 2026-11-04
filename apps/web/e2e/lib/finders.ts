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

/**
 * Opens the workspace's items rail, which starts closed since the full-screen
 * layout (the layer panel has the right-hand side by default). A no-op where
 * it is already open or does not exist.
 */
export async function openItems(page: Page): Promise<void> {
  const toggle = page.locator('[data-takeoff="toggle-items"]');
  if ((await toggle.count()) === 0) return;
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}
