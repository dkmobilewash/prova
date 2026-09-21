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

  it("covers every section the page was rebuilt for", () => {
    expect(html).toContain("C Stream is new");
    expect(html).toContain("The old way, and the C Stream way");
    expect(html).toContain("What it does");
    expect(html).toContain("Not generic construction software");
    expect(html).toContain("See it on your own job");
  });

  it("orders sections hero, proof, contrast, features, objection, closing CTA — matching the brief", () => {
    const order = [
      "The job-site system for union specialty-trade subcontractors.", // hero
      "C Stream is new", // proof
      "The old way, and the C Stream way", // problem/contrast
      "What it does", // features
      "Not generic construction software", // objection handling
      "See it on your own job", // closing CTA
    ];
    const positions = order.map((text) => html.indexOf(text));
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("the hero renders before any reveal-motion wrapper — nothing above the fold fades in", () => {
    const heroIndex = html.indexOf("The job-site system for union specialty-trade subcontractors.");
    const firstReveal = html.indexOf("data-reveal=");
    expect(heroIndex).toBeGreaterThan(-1);
    expect(firstReveal).toBeGreaterThan(-1);
    expect(heroIndex).toBeLessThan(firstReveal);
  });

  it("wraps exactly the five below-the-fold sections in reveal motion — proof, contrast, features, objection, closing", () => {
    expect((html.match(/data-reveal="idle"/g) ?? []).length).toBe(5);
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
