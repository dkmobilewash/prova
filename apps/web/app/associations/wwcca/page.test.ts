/**
 * /associations/wwcca — the page for WWCCA member contractors. What this file
 * holds it to, in the order a mistake would cost the most:
 *
 * 1. IT IS NOT DISCOVERABLE. `noindex, nofollow` in the metadata, and no
 *    source file anywhere in the web app or the shared UI package links to
 *    /associations. The page is to be shown to the association's Innovation
 *    Committee on request; until the association agrees to the use of its
 *    name, a search result or a stray nav link is a public claim made on its
 *    behalf.
 * 2. IT CLAIMS NO ENDORSEMENT. There is no partnership, endorsement or
 *    member-discount program. The rendered page is scanned for the phrases
 *    that would say otherwise, and for the association's logo.
 * 3. IT INVENTS NO NUMBERS. The one figure is the founding price Cyrus set
 *    ($399/month, flat); no other dollar figure, no percentage, no lock
 *    length, no counter, outside the illustrative product panels.
 * 4. THE SWITCH WORKS. `WWCCA.enabled = false` turns the route into a 404 —
 *    executed below, not asserted from the source.
 * 5. It renders signed out, with no Clerk mock and no request scope, which is
 *    the proof it makes no auth call (same method as /pilot's test).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { priority: _priority, ...rest } = props;
    return createElement("img", rest);
  },
}));

const { default: WwccaAssociationPage, metadata } = await import("./page");
const { WWCCA, FOUNDING_OFFER } = await import("@/components/associations/wwcca");

const html = renderToStaticMarkup(createElement(WwccaAssociationPage));

/** The page without its four product panels. The panels are figures of real
 * documents with illustrative money in them, and that is fine and captioned;
 * everything else on the page is prose and must carry no invented figure.
 * PanelFrame renders each as one <figure>, and figures do not nest. */
const prose = html.replace(/<figure[\s\S]*?<\/figure>/g, "");

/** What renderToStaticMarkup does to text, so a constant can be found in it. */
const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const repoRoot = resolve(webRoot, "../..");

describe("/associations/wwcca is not discoverable", () => {
  it("tells search engines not to index it or follow its links", () => {
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    });
  });

  /**
   * NOTHING LINKS HERE. Every source file that could render a link — the
   * web app's routes, components and lib, the shared UI package, and the
   * public folder (where a sitemap.xml or robots.txt would live) — is read
   * with comments stripped, and none may mention /associations except the
   * page's own directory and components/associations.
   *
   * SCOPE AND SIZE are both pinned, per CLAUDE.md's rule for any check that
   * derives the set it reasons about: the walk must include the three places
   * a link would most plausibly be added (the landing page, /pilot, the
   * nav), and must read more than a floor of files, so a root that resolves
   * to nothing fails instead of passing an empty scan.
   */
  it("is linked from nowhere in the app", () => {
    const roots = ["apps/web/app", "apps/web/components", "apps/web/lib", "apps/web/public", "packages/ui/src"];
    const allowed = ["apps/web/app/associations/", "apps/web/components/associations/"];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|mjs|js|xml|txt|json|webmanifest)$/.test(name)) {
          files.push(relative(repoRoot, full).split(sep).join("/"));
        }
      }
    };
    for (const root of roots) {
      const full = resolve(repoRoot, root);
      expect(statSync(full).isDirectory(), `${root} does not exist — the scan would miss it`).toBe(true);
      walk(full);
    }

    for (const mustSee of [
      "apps/web/components/LandingPage.tsx",
      "apps/web/app/pilot/page.tsx",
      "apps/web/components/navItems.tsx",
      "apps/web/app/page.tsx",
    ]) {
      expect(files, `the scan did not read ${mustSee}`).toContain(mustSee);
    }
    expect(files.length).toBeGreaterThan(300);

    const linking = files.filter((path) => {
      if (allowed.some((prefix) => path.startsWith(prefix))) return false;
      const source = readFileSync(resolve(repoRoot, path), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      return source.includes("/associations");
    });
    expect(
      linking,
      "these files link to /associations. The WWCCA page must stay unlinked until the " +
        "association has seen it and approved the use of its name — see " +
        "components/associations/wwcca.ts.",
    ).toEqual([]);
  });

  it("is absent from middleware's protected list, so the committee can open it without an account", () => {
    const middleware = readFileSync(resolve(webRoot, "middleware.ts"), "utf8");
    const listStart = middleware.indexOf("createRouteMatcher([");
    const listEnd = middleware.indexOf("]);", listStart);
    expect(listStart, "isProtectedRoute moved — update this test").toBeGreaterThan(-1);
    expect(middleware.slice(listStart, listEnd)).not.toContain("/associations");
  });
});

