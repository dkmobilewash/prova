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
 *    length, no counter, outside the illustrative product panels and the
 *    savings calculator — whose figures are the visitor's own, and whose
 *    every default must render with its source (asserted below).
 * 7. IT DESCRIBES THE ASSISTANT HONESTLY: a person taps once to approve
 *    anything saved or sent; "fully automated" and its cousins are banned;
 *    the commands the page names are exactly the commands the code has.
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
const { DEFAULTS, cStreamMonthlyPrice } = await import("@/components/associations/wwccaSavings");

const html = renderToStaticMarkup(createElement(WwccaAssociationPage));

/** The page without its four product panels. The panels are figures of real
 * documents with illustrative money in them, and that is fine and captioned;
 * everything else on the page is prose and must carry no invented figure.
 * PanelFrame renders each as one <figure>, and figures do not nest. */
/** The savings calculator, by its marker. Its figures are the visitor's own
 * and every default shows its source (asserted below), so it is stripped
 * from the prose the way the panels are — and it must be THERE to strip,
 * asserted in its own block, so a renamed marker fails rather than letting
 * its numbers pass as prose or vanish from the scan. It nests no <section>,
 * so the first closing tag is its own. */
const calculator = html.match(/<section data-savings-calculator[\s\S]*?<\/section>/)?.[0] ?? "";
const prose = html.replace(/<figure[\s\S]*?<\/figure>/g, "").replace(calculator, "");

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

describe("/associations/wwcca describes the assistant honestly", () => {
  /**
   * WHAT THE ASSISTANT IS: every write is PROPOSED as a card and a person
   * taps once to confirm before anything is saved or sent
   * (lib/actions/ask.ts confirmAskProposal). What it is NOT: "fully
   * automated", "hands-free", "no data entry" — and it does not FILE anything
   * (WH-347 page 2 is not built), does not calculate overtime (entered as a
   * pay type), and has no memory across questions. Scanned over the WHOLE
   * rendered page, every new component included.
   *
   * FAILS ON EMPTY INPUT: a page that rendered nothing would match none of
   * these, so the block first requires the sentence the guard exists to
   * protect. A regex that matches nothing is only worth something when the
   * text it is about is provably there.
   */
  const BANNED = [
    /fully[\s-]*(AI[\s-]*)?automated/i,
    /hands[\s-]*free/i,
    /no data entry/i,
    /files? (it |them |this )?for you/i,
    /file[\s-]*ready/i,
    /automatic(ally)?[^.]{0,20}overtime|overtime[^.]{0,20}automatic/i,
    /remembers|learns your|gets to know you/i,
  ];

  it("says a person taps once to approve anything saved or sent — the sentence the guard protects", () => {
    expect(html.length).toBeGreaterThan(5000);
    expect(html).toContain("Tell it what you need and it does it");
    expect(html).toContain("You tap once to approve anything that gets saved or sent.");
  });

  it("uses none of the banned phrasings anywhere on the rendered page", () => {
    for (const pattern of BANNED) {
      expect(html, `banned phrasing ${pattern} is on the page`).not.toMatch(pattern);
    }
    // The guard can see what it is about: each pattern's own vocabulary is
    // present in prose form somewhere (the assistant, hours, the WH-347).
    expect(html).toContain("The assistant");
    expect(html).toContain("WH-347");
  });

  /**
   * THE GROUPED LIST NAMES REAL COMMANDS AND ALL OF THEM. Each group in
   * ASSISTANT_DOES carries, in the comment beside it, the write commands it
   * stands for. This reads those names out of the source and compares them
   * with the `CommandName` union in lib/ask/commands.ts: a command the
   * page names that the code lacks fails, and a command the code has that
   * the page does not cover fails too, so the list cannot drift either way.
   *
   * SIZE PINNED against a source that cannot drift with the regex: the
   * union must have exactly as many members as there are `name: "…"` tool
   * declarations across lib/ask/commands/, so a union parse that found
   * nothing fails instead of matching an empty page list.
   */
  it("names every write command the assistant has, and no command it lacks", () => {
    const landing = readFileSync(resolve(webRoot, "components/associations/WwccaLanding.tsx"), "utf8");
    const listStart = landing.indexOf("const ASSISTANT_DOES");
    const listEnd = landing.indexOf("];", listStart);
    expect(listStart, "ASSISTANT_DOES moved — update this test").toBeGreaterThan(-1);
    const onPage = new Set(
      [...landing.slice(listStart, listEnd).matchAll(/\/\/([^\n]*)/g)].flatMap((m) => m[1].match(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g) ?? []),
    );

    const commands = readFileSync(resolve(webRoot, "lib/ask/commands.ts"), "utf8");
    const unionStart = commands.indexOf("export type CommandName");
    expect(unionStart, "CommandName moved — update this test").toBeGreaterThan(-1);
    const unionEnd = commands.indexOf(";", unionStart);
    const inCode = new Set([...commands.slice(unionStart, unionEnd).matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));

    const commandsDir = resolve(webRoot, "lib/ask/commands");
    const declared = readdirSync(commandsDir)
      .filter((name) => /^[a-zA-Z]+\.ts$/.test(name))
      .flatMap((name) => [...readFileSync(join(commandsDir, name), "utf8").matchAll(/^\s+name: "([a-z0-9_]+)"/gm)].map((m) => m[1]));
    expect(inCode.size, "the union parse and the tool declarations disagree").toBe(new Set(declared).size);
    expect(inCode.size).toBeGreaterThan(0);

    expect([...onPage].sort()).toEqual([...inCode].sort());
  });
});

