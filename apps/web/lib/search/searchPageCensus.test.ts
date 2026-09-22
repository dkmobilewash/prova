import { dirname, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { appDir, pages } from "@/lib/walkthroughs/census-helpers";
import { WALKTHROUGHS } from "@/lib/walkthroughs";
import { reachableWalkthroughs } from "@/lib/ask/appHelp";
import type { Principal } from "@/lib/permissions";
import { globalSearch, isOpenableRoute } from "./query";
import type { SearchProvider } from "./types";

/**
 * Global search never offers a Pages result that cannot be opened.
 *
 * THE DEFECT. `globalSearch` set `href: match.route`, and a walkthrough's
 * `route` is a Next.js route PATTERN. Six of them are job-detail tabs
 * written as `/jobs/[id]/billing` and friends, so searching "billing",
 * "crew", "estimate", "photos" or "field reports" offered a row that
 * navigated to `/jobs/%5Bid%5D/billing` — "This page doesn't exist."
 * Shipped in #386; found by the first pilot contractor in his first
 * session.
 *
 * WHY THIS FILE AND NOT ONE ASSERTION. The registry is the moving part:
 * the next job-detail tab to get a walkthrough would reintroduce the bug
 * with no code change at all in `query.ts`. So the check is written
 * against the REGISTRY, not against a list of six routes.
 *
 * AND WHY IT CANNOT PASS VACUOUSLY. "No page result is unopenable" is
 * trivially true when there are no page results, and equally true if the
 * registry ever stopped containing a dynamic route — at which point this
 * file would be guarding nothing while staying green, which is the exact
 * shape CLAUDE.md records for `scratch-cleanup-order.test.ts` and
 * `theme-contrast.test.ts`. So the size of BOTH sets is pinned first:
 * there must still be dynamic routes in the registry for the filter to
 * have something to remove, and the searches below must still return
 * openable pages for their absence to mean anything.
 */

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };

/** No provider at all: this file is about the PAGE half, and an empty
 * registry keeps Prisma out of the test entirely. */
const NO_PROVIDERS: readonly SearchProvider[] = [];

/** The terms the pilot reported, plus the two that reach a dynamic route
 * without naming a tab. */
const REPORTED_TERMS = ["billing", "crew", "estimate", "photos", "field reports", "time"];

