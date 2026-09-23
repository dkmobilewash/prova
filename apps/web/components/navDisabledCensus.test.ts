/**
 * A nav entry marked `disabled: true` must not have a real page behind it.
 *
 * WHAT WENT WRONG. On 3 Sep 2026 `/safety` and `/material-orders` were
 * given `disabled: true` as a product-scope deferral (NAV-IA-AUDIT.md).
 * Both routes were fully built and rendering at the time, and both stayed
 * that way for eighteen days, so the rail spent eighteen days telling a
 * contractor "coming soon" about a page he could open by typing the URL.
 * By the end of it the app was arguing with itself: Ask answers "One of my
 * guys cut his hand" with `{ label: "Safety", href: "/safety" }`
 * (lib/ask/handlers.ts) and global search (#386) finds the page, while the
 * sidebar rendered a greyed, unfocusable span. Nothing failed. Nothing
 * could — no test pinned the flag to the thing it claims.
 *
 * WHAT THIS CHECKS. For every item in NAV_GROUPS carrying `disabled: true`,
 * that its href has NO page file under the Next app directory. So the flag
 * now means exactly one thing — the route does not exist yet — and the day
 * somebody builds the route, this test goes red until the flag comes off.
 *
 * WHAT IT CANNOT SEE. It proves a page FILE exists, not that the page
 * renders for a given user, and not that it is useful. A route that exists
 * but 500s would still fail this test, which is the right way round: the
 * fix for that is to fix the page or delete it, never to grey out the link
 * and leave Ask pointing at it. It also cannot see an entry that should be
 * disabled and is not — that is the orphan direction, which
 * navItems.test.ts already holds.
 *
 * AND WHY THE WALK IS ASSERTED, NOT TRUSTED. This repo has two scars from
 * checks that derived a set and never counted it: a foreign-key parser that
 * silently read 180 of 181 and passed thirteen assertions, and a contrast
 * census with the right pattern and the wrong scan root, which could not
 * see the one offending file in the repo and reported 20 passed. A route
 * walk has both failure modes. If it returned nothing, or walked the wrong
 * directory, every `expect(routes.has(href)).toBe(false)` below would pass
 * for the worst possible reason.
 *
 * So the walk is pinned from BOTH ends, against sources that cannot drift
 * with it:
 *
 *   - SIZE: the number of routes parsed must equal the number of page files
 *     found. Two different operations — one splits paths into segments, one
 *     counts filenames — so a parser that collides or drops routes diverges
 *     from a count that cannot.
 *   - SCOPE: every href in NAV_ITEMS and NAV_FOOTER must resolve to a walked
 *     route. The nav is an independent list maintained by hand, so a walk
 *     rooted in the wrong place fails loudly, naming all of them, instead of
 *     quietly having nothing to find.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAV_FOOTER, NAV_GROUPS, NAV_ITEMS } from "./navItems";

/** `apps/web/app` — the Next app directory, from this file at
 *  `apps/web/components/`. Asserted to exist and to hold the root layout
 *  below, so a move fails here rather than emptying the walk. */
const appDir = fileURLToPath(new URL("../app", import.meta.url));

const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist"]);
const PAGE_FILES = new Set(["page.tsx", "page.ts", "page.jsx", "page.js"]);

/** Every page file under the app directory, as absolute paths. Counted
 *  independently of the route parser below — that is the whole point. */
function pageFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...pageFilesUnder(full));
    else if (PAGE_FILES.has(entry)) found.push(full);
  }
  return found;
}

/** A page file's URL path: segments below `app/`, minus route groups like
 *  `(app)`, which Next does not put in the URL. */
function routeOf(pageFile: string): string {
  const segments = pageFile
    .slice(appDir.length)
    .split("/")
    .filter((s) => s && !PAGE_FILES.has(s) && !/^\(.*\)$/.test(s));
  return "/" + segments.join("/");
}

const pageFiles = pageFilesUnder(appDir);
const routes = new Set(pageFiles.map(routeOf));

const disabledEntries = NAV_GROUPS.flatMap((group) =>
  group.items.filter((item) => item.disabled).map((item) => ({ group: group.heading, href: item.href, label: item.label })),
);

describe("the route walk this census reasons about", () => {
  it("is rooted at the Next app directory", () => {
    expect(existsSync(appDir), appDir).toBe(true);
    // The root layout is the marker that this is the app root and not some
    // directory that merely exists.
    expect(existsSync(join(appDir, "layout.tsx")), "app/layout.tsx").toBe(true);
  });

  it("found pages, and parsed every one of them into a distinct route", () => {
    expect(pageFiles.length).toBeGreaterThan(NAV_ITEMS.length);
    // Parsed count vs. raw file count. A parser that drops or collides
    // routes diverges from a number that cannot drift with it.
    expect(routes.size, `parsed ${routes.size} routes from ${pageFiles.length} page files`).toBe(pageFiles.length);
  });

  it("can see every page the nav already links, so its scope is not wrong", () => {
    // NAV_ITEMS and NAV_FOOTER are hand-maintained and independent of this
    // walk. If the walk were mis-rooted these would all be missing.
    const navHrefs = [...NAV_ITEMS, ...NAV_FOOTER].map((item) => item.href);
    const unresolved = navHrefs.filter((href) => !routes.has(href));
    expect(unresolved, `nav hrefs with no page file — is the walk rooted right?`).toEqual([]);
  });
});

describe("a disabled nav entry", () => {
  it("never has a built route behind it", () => {
    const contradictions = disabledEntries.filter((entry) => routes.has(entry.href));
    expect(
      contradictions,
      contradictions.length === 0
        ? ""
        : `These nav entries are marked disabled ("coming soon") but their pages EXIST and render: ` +
          contradictions.map((c) => `${c.label} (${c.href}, in ${c.group})`).join(", ") +
          `. Remove the disabled flag — Ask and global search already send people to these pages, ` +
          `so the rail is the only surface calling them unbuilt. See NAV-IA-AUDIT.md addendum 2.`,
    ).toEqual([]);
  });
});

describe("Safety and Material orders, the two this census was written for", () => {
  const findGroup = (heading: string) => NAV_GROUPS.find((group) => group.heading === heading);

  it("are in their groups and clickable", () => {
    const compliance = findGroup("Compliance & safety");
    const logistics = findGroup("Logistics");
    expect(compliance?.items.map((i) => i.href)).toContain("/safety");
    expect(logistics?.items.map((i) => i.href)).toContain("/material-orders");

    // Findable means clickable, the same standard the Paper trail five are
    // held to in navItems.test.ts.
    for (const href of ["/safety", "/material-orders"]) {
      const entry = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href);
      expect(entry?.disabled, `${href} is greyed out again`).toBeFalsy();
    }
  });

  it("have the pages that made greying them out a contradiction", () => {
    expect(routes.has("/safety")).toBe(true);
    expect(routes.has("/material-orders")).toBe(true);
  });
});
