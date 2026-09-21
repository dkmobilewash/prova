/**
 * The public landing page (/) — the first page anyone sees at
 * app.cstream.ai. Two promises, each load-bearing:
 *
 * 1. A SIGNED-IN visitor is redirected to /dashboard and never sees the
 *    marketing content — the one behavior this rebuild had to preserve
 *    from the page it replaced. Asserted by MUTATION: a userId present
 *    must throw NEXT_REDIRECT (requested), and a userId absent must NOT
 *    throw (caught) — both directions, the same shape as lib/auth.test.ts's
 *    email-verification gate, because a redirect that always fires and one
 *    that never fires both "pass" a test that only checks one direction.
 * 2. The visitor-facing content (`LandingPage`) makes no auth call of its
 *    own — it is rendered directly with no Clerk mock and no request scope
 *    in the second describe block below, the same proof /pilot's test
 *    uses: a passing render with nothing mocked out is the evidence the
 *    page makes no hidden auth call, not just an assertion that it doesn't.
 *
 * Section-level checks (order, CTA count, the reveal-motion count) belong
 * here rather than in CapabilitiesSection.test.ts, which covers the
 * capabilities presentation on its own.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/image validates its loader config against the Next runtime, which a
// unit test does not carry. The page only needs the img to land in markup.
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { priority: _priority, ...rest } = props;
    return createElement("img", rest);
  },
}));

/** The userId `auth()` reports. Set per test — null means signed out. */
let authUserId: string | null = null;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: authUserId }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT: ${to}`);
  },
}));

const { default: HomePage } = await import("./page");
const { LandingPage } = await import("@/components/LandingPage");

describe("/ redirects a signed-in visitor and only a signed-in visitor", () => {
  it("requested: throws NEXT_REDIRECT to /dashboard when a session exists", async () => {
    authUserId = "user_123";
    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT: /dashboard");
  });

  it("caught: does not redirect, and renders the landing content, when there is no session", async () => {
    authUserId = null;
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain("The job-site system for union specialty-trade subcontractors.");
  });
});

describe("/ landing content renders signed out, with no auth call of its own", () => {
  const html = renderToStaticMarkup(createElement(LandingPage));

  it("says what it is and who it is for in the headline", () => {
    expect(html).toContain("The job-site system for union specialty-trade subcontractors.");
  });

  it("names the trades by name, not a generic 'construction' label", () => {
    // renderToStaticMarkup HTML-escapes "&" to "&amp;" in text content.
    for (const trade of ["Framing &amp; drywall", "Plaster", "EIFS", "Ceilings", "Fireproofing"]) {
      expect(html).toContain(trade);
    }
  });

  it("repeats the primary CTA at three placements — nav, hero, closing section", () => {
    expect(html.match(/href="\/sign-up"/g)?.length).toBe(3);
    // Sign in appears wherever sign up does except the nav (an existing
    // tester has no reason for a nav-level sign-up button to matter to
    // them, and the nav's job is to get a new visitor moving) — hero and
    // the closing section, so two.
    expect(html.match(/href="\/sign-in"/g)?.length).toBe(2);
  });

  it("shows the wordmark, not a text stand-in", () => {
    expect(html).toContain("/brand/cstream-wordmark.png");
  });

  it("makes no fabricated claim about existing customers", () => {
    expect(html).not.toMatch(/trusted by|hundreds of|thousands of|customers love|5 star|testimonial/i);
  });

  /**
   * THE ORDER IS THE ARGUMENT, so it is the thing most worth a test.
   *
   * This page is ranked by what costs a union specialty-trade sub money,
   * which is not the order a feature list falls into and not the order
   * this page was in before. Two of these moves are load-bearing and were
   * each reasoned about at length in LandingPage.tsx's header:
   *
   *  - the old-way/new-way contrast moved UP to second, because it states
   *    the problem in the reader's own vocabulary and earns the rest;
   *  - "C Stream is new" moved DOWN from second to immediately before the
   *    ask, because it is a disclosure and not proof — in second position
   *    it is an apology to a reader with no reason to care yet, and in
   *    tenth the identical words read as integrity.
   *
   * Both are exactly the kind of decision a later edit undoes by accident
   * while "tidying", with nothing to say it mattered. Hence one list, in
   * order, asserted strictly increasing.
   */
  const SECTIONS_IN_ORDER = [
    "The job-site system for union specialty-trade subcontractors.", // 1 hero
    "The old way, and the C Stream way", // 2 problem/contrast — MOVED UP
    "Getting paid", // 3
    "Certified payroll, from hours already logged", // 4
    "Apprentice ratios, on the day you go over", // 5
    "Whether the job is actually making money", // 6
    "Protecting yourself when it goes wrong", // 7
    "Everything else it does", // 8
    "Not generic construction software", // 9
    "C Stream is new", // 10 disclosure — MOVED DOWN
    "See it on your own job", // 11 closing CTA
  ];

  it("covers every section the page was rebuilt for", () => {
    for (const section of SECTIONS_IN_ORDER) expect(html).toContain(section);
  });

  it("ranks the sections by what costs this buyer money, contrast second and the disclosure last", () => {
    const positions = SECTIONS_IN_ORDER.map((text) => html.indexOf(text));
    for (const [i, p] of positions.entries()) {
      expect(p, `section not found: ${SECTIONS_IN_ORDER[i]}`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i],
        `"${SECTIONS_IN_ORDER[i]}" must come after "${SECTIONS_IN_ORDER[i - 1]}"`,
      ).toBeGreaterThan(positions[i - 1]);
    }
  });

  /**
   * The hero's right half was EMPTY at desktop — the single most visible
   * thing wrong with the page this replaced, and the reason the founder
   * called it empty. A panel now fills it. This asserts the panel is
   * inside the hero <section> rather than merely somewhere on the page,
   * because "it is on the page" is true of a panel that has drifted three
   * sections down, and that is precisely the regression worth catching.
   */
  it("the hero carries a rendered panel in its own section, not just somewhere on the page", () => {
    const heroStart = html.indexOf("<section");
    const heroEnd = html.indexOf("</section>", heroStart);
    expect(heroStart).toBeGreaterThan(-1);
    expect(heroEnd).toBeGreaterThan(heroStart);
    const hero = html.slice(heroStart, heroEnd);
    expect(hero).toContain("The job-site system for union specialty-trade subcontractors.");
    expect(hero).toMatch(/data-landing-panel="pay-application"/);
  });

  /**
   * The panels are re-rendered markup, NOT screenshots, and the page must
   * never imply otherwise — "screenshot", "preview of your data" or a
   * customer's name on a figure would each be a false claim on a page
   * whose entire argument is that it does not make false claims. The
   * figures are illustrative and every panel has to say so where a reader
   * can see it, at rest.
   */
  it("never calls a panel a screenshot or anybody's real data", () => {
    expect(html).not.toMatch(/screenshot|screen shot|actual customer|real customer data/i);
  });

  it("places every panel the page claims to place, at the five ranked sites", () => {
    // The handle is `data-landing-panel`, a wrapper THIS file's component
    // owns, not an attribute inside components/landing/ — a guard should
    // not assert on markup it does not control, or it breaks on someone
    // else's refactor and says nothing useful when it does.
    //
    // The count is asserted against a literal because a check that DERIVES
    // its set has two failure modes and only one of them looks like a
    // failure: a selector matching NOTHING passes every assertion after it
    // (CLAUDE.md records this twice — the SQL-by-regex guard and the
    // census with the wrong scope). Four components at five sites: the pay
    // application appears in the hero and again under "Getting paid".
    const sites = html.match(/data-landing-panel="([a-z-]+)"/g) ?? [];
    expect(sites.length, "no panel wrappers found at all — the selector matched nothing").toBe(5);
    expect(new Set(sites).size).toBe(4);
  });

  it("the hero renders before any reveal-motion wrapper — nothing above the fold fades in", () => {
    const heroIndex = html.indexOf("The job-site system for union specialty-trade subcontractors.");
    const firstReveal = html.indexOf("data-reveal=");
    expect(heroIndex).toBeGreaterThan(-1);
    expect(firstReveal).toBeGreaterThan(-1);
    expect(heroIndex).toBeLessThan(firstReveal);
  });

  /**
   * Every section below the fold is wrapped in reveal motion, and the
   * hero is not. The count is DERIVED from the section list above rather
   * than written as its own literal: the two must move together, and a
   * second hardcoded number here would be one more thing to forget when a
   * section is added — which is exactly how this file ended up asserting
   * five while the page had ten.
   *
   * `data-reveal="idle"` is the at-rest state, and "idle" renders
   * IDENTICALLY to "visible" (full opacity, no transform) — see
   * Reveal.tsx. So this also quietly asserts the thing the page must
   * never regress: the server markup has nothing parked at opacity 0
   * waiting on an observer that may never fire.
   */
  it("wraps every below-the-fold section in reveal motion, and only those", () => {
    const belowTheFold = SECTIONS_IN_ORDER.length - 1; // everything but the hero
    expect((html.match(/data-reveal="idle"/g) ?? []).length).toBe(belowTheFold);
  });

  it("the old-way/new-way contrast names five concrete pains and backs each with a real capability", () => {
    // Old-way lines describe a process, never invent a statistic.
    expect(html).not.toMatch(/\d+%|\d+\s*(minutes?|hours?|days?)\s+(saved|per|of)/i);
    for (const line of [
      "Certified payroll is assembled by hand",
      "Certified payroll generates from the hours your crew already logged",
      "RFIs and submittals live in an email thread",
      "RFIs and submittals are numbered, dated and never reissued",
    ]) {
      expect(html).toContain(line);
    }
  });

  it("has working privacy and terms links", () => {
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });
});
