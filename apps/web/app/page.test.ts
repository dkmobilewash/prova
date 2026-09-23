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

/** The invented-statistic pattern, defined once and used by BOTH guards
 * below — the page-wide prose check and the narrower contrast-block one.
 * Two copies would drift, and the drift would be silent. */
const INVENTED_STATISTIC = /\d+%|\d+\s*(minutes?|hours?|days?)\s+(saved|per|of)/i;

/**
 * Returns the page markup with every `data-landing-panel` wrapper REMOVED,
 * element and contents, so what is left is the page's own prose.
 *
 * Depth-counted rather than regex-matched, because a panel is a `<div>`
 * full of nested `<div>`s and a non-greedy `.*?</div>` would cut at the
 * first inner close and leave most of a G703 behind — which would look
 * exactly like it worked. This codebase has paid twice for a parser that
 * matched slightly the wrong thing and stayed green about it.
 */
function stripPanels(source: string): string {
  let out = source;
  for (;;) {
    const attr = out.indexOf('data-landing-panel="');
    if (attr === -1) return out;
    const start = out.lastIndexOf("<div", attr);
    if (start === -1) throw new Error("data-landing-panel attribute with no opening <div>");
    let depth = 0;
    let i = start;
    let end = -1;
    while (i < out.length) {
      if (out.startsWith("<div", i)) {
        depth++;
        i += 4;
      } else if (out.startsWith("</div>", i)) {
        depth--;
        i += 6;
        if (depth === 0) {
          end = i;
          break;
        }
      } else {
        i++;
      }
    }
    if (end === -1) throw new Error("unbalanced <div> while stripping a panel wrapper");
    out = out.slice(0, start) + out.slice(end);
  }
}

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
    "Tell it what happened. Approve it with one tap.", // the Ask scene — after the documents, before the evidence
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
   * The hero's LEFT column had the other half of the same defect: ~336px
   * of bare background under the Sign in button at 1440, beside the lower
   * half of the panel. It is filled with the paperwork list — the
   * documents the product produces, by trade name. Three things are
   * asserted, each a way the fix could quietly stop being one:
   *
   *  - it is inside the hero <section>, not drifted below it;
   *  - it names the documents (a list hollowed out to two entries would
   *    still "be there");
   *  - it SURVIVES stripPanels, so the page-wide invented-statistic guard
   *    is reading it. "G702/G703" and "WH-347" carry digits, which is
   *    exactly why this block must stay prose rather than be wrapped as a
   *    panel to make a guard go quiet.
   */
  it("the hero's left column carries the paperwork list, inside the hero, as guarded prose", () => {
    const heroStart = html.indexOf("<section");
    const heroEnd = html.indexOf("</section>", heroStart);
    const hero = html.slice(heroStart, heroEnd);
    expect((html.match(/data-landing-paperwork/g) ?? []).length).toBe(1);
    expect(hero).toContain("data-landing-paperwork");
    expect(hero).toContain("The paperwork it produces");
    for (const doc of [
      "Pay applications",
      "Certified payroll",
      "Fringe remittance",
      "Change orders",
      "RFIs",
      "Submittals",
      "Daily field reports",
      // renderToStaticMarkup escapes the ampersand.
      "T&amp;M tickets",
    ]) {
      expect(hero).toContain(doc);
    }
    // It is prose, not a panel: the stripper must leave it in place.
    const prose = stripPanels(html);
    expect(prose).toContain("data-landing-paperwork");
    expect(prose).toContain("WH-347");
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

  /**
   * NO INVENTED STATISTIC ANYWHERE IN THE PAGE'S OWN PROSE — every
   * section, not just the contrast block.
   *
   * This exists because narrowing the older assertion to the contrast
   * section (which was right on its own terms — a G703 has a real "%"
   * column) quietly stopped checking nine other sections of marketing
   * copy. The whole credibility of this page is that there are no made-up
   * numbers on it, so that is the wrong coverage to trade away, and the
   * contrast block was never the only place a fabricated statistic could
   * appear — it was just the only place that existed when the first
   * version of this test was written.
   *
   * The right cut is by KIND, not by section: the drawn documents may
   * carry real percentages and hour counts (they are the document, and
   * they say they are illustrative), and every line of prose around them
   * may not. So the panels are removed and the pattern runs over the rest.
   *
   * The vacuity checks are the point of the first half of this test. A
   * stripper that matched nothing would return the page unchanged and this
   * would fail for the right reason; a stripper that ate the document
   * would return almost nothing and pass for entirely the wrong one. Both
   * are asserted against before the pattern is run at all.
   */
  it("carries no invented statistic in its own prose, in any section", () => {
    const prose = stripPanels(html);

    // 1. Every wrapper is gone — the stripper actually ran.
    expect(prose).not.toContain("data-landing-panel");
    // 2. It removed something substantial, not an empty match.
    expect(html.length - prose.length).toBeGreaterThan(3000);
    // 3. It did NOT eat the page: prose from the first section and from
    //    the second-to-last both survive, so the walk stopped at each
    //    panel's own closing tag rather than running to the end.
    expect(prose).toContain("The job-site system for union specialty-trade subcontractors.");
    expect(prose).toContain("Protecting yourself when it goes wrong");
    expect(prose).toContain("See it on your own job");

    expect(prose).not.toMatch(INVENTED_STATISTIC);
  });

  /**
   * THE HONESTY LINE IS THE ONE STRING ON THIS PAGE WORTH FAILING A BUILD
   * OVER, which is why it is asserted here even though the wording lives
   * in another lane's file (components/landing/panelChrome.tsx).
   *
   * These panels are the product's real column headers and row labels with
   * made-up numbers in them. That is legitimate exactly as long as the page
   * says so where a reader can see it. Silently dropping the caption turns
   * six honest drawings into six unlabelled claims about somebody's data,
   * and nothing else on the page would notice.
   *
   * `PanelFrame` renders it unconditionally rather than taking it as a
   * prop, so a caller cannot forget it — the assertion is that the frame
   * keeps doing that, one caption per placement.
   */
  it("every placed panel says its figures are illustrative, where a reader can see it", () => {
    const placements = (html.match(/data-landing-panel="/g) ?? []).length;
    const captions = (html.match(/[Ff]igures are illustrative/g) ?? []).length;
    expect(placements).toBeGreaterThan(0);
    expect(captions).toBe(placements);
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

  /**
   * The fact ticker sits directly under the hero and above the contrast
   * section — one placement, outside any panel wrapper (so the page-wide
   * statistic guard above runs over its text) and outside any <Reveal>
   * (so the derived reveal count below stays derived). The position is
   * asserted, not just the presence: a ticker that drifted to the footer
   * would still "be on the page" and would have stopped doing the one
   * thing it was placed to do, which is put motion on the first screen.
   */
  it("places the fact ticker once, between the hero and the contrast section, outside every panel and reveal", () => {
    const tickers = html.match(/data-landing-ticker/g) ?? [];
    expect(tickers.length).toBe(1);
    const at = html.indexOf("data-landing-ticker");
    const heroEnd = html.indexOf("</section>");
    const contrast = html.indexOf("The old way, and the C Stream way");
    expect(at).toBeGreaterThan(heroEnd);
    expect(at).toBeLessThan(contrast);
    expect(at).toBeLessThan(html.indexOf("data-reveal="));
    // Still present after the panels are stripped — it is prose, and the
    // guard must be looking at it.
    expect(stripPanels(html)).toContain("data-landing-ticker");
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
    /**
     * The contrast block specifically, and it is NOT the page-wide guard
     * — that one is "carries no invented statistic in its own prose"
     * above, which strips the drawn documents and checks everything else.
     * Read the two together: this one would be a loss of coverage on its
     * own, and it was one for exactly as long as it took to be reviewed.
     *
     * Kept alongside it because the two check different things. The
     * page-wide guard asks "is there a fabricated number in the copy".
     * This one additionally pins the five old-way lines and their five
     * answers by name, so the section cannot be quietly hollowed out into
     * something that still passes a regex.
     *
     * The scope is derived from the section headings either side of it
     * rather than a line number, and asserted non-empty first — a slice
     * that silently came back empty would pass every assertion after it,
     * which is the empty-question failure CLAUDE.md records twice.
     */
    const start = html.indexOf("The old way, and the C Stream way");
    const end = html.indexOf("Getting paid");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const contrast = html.slice(start, end);
    expect(contrast.length).toBeGreaterThan(500);
    expect(contrast).not.toMatch(INVENTED_STATISTIC);
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
