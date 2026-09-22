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
 * 6. IT CLAIMS NOTHING THE PRODUCT DOES NOT DO — no filing, no calculated
 *    overtime, no mail-ready remittance — and the association's logo slot
 *    stays null until the association gives written permission.
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
    const allowed = [
      "apps/web/app/associations/",
      "apps/web/components/associations/",
      // The inbound-link census NAMES this route in its list of pages reached
      // from outside the app — the opposite of a link, and a test file that
      // renders nothing. Exempted by exact path, not by "*.test.ts", so a
      // test that did start rendering a link somewhere is still caught.
      "apps/web/lib/routeInboundLinks.test.ts",
    ];
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

describe("/associations/wwcca fills the hero's right half", () => {
  /** The hero is everything before the first </section>. Its right half was
   * bare at desktop width; the WH-347 panel is what fills it. Asserted on
   * the markup, so moving the panel back down the page fails here. Layout
   * itself (top alignment, stacking at 320/375) is only measurable in a real
   * browser — e2e/specs/public-layout.public.spec.ts walks this page at
   * those widths. */
  const hero = html.slice(0, html.indexOf("</section>"));

  it("puts the certified-payroll panel beside the headline, top-aligned", () => {
    expect(hero).toContain("The week’s hours, entered once.");
    expect(hero).toContain("Form WH-347");
    expect(hero.match(/<figure/g)?.length).toBe(1);
    expect(hero).toMatch(/class="[^"]*\bitems-start\b[^"]*lg:grid-cols-/);
    expect(hero).not.toMatch(/class="[^"]*\bitems-center\b[^"]*lg:grid-cols-/);
  });

  it("shows the WH-347 once on the page, not again further down", () => {
    const figures = html.match(/<figure[\s\S]*?<\/figure>/g) ?? [];
    expect(figures).toHaveLength(4);
    expect(figures.filter((figure) => figure.includes(">Form WH-347<"))).toHaveLength(1);
  });
});

describe("/associations/wwcca claims nothing the product does not do", () => {
  /**
   * The "What it does not do yet" section was removed on Cyrus's direction
   * (it is a marketing page). What replaced it is a rule, not a silence:
   * nothing on the page may say or imply a feature that is missing. The
   * three it would be easiest to imply, each a real gap today:
   *
   *   - FILING. lib/wh347.ts builds page 1 only and marks every form not
   *     fileable (page 2, the Statement of Compliance, is not built). So the
   *     page may say C Stream BUILDS the WH-347 — never file / file-ready /
   *     submit / ready to file.
   *   - OVERTIME. It is entered as a pay type, never calculated.
   *   - MAILING THE REMITTANCE. The report holds no fund account numbers or
   *     addresses, so it is never "ready to mail" or "send to the fund".
   *
   * Run over the WHOLE page, panels included: a panel is a claim too.
   */
  it("never says certified payroll is filed or file-ready", () => {
    expect(html).not.toMatch(/\bfil(e|es|ed|ing)\b[^.]{0,40}(payroll|WH-347|certified)/i);
    expect(html).not.toMatch(/(payroll|WH-347|certified)[^.]{0,40}\bfil(e|es|ed|ing)\b/i);
    expect(html).not.toMatch(/file-ready|ready to file|e-?file|submit(s|ted)? (it |them )?to the/i);
  });

  it("never claims overtime is calculated", () => {
    expect(html).not.toMatch(/(calculat|comput|automatic)\w*[^.]{0,30}overtime|overtime[^.]{0,30}(calculat|comput|automatic)/i);
  });

  it("never says the remittance is ready to mail or send", () => {
    expect(html).not.toMatch(/(mail|send|submit)\w*[^.]{0,30}(remittance|trust fund)|remittance[^.]{0,30}ready to (mail|send)/i);
  });

  /** The regexes above are only worth something if they can see the words
   * they are about: the page must still name each document, so a rewrite
   * that dropped them would fail here rather than pass vacuously. */
  it("still names the documents those rules are about", () => {
    expect(prose).toContain("WH-347");
    expect(prose).toContain("Fringe remittance");
    expect(prose).toContain("Apprentice ratio");
  });

  it("has no limits section left on it", () => {
    expect(html).not.toContain("What it does not do yet");
  });
});

describe("/associations/wwcca logo slot", () => {
  /**
   * PINNED TO NULL. A trade association's logo may not be used without its
   * written permission, and showing it before then implies the endorsement
   * this page exists to rule out. Change this line ONLY in the commit that
   * adds a logo file the association supplied, with the written permission
   * referenced in the PR. See THE LOGO in components/associations/wwcca.ts.
   */
  it("is off: logoSrc is null until the WWCCA gives written permission", () => {
    expect(WWCCA.logoSrc).toBeNull();
    expect(html).not.toContain("data-association-logo");
  });

  it("renders the lockup when a logo is set — the slot works when it is needed", async () => {
    vi.resetModules();
    vi.doMock("@/components/associations/wwcca", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/components/associations/wwcca")>();
      return { ...real, WWCCA: { ...real.WWCCA, logoSrc: "/example-logo.png" } };
    });
    const { default: WithLogo } = await import("./page");
    const withLogo = renderToStaticMarkup(createElement(WithLogo));
    expect(withLogo).toContain("data-association-logo");
    expect(withLogo).toContain('src="/example-logo.png"');
    vi.doUnmock("@/components/associations/wwcca");
    vi.resetModules();
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