describe("/associations/wwcca claims no endorsement", () => {
  it("prints the independence disclosure", () => {
    expect(html).toContain("not published, sponsored or endorsed by the WWCCA");
  });

  /** Run over the page WITHOUT the disclosure, which is the one sentence
   * allowed to use these words — to deny them. A polarity-blind guard is the
   * landing page's lesson (app/page.test.ts): exempt the one sanctioned
   * sentence by its exact text rather than teach the regex about negation. */
  it("uses none of the language of a partnership or an association program", () => {
    const withoutDisclosure = prose.replace(escapeHtml(WWCCA.independence), "");
    expect(withoutDisclosure).not.toBe(prose);
    expect(withoutDisclosure).not.toMatch(
      /endorse|official partner|in partnership|partnered with|member discount|exclusive|approved by|recommended by|sponsored/i,
    );
  });

  it("shows no image but C Stream's own wordmark — no association logo", () => {
    const sources = [...html.matchAll(/<img[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
    expect(sources).toEqual(["/brand/cstream-wordmark.png"]);
  });

  it("frames the founding offer as C Stream's, made to the association's members", () => {
    expect(html).toContain("C Stream is offering founding-member pricing to the first 10 WWCCA member companies.");
    expect(html).toContain("a lower price than anyone who comes after them, locked in");
    // Undecided, and advised against: no lifetime promise may appear.
    expect(html).not.toMatch(/for life|lifetime|as long as you stay/i);
    expect(html).toContain("the founders&#x27; direct time");
  });
});

describe("/associations/wwcca prints one number, the one that was set", () => {
  it("prints the founding price that was set, and the 60 days as onboarding", () => {
    expect(FOUNDING_OFFER.price).toBe("$399 per month, per company — flat, with unlimited users.");
    expect(html).toContain(escapeHtml(FOUNDING_OFFER.price!));
    expect(html).toContain("The first 60 days are free. That is onboarding, not a trial");
  });

  /** The price is the ONE dollar figure allowed outside the panels, so it is
   * removed by its exact text first and the rest must carry none. */
  it("carries no other dollar figure, percentage, undecided term or scarcity counter outside the panels", () => {
    const withoutPrice = prose.replace(escapeHtml(FOUNDING_OFFER.price!), "");
    expect(withoutPrice).not.toBe(prose);
    expect(withoutPrice).not.toMatch(/\$\s?\d/);
    expect(prose).not.toMatch(/\d\s?%|percent/i);
    expect(prose).not.toMatch(/free trial|\btrial period/i);
    expect(prose).not.toMatch(/\bAI\b|allowance|tokens?\b/);
    expect(prose).not.toMatch(/spots? (left|remaining)|\bonly \d+ left|countdown|hurry|ends (soon|on)/i);
  });

  it("keeps the illustrative-figures caption on every panel", () => {
    const figures = html.match(/<figure/g)?.length ?? 0;
    expect(figures).toBe(4);
    expect(html.match(/Figures are illustrative/g)?.length).toBe(figures);
  });
});

describe("/associations/wwcca names its limits", () => {
  it("says the WH-347 prints page 1 only and overtime is not calculated", () => {
    expect(html).toContain("The WH-347 prints page 1 only");
    expect(html).toContain("Overtime is entered, not calculated");
  });
});

describe("/associations/wwcca renders signed out", () => {
  it("leads with the one-entry argument and sends a visitor to /sign-up", () => {
    expect(html).toContain("The week\u2019s hours, entered once.");
    expect(html).toContain(WWCCA.eyebrow);
    expect(html).toContain('href="/sign-up"');
  });

  it("imports no auth, session or database module", () => {
    for (const file of ["./page.tsx", "../../../components/associations/WwccaLanding.tsx"]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      expect(source).not.toMatch(/@clerk\//);
      expect(source).not.toMatch(/@\/lib\/auth/);
      expect(source).not.toMatch(/@prova\/db|@\/lib\/db/);
      expect(source).not.toContain("data-tour");
    }
  });
});

describe("/associations/wwcca switches off in one line", () => {
  it("404s when WWCCA.enabled is false", async () => {
    vi.resetModules();
    vi.doMock("@/components/associations/wwcca", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/components/associations/wwcca")>();
      return { ...real, WWCCA: { ...real.WWCCA, enabled: false } };
    });
    const { default: Disabled } = await import("./page");
    expect(() => Disabled()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    vi.doUnmock("@/components/associations/wwcca");
  });
});