describe("/associations/wwcca savings calculator", () => {
  it("is on the page, by the marker the prose guard strips it with, and says it is an estimate", () => {
    expect(calculator.length).toBeGreaterThan(1000);
    expect(prose).not.toContain("data-savings-calculator");
    expect(calculator).toContain("An estimate from the numbers you enter, not a quote.");
    expect(calculator).toContain("What it would save you");
  });

  /** EVERY DEFAULT RENDERS WITH ITS SOURCE. The value is in the field, the
   * source line is beside it, the field is a <label>led input that points
   * at that line with aria-describedby, and the sourced one links out. */
  it("renders every default value with its source beside the field", () => {
    const keys = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const def = DEFAULTS[key];
      const shown = key === "shareRemoved" ? String(Math.round(def.value * 100)) : String(def.value);
      const input = calculator.match(new RegExp(`<input[^>]*name="${key}"[^>]*>`))?.[0];
      expect(input, `no input for ${key}`).toBeDefined();
      expect(input).toContain(`value="${shown}"`);
      expect(input).toContain('inputMode="decimal"');
      const id = input!.match(/\bid="([^"]+)"/)?.[1];
      expect(calculator, `no <label for> on ${key}`).toContain(`<label for="${id}"`);
      const describedBy = input!.match(/aria-describedby="([^"]+)"/)?.[1];
      expect(describedBy, `${key} has no aria-describedby`).toBeDefined();
      const sourceLine = calculator.match(new RegExp(`<p id="${describedBy}"[^>]*>([\\s\\S]*?)</p>`))?.[1] ?? "";
      expect(sourceLine, `${key}'s source line is not beside its field`).toContain(escapeHtml(def.source));
      if (def.href) expect(sourceLine).toContain(`href="${def.href}"`);
    }
    // The three kinds are all visibly labelled — an unlabelled default is a
    // number nobody sourced.
    expect(calculator).toContain("Source:</span>");
    expect(calculator).toContain("Example:</span>");
    expect(calculator).toContain("Assumption:</span>");
    expect(calculator).not.toContain("8.3");
  });

  it("quotes the offer's price and nothing else as C Stream's cost", () => {
    expect(cStreamMonthlyPrice()).toBe(399);
    expect(calculator).toContain("$399.00 a month");
  });

  it("gives screen readers the result as a sentence in a live region", () => {
    expect(calculator).toMatch(/<p role="status" aria-live="polite"[^>]*>With these numbers C Stream (saves you|costs you) \$/);
    expect(calculator).toContain("office hours saved per month");
  });

  it("puts no white text on the brand yellow, and the bars are hidden from assistive tech", () => {
    expect(html).not.toMatch(/class="[^"]*\bbg-brand\b[^"]*\btext-white\b/);
    expect(html).not.toMatch(/class="[^"]*\btext-white\b[^"]*\bbg-brand\b/);
    expect(calculator).toMatch(/<div aria-hidden="true"[^>]*>[\s\S]*bg-brand[\s\S]*<\/div>/);
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
