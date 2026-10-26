import { expect, type Page } from "@playwright/test";
import { isBidPath, isSharedPath } from "../../lib/bid/surface";

/**
 * EVERY LINK ON THE PAGE STAYS INSIDE C STREAM BID.
 *
 * `lib/bid/bidLinkCensus.test.ts` proves this from SOURCE; this proves it from
 * the DOM a real browser built, which is the only place a link assembled at
 * runtime (`href={hrefs.x}`, a template with an id in it) is a string anybody
 * can read. A census can tell you the code says a Bid path; only the page can
 * tell you what it drew.
 *
 * The rule is the census's: a path is fine if it is a `/bid` path or one of the
 * shared ones (`/sign-in`, `/api`, static files…), via the SAME two functions
 * middleware uses — so this spec and the router cannot disagree about what
 * "inside Bid" means. A bare fragment, `mailto:` and `tel:` go nowhere. An
 * absolute URL is checked by its path when it is on this page's own origin, and
 * left alone when it is somebody else's host.
 *
 * Reads `a[href]` only. A `router.push` behind a button is not an anchor — the
 * census reads those in source — and the walk in the spec exercises the ones a
 * person presses.
 */
export async function bidHrefsOnPage(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? ""),
  );
}

export function isOutsideBid(href: string, origin: string): boolean {
  if (href === "" || href.startsWith("#") || /^(mailto|tel|blob|data|javascript):/i.test(href)) return false;
  let path = href;
  if (/^https?:\/\//i.test(href)) {
    const url = new URL(href);
    if (url.origin !== origin) return false; // someone else's site
    path = url.pathname;
  }
  const pathname = path.split(/[?#]/)[0];
  return !(isBidPath(pathname) || isSharedPath(pathname));
}

export async function expectNoCrmLinks(page: Page, where: string, options: { minLinks?: number } = {}): Promise<void> {
  const origin = new URL(page.url()).origin;
  const hrefs = await bidHrefsOnPage(page);
  // A page with no anchors at all would pass vacuously. Every page inside the
  // Bid shell has the header's nav (a handful of links) at the least; a page
  // outside it — the full-screen workspace — says how few it has.
  const minLinks = options.minLinks ?? 6;
  expect(
    hrefs.length,
    `${where}: found ${hrefs.length} links, expected at least ${minLinks} — the check read a near-empty page`,
  ).toBeGreaterThanOrEqual(minLinks);
  const out = [...new Set(hrefs.filter((href) => isOutsideBid(href, origin)))];
  expect(out, `${where}: links that leave C Stream Bid`).toEqual([]);
}
