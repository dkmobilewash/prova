import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_ROUTES, PUBLIC_ROUTE_EXCLUSIONS } from "./publicRoutes";

/**
 * PINS THE PUBLIC E2E ROUTE TABLE TO THE TWO THINGS THAT DECIDE WHAT IS
 * PUBLIC — `middleware.ts` and the filesystem — so that adding a page
 * anyone can reach without signing in fails the build until somebody has
 * said whether it is walked at phone width or deliberately is not.
 *
 * This lives in the UNIT suite on purpose. The E2E suite it guards does
 * not run on every push; this does, and a guard that only runs when the
 * thing it guards runs is not a guard.
 *
 * WHY IT ASSERTS THREE SIZES AND NOT JUST THE SET. CLAUDE.md has two
 * entries about exactly this file's failure mode, learned twice:
 *
 *   - a check that DERIVES its input can get an empty question rather than
 *     a wrong answer, and only the wrong answer looks like a failure —
 *     "nothing is ever missing from an empty list" (the migration-SQL
 *     parser that saw 180 of 181 foreign keys and passed thirteen tests);
 *   - a check can have the right pattern and the WRONG SCOPE, which no
 *     size assertion on its own can see — "nothing is ever missing from a
 *     directory you do not walk" (the contrast census that could not see
 *     `packages/ui`).
 *
 * So the regex that reads the protected list asserts it found a plausible
 * number of entries, the directory walk asserts it found the page files it
 * must obviously find, and the walk is rooted at `app/` — the only place
 * Next will route a page from, which is a scope that cannot drift with the
 * test.
 */

const webRoot = path.resolve(__dirname, "../..");
const appDir = path.join(webRoot, "app");
const middlewareSource = readFileSync(path.join(webRoot, "middleware.ts"), "utf8");

/** The prefixes `isProtectedRoute` matches, lifted from its own literal. */
function protectedPrefixes(): string[] {
  const block = middlewareSource.match(/const isProtectedRoute = createRouteMatcher\(\[([\s\S]*?)\n\]\);/);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\(\.\*\)$/, "").replace(/\/$/, ""));
}

/** Every `page.tsx` under `app/`, as the route it serves. Route GROUPS —
 * `(app)` — are skipped wholesale: everything in that group is behind the
 * signed-in shell, and the protected list below is what actually decides. */
function pageRoutes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith("(") || entry.name === "api" || entry.name === "node_modules") continue;
      out.push(...pageRoutes(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === "page.tsx") {
      out.push(prefix === "" ? "/" : prefix);
    }
  }
  return out;
}

const prefixes = protectedPrefixes();
const routes = pageRoutes(appDir);
const isProtected = (route: string) =>
  prefixes.some((p) => p !== "" && (route === p || route.startsWith(`${p}/`)));
const publicOnDisk = routes.filter((r) => !isProtected(r)).sort();

describe("the public E2E route table", () => {
  it("parsed a plausible protected list out of middleware.ts", () => {
    // ~35 entries today. A regex that stopped matching would return 0 and
    // then EVERY route would look public, which is a failure that reads as
    // "the table is missing 40 routes" rather than as a parse error — so
    // it is named here instead.
    expect(
      prefixes.length,
      "middleware.ts's isProtectedRoute literal did not parse — fix the pattern in this file, do not adjust the table",
    ).toBeGreaterThan(25);
    expect(prefixes).toContain("/dashboard");
    expect(prefixes).toContain("/welcome");
  });

  it("walked a plausible number of page files under app/", () => {
    expect(routes.length, "the walk of app/ found almost nothing — check appDir").toBeGreaterThan(5);
    // Two anchors the walk must find or it is looking in the wrong place:
    // one public, one that only exists inside a route group's sibling.
    expect(routes).toContain("/pilot");
    expect(routes).toContain("/");
  });

  it("walks or excuses every public page, with no route unaccounted for", () => {
    const covered = new Set<string>([
      ...PUBLIC_ROUTES.map((r) => r.pattern),
      ...Object.keys(PUBLIC_ROUTE_EXCLUSIONS),
    ]);
    const unaccounted = publicOnDisk.filter((r) => !covered.has(r));
    expect(
      unaccounted,
      "these pages need no sign-in and nothing checks them at phone width — add them to PUBLIC_ROUTES, " +
        "or to PUBLIC_ROUTE_EXCLUSIONS with the reason",
    ).toEqual([]);
  });

  it("names no route that does not exist", () => {
    const onDisk = new Set(publicOnDisk);
    const stale = [...PUBLIC_ROUTES.map((r) => r.pattern), ...Object.keys(PUBLIC_ROUTE_EXCLUSIONS)].filter(
      (p) => !onDisk.has(p),
    );
    expect(stale, "the table names a page that is gone, or has been made protected").toEqual([]);
  });

  it("gives every exclusion a reason", () => {
    for (const [route, reason] of Object.entries(PUBLIC_ROUTE_EXCLUSIONS)) {
      expect(reason.length, `${route} is excluded with no reason worth reading`).toBeGreaterThan(20);
    }
  });

  it("asserts something only the page itself renders", () => {
    // The vacuous-watcher guard, as a rule rather than a hope: a `mustShow`
    // that the app shell, a spinner or an empty state could also produce
    // makes the width assertion beside it meaningless.
    for (const route of PUBLIC_ROUTES) {
      expect(route.mustShow.length, `${route.path}: mustShow is too short to be distinctive`).toBeGreaterThan(3);
    }
  });
});
