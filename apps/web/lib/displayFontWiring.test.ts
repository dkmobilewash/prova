import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * THE DISPLAY FACE IS WIRED THROUGH FOUR FILES AND THREE OF THEM FAIL
 * SILENTLY. This is the "written, documented, and never called" shape from
 * CLAUDE.md, wearing a typeface: every link below can be broken on its own
 * and the page still builds, still typechecks, still passes every other
 * test, and simply renders in the system stack again — which is what it did
 * before, so nothing looks broken. It just quietly stops being the thing
 * that was measured.
 *
 * The chain:
 *   1. app/fonts/…woff2          the file itself
 *   2. app/layout.tsx            localFont({ src, variable: "--font-headline" })
 *   3. app/layout.tsx            className={headline.variable} on <html>
 *   4. tailwind.config.ts        fontFamily.headline -> var(--font-headline)
 *   5. a component               className="font-headline"
 *
 * Break 3 and `--font-headline` is never defined, so `font-headline`
 * resolves to the fallback list and the headline silently loses 84px of
 * fitted width in a 488px column — which is the measurement the hero's
 * layout is built on (see LandingPage.tsx's preamble).
 *
 * WHAT THIS FILE CANNOT DO, stated so nobody reads more into a green run:
 * it cannot see layout, because happy-dom does none and returns zeros from
 * getBoundingClientRect. Every width that chose this face was measured in
 * real Chromium and lives in app/layout.tsx's note. This asserts only that
 * the chain which DELIVERS that face is unbroken.
 */

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const layout = readFileSync(here("../app/layout.tsx"), "utf8");
const tailwind = readFileSync(here("../tailwind.config.ts"), "utf8");
const landing = readFileSync(here("../components/LandingPage.tsx"), "utf8");

// Comments are STRIPPED before any structure is read. Both layout.tsx and
// LandingPage.tsx discuss `font-headline` and `--font-headline` at length in
// their own notes, so a raw-text search finds the wiring in the prose and
// passes with the code removed — the #185 shape, and the reason the Clerk
// census strips comments too.
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const layoutCode = strip(layout);
const tailwindCode = strip(tailwind);
const landingCode = strip(landing);

describe("the display face is wired end to end", () => {
  it("parses something from each file it reasons about", () => {
    // Anti-vacuity: a regex that matches nothing passes every assertion
    // below, since nothing is ever missing from an empty match.
    expect(layoutCode.length, "layout.tsx is all comment?").toBeGreaterThan(400);
    expect(tailwindCode).toContain("theme");
    expect(landingCode).toContain("<h1");
  });

  it("ships the font file the layout names, and it is a real woff2", () => {
    const src = layoutCode.match(/src:\s*"([^"]+\.woff2)"/)?.[1];
    expect(src, "layout.tsx declares no local font src").toBeTruthy();
    const file = here(`../app/${src!.replace(/^\.\//, "")}`);
    expect(existsSync(file), `${src} is named by layout.tsx but not in the repo`).toBe(true);
    // wOF2 magic number — a placeholder or an HTML error page saved with the
    // right extension would otherwise pass as "the font ships".
    const head = readFileSync(file).subarray(0, 4).toString("latin1");
    expect(head, `${src} is not a woff2`).toBe("wOF2");
    expect(statSync(file).size).toBeGreaterThan(1000);
  });

  it("keeps the licence beside the file, because redistribution requires it", () => {
    const ofl = here("../app/fonts/OFL.txt");
    expect(existsSync(ofl), "a font is redistributed here with no licence").toBe(true);
    expect(readFileSync(ofl, "utf8")).toContain("SIL OPEN FONT LICENSE");
  });

  it("defines the CSS variable AND mounts it on the document", () => {
    expect(layoutCode).toMatch(/variable:\s*"--font-headline"/);
    // The link that breaks silently: without this the variable is never
    // defined on any element and every `font-headline` falls back.
    expect(layoutCode, "the font variable is never put on <html>").toMatch(
      /<html[^>]*className=\{[^}]*\.variable/,
    );
  });

  it("declares the family in Tailwind, reading the same variable", () => {
    const family = tailwindCode.match(/headline:\s*\[([^\]]+)\]/)?.[1];
    expect(family, "tailwind declares no `headline` family").toBeTruthy();
    expect(family).toContain("var(--font-headline)");
    // A fallback list is not optional: a font file that fails to load must
    // land back on the stack this app already rendered in.
    expect(family).toContain("sans-serif");
  });

  it("is actually used — by the headline the hero's widths were measured on", () => {
    const h1 = landingCode.match(/<h1 className="([^"]*)"/)?.[1] ?? "";
    expect(h1, "no <h1> class found in LandingPage").not.toBe("");
    expect(h1, "the hero headline does not use the measured face").toContain("font-headline");
    // And on the section headings, so the page reads as one system rather
    // than one styled element.
    const uses = landingCode.match(/font-headline/g) ?? [];
    expect(uses.length, "the face is on the h1 only").toBeGreaterThanOrEqual(3);
  });
});
