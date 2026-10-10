import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./navItems";

/**
 * Nav label == page heading == browser tab title.
 *
 * Contractors called the app "too hard to use", and one cheap reason was that
 * the three names for a page disagreed: "Union & fringe" opened "Union fringe
 * & apprenticeship", and 66 of 67 tabs read just "C Stream". Each page now
 * exports `metadata.title` (the root layout adds " · C Stream"), and this
 * census keeps the three names from drifting apart again.
 *
 * Pages with no `metadata.title` yet are skipped, not passed — the floor
 * below fails if the parse silently stops finding titles.
 */
const appDir = new URL("../app/(app)", import.meta.url).pathname;

function titleOf(dir: string): string | null {
  for (const file of ["page.tsx", "layout.tsx"]) {
    const path = `${dir}/${file}`;
    if (!existsSync(path)) continue;
    const m = readFileSync(path, "utf8").match(/export const metadata = \{ title: "([^"]+)" \}/);
    if (m) return m[1];
  }
  return null;
}

function headingsOf(dir: string): string[] {
  const path = `${dir}/page.tsx`;
  if (!existsSync(path)) return [];
  return [...readFileSync(path, "utf8").matchAll(/<h1[^>]*>([^<{]+)<\/h1>/g)].map((m) =>
    m[1].trim().replace(/&amp;/g, "&"),
  );
}

describe("page title census", () => {
  const checked = NAV_ITEMS.map((item) => ({ item, dir: `${appDir}${item.href}` })).filter(
    ({ dir }) => titleOf(dir) !== null,
  );

  it("finds titled nav pages at all", () => {
    expect(checked.length).toBeGreaterThanOrEqual(25);
  });

  it.each(checked.map(({ item, dir }) => [item.href, item.label, dir]))(
    "%s: tab title matches the nav label",
    (_href, label, dir) => {
      expect(titleOf(dir)).toBe(label);
    },
  );

  it.each(checked.map(({ item, dir }) => [item.href, dir]))(
    "%s: tab title is one of the page's headings",
    (_href, dir) => {
      const headings = headingsOf(dir);
      // A client page (contacts) renders its h1 elsewhere; nothing to compare.
      if (headings.length === 0) return;
      expect(headings).toContain(titleOf(dir));
    },
  );
});