const DYNAMIC_ROUTES = WALKTHROUGHS.map((w) => w.route).filter((route) => /\[/.test(route));
const STATIC_ROUTES = WALKTHROUGHS.map((w) => w.route).filter((route) => !/\[/.test(route));

async function pagesFor(query: string, principal: Principal) {
  const response = await globalSearch({ companyId: "co_1", principal, query }, NO_PROVIDERS);
  return response.pages;
}

describe("the census sees what it reasons about", () => {
  it("still has dynamic routes in the registry for the filter to remove", () => {
    // If this ever goes to zero, every other assertion in this file passes
    // for free and guards nothing. It is a finding, not a pass.
    expect(
      DYNAMIC_ROUTES.length,
      "no walkthrough has a dynamic route any more — this census now proves nothing; delete it or re-aim it",
    ).toBeGreaterThan(0);
    expect(STATIC_ROUTES.length).toBeGreaterThan(20);
  });

  it("agrees with the page files on disk about which routes are dynamic", () => {
    // The independent source. `pages` is built by walking app/ for
    // page.tsx files and knows nothing about this file's regex, so the
    // question "is this route openable" gets answered twice, from the
    // registry string and from the DIRECTORY the page actually sits in.
    // A route Next.js will treat as dynamic has a `[…]` directory; if
    // `isOpenableRoute` ever disagreed with the filesystem, search would
    // be filtering on something other than what 404s.
    for (const route of WALKTHROUGHS.map((w) => w.route)) {
      const file = pages.get(route);
      expect(file, `${route} has no page.tsx`).toBeDefined();
      const dynamicOnDisk = relative(appDir, dirname(file!)).split(/[\\/]/).some((segment) => /^\[.*\]$/.test(segment));
      expect(
        isOpenableRoute(route),
        `${route}: isOpenableRoute says openable=${isOpenableRoute(route)}, but its page.tsx sits at ` +
          `${relative(appDir, file!)}, which Next ${dynamicOnDisk ? "DOES" : "does not"} treat as dynamic`,
      ).toBe(!dynamicOnDisk);
    }
  });
});

describe("isOpenableRoute", () => {
  it("rejects a route pattern and accepts a real path", () => {
    expect(isOpenableRoute("/jobs/[id]/billing")).toBe(false);
    expect(isOpenableRoute("/jobs/[id]")).toBe(false);
    expect(isOpenableRoute("/jobs")).toBe(true);
    expect(isOpenableRoute("/settings/integrations")).toBe(true);
  });

  it("rejects a catch-all too, not just the one bracket shape in use today", () => {
    expect(isOpenableRoute("/docs/[...slug]")).toBe(false);
    expect(isOpenableRoute("/shop/[[...filters]]")).toBe(false);
  });
});

describe("global search never offers a page it cannot open", () => {
  it("returns no href containing a route pattern, for any reported term", async () => {
    for (const term of REPORTED_TERMS) {
      for (const principal of [OWNER, FIELD]) {
        const found = await pagesFor(term, principal);
        const broken = found.filter((page) => /[[\]]/.test(page.href) || /%5B/i.test(page.href));
        expect(
          broken.map((page) => `${term}: ${page.title} -> ${page.href}`),
          "a Pages result whose href is a route pattern, which navigates to /jobs/%5Bid%5D/… and 404s",
        ).toEqual([]);
      }
    }
  });

  it("drops exactly the dynamic entries and keeps the real ones", async () => {
    // THE POSITIVE HALF, and the reason the test above is not enough on
    // its own: returning nothing at all would satisfy it perfectly.
    const photos = await pagesFor("photos", OWNER);
    expect(photos.map((page) => page.href)).toContain("/photos");

    const reports = await pagesFor("field reports", OWNER);
    expect(reports.map((page) => page.href)).toContain("/field-reports");

    // And the six that go: "billing" matched exactly one walkthrough and
    // it was the unopenable one, so this search legitimately has no page
    // to offer. Recorded as an expectation rather than left to be
    // rediscovered as a regression.
    expect(await pagesFor("billing", OWNER)).toEqual([]);
  });

  it("every href it does return is a real page file on disk", async () => {
    const seen: string[] = [];
    for (const term of [...REPORTED_TERMS, "safety", "punch", "submittal", "vendor", "schedule"]) {
      for (const page of await pagesFor(term, OWNER)) {
        seen.push(page.href);
        expect(pages.has(page.href), `${page.href} is offered by search but has no page.tsx`).toBe(true);
      }
    }
    // Vacuity floor: if these searches return nothing, the loop above is
    // an empty loop and asserts nothing.
    expect(seen.length, "these searches returned no pages at all — is the registry reachable?").toBeGreaterThan(4);
  });

  it("filters before the six-result cap, so real pages are not crowded out", async () => {
    // The dynamic entries score highly (their titles are "A job — crew"),
    // so slicing first would spend the budget on rows that were then
    // dropped. "crew" is the case that exercises it: the dynamic entry
    // outranks /certifications.
    const crew = await pagesFor("crew", OWNER);
    expect(crew.length).toBeGreaterThan(0);
  });
});

describe("the capability filter now applies to every page result", () => {
  it("does not hand a FIELD member a page an OWNER-only route would withhold", async () => {
    // Measured on origin/main before the fix: FIELD and OWNER both got
    // `/jobs/[id]/billing` and `/jobs/[id]/estimate`, because
    // capabilityForRoute() returns null for a DYNAMIC route — it reads
    // ROUTE_CAPABILITY, which is keyed on static hrefs. Those six entries
    // were the only ones in the index bypassing the filter.
    for (const term of ["billing", "estimate"]) {
      const field = await pagesFor(term, FIELD);
      const owner = await pagesFor(term, OWNER);
      expect(field.map((p) => p.href)).toEqual(owner.map((p) => p.href));
      expect(field.some((p) => p.href.includes("[")), `${term} still leaks a dynamic route to FIELD`).toBe(false);
    }
  });

  it("still differs by role where the registry says it should", () => {
    // The control. If reachableWalkthroughs stopped filtering at all, the
    // assertion above would pass for the wrong reason.
    const forOwner = reachableWalkthroughs(OWNER).length;
    const forField = reachableWalkthroughs(FIELD).length;
    expect(forField, "the capability filter is not filtering anything").toBeLessThan(forOwner);
  });
});
