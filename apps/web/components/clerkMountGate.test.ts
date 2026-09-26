/**
 * EVERY CLERK UI COMPONENT INSIDE THE SIGNED-IN SHELL IS BEHIND `<AfterMount>`.
 *
 * WHY THIS FILE EXISTS, and it is the half of #507 that had no guard.
 * `components/afterMount.test.ts` proves the GATE works — nothing on the
 * server, children after mount, each half with a control. It says nothing
 * about anybody USING it, which is this repo's "written, documented, and
 * never called" shape wearing a hydration fix: delete the two lines in
 * `Topbar.tsx` that wrap `<UserButton>` and every test in this app still
 * passes, while every authenticated page goes back to racing.
 *
 * THE DEFECT IT PINS. Clerk's UI components render
 * `clerk.loaded && <ClerkHostRenderer …/>` (`@clerk/clerk-react@5.61.9`,
 * `chunk-THNCS7QR.mjs:669`). `loaded` is a mutable flag on a singleton, read
 * DURING render, and false on the server always — so the server writes no
 * markup for one. In the browser the first render reads the same flag, and if
 * Clerk's script won the race it renders an element the server's HTML does not
 * have: a React #418 ELEMENT-level mismatch (`args[]=HTML`, never `text`) on
 * every signed-in page, on whichever page loads lose the race. Measured on
 * CI's own `e2e` job, step 11 went from 6 mismatching pages to 1 when this
 * gate was added, and it is the only change in that run.
 *
 * WHAT IT ASSERTS, in the three shapes CLAUDE.md requires of a check that
 * DERIVES the set it reasons about:
 *
 *   SIZE — the Clerk import sites are counted a SECOND time, by a different
 *   expression than the one that parses them, and the two must agree. A regex
 *   that matches nothing is the failure mode that looks like a pass: nothing
 *   is ever ungated in an empty list.
 *
 *   SCOPE — the roots come from `tailwind.config.ts`'s `content` globs, not
 *   from this file's directory. "Nothing is ever missing from a directory you
 *   do not walk" cost this repo a 1.53:1 button that a green census could not
 *   see, because the one offending file lived outside its walk
 *   (`theme-contrast.test.ts`, 2026-09-16). One root per glob, each asserted
 *   to exist, so a glob that resolves to nothing fails loudly instead of
 *   silently shrinking the scan.
 *
 *   COMMENTS — every structural read is on the source with comments STRIPPED.
 *   Two files in this app print `<UserButton />` in their own prose
 *   (`AfterMount.tsx`'s header and `Topbar.tsx`'s), so a census that read raw
 *   text would find a render site that does not exist — or, worse, would find
 *   a `<AfterMount>` in a comment and call a bare Clerk component gated. That
 *   is #185's shape: a comment quoting the pattern disarms the guard.
 *
 * THE TWO EXEMPT FILES ARE NAMED, NOT PATTERN-MATCHED, and the exemption is
 * itself asserted rather than trusted. `/sign-in` and `/sign-up` are where
 * Clerk's card IS the page: gating them renders the app's front door blank for
 * a frame, and Clerk gives those two components a `fallback` prop and
 * `renderWhileLoading: true` precisely so that the waiting state is something
 * it draws rather than something we withhold. Each exempt file must still
 * exist AND still render a Clerk component, so an exemption cannot outlive the
 * thing it exempts.
 *
 * WHAT THE EXEMPTION IS NOT RESTING ON, because the wrong reason was written
 * here first and it is the exact error this file exists to prevent. It is NOT
 * "`e2e-public` walks both pages and is green". That job calls `expectHealthy`
 * WITHOUT a monitor, so it never reads `pageerror` and cannot see a hydration
 * mismatch on any page — CLAUDE.md says so in the same entry this census comes
 * from. A green suite that looks at nothing is the vacuous green, and citing
 * it as evidence inside a guard would have been that mistake one level down.
 *
 * What IS true: `SignIn` and `SignUp` carry the same `clerk.loaded &&` branch
 * as `UserButton` (`chunk-THNCS7QR.mjs:556` and `:577`), so the race exists
 * there in principle; and the pilot journey's monitor is attached BEFORE
 * `signInAs`, so a #418 on `/sign-in` would be captured and named — and no run
 * has ever named it. That is weak evidence rather than none, and it is stated
 * as weak.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../tailwind.config";

const appDir = resolve(new URL("..", import.meta.url).pathname);

/** Comments out, so nothing in prose can satisfy or defeat a structural
 * read. The same two expressions `shellRegion.test.ts` uses. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * A Clerk export that is a PROVIDER rather than a rendered UI component.
 * `ClerkProvider` renders its children and reads no `loaded` flag to decide
 * whether to emit markup, so it has nothing to disagree about; it also has to
 * wrap the tree from the root layout, where an `AfterMount` would delay the
 * whole app by a frame. Named here so the exclusion is a decision on the
 * record rather than a regex that happens not to reach it.
 */
const NOT_A_RENDERED_WIDGET = new Set(["ClerkProvider"]);

/**
 * Where Clerk's own card is the page. See this file's header for why these two
 * are exempt, what that exemption does NOT rest on, and why it is asserted
 * below rather than assumed.
 */
const CARD_IS_THE_PAGE = [
  "app/sign-in/[[...sign-in]]/page.tsx",
  "app/sign-up/[[...sign-up]]/page.tsx",
] as const;

/** Every `.ts`/`.tsx` under a root, tests excluded — a test that renders a
 * Clerk component in a jsdom is not a page anybody hydrates. */
function sources(root: string): string[] {
  const out: string[] = [];
  /* A root that is not a directory returns EMPTY rather than throwing, so the
     scope assertion below is what reports it — by name, next to the sentence
     saying why an unwalked directory is the one failure a size check cannot
     see. An exception at module scope collects no tests at all, which reads
     as "no tests" and names nothing. */
  if (!(statSync(root, { throwIfNoEntry: false })?.isDirectory() ?? false)) return out;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/* THE ROOTS COME FROM `content`, NOT FROM THIS FILE'S DIRECTORY. Tailwind's
   `content` is the authoritative list of files whose markup reaches this app;
   deriving from it means adding a workspace package extends this census with
   no edit here. */
const globs = (Array.isArray(config.content) ? config.content : []) as string[];
const roots = globs.map((glob) => {
  const star = glob.indexOf("*");
  return resolve(appDir, star === -1 ? glob : glob.slice(0, star));
});

/** One `{ file, names, stripped }` per file importing Clerk's browser
 * package. `@clerk/nextjs/server` is deliberately not matched: `auth()`,
 * `currentUser()` and `clerkClient()` render nothing. */
type ClerkSite = { file: string; names: string[]; statements: number; stripped: string };

/** Every `from "@clerk/nextjs"` (or `clerk-react`) in a file, however the
 * import is spelled. Counted as well as parsed, because a DEFAULT or NAMESPACE
 * import carries no brace list and would parse to no names at all — the
 * "empty question" failure the size check below exists to catch. */
const CLERK_IMPORT = /from\s*["']@clerk\/(?:nextjs|clerk-react)["']/g;
const CLERK_NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@clerk\/(?:nextjs|clerk-react)["']/g;

function clerkSites(): ClerkSite[] {
  const found: ClerkSite[] = [];
  for (const full of roots.flatMap((root) => sources(root))) {
    const stripped = stripComments(readFileSync(full, "utf8"));
    const statements = [...stripped.matchAll(CLERK_IMPORT)].length;
    if (statements === 0) continue;
    /* ALL of them, not the first: a file is free to import a provider on one
       line and a widget on the next, and taking only `exec()`'s first match
       would silently drop the second. */
    const names = [...stripped.matchAll(CLERK_NAMED_IMPORT)]
      .flatMap((match) => match[1].split(","))
      .map((part) => part.trim().split(/\s+as\s+/).pop()!.trim())
      .filter((name) => name.length > 0 && !NOT_A_RENDERED_WIDGET.has(name));
    found.push({ file: full.slice(appDir.length + 1), names, statements, stripped });
  }
  return found;
}

/** Character ranges covered by an `<AfterMount>…</AfterMount>` element, read
 * off the stripped source. Textual on purpose: the question is whether the
 * gate is written around the widget, and that is a fact about the source. */
function gatedRanges(stripped: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const open = /<AfterMount(\s[^>]*)?>/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(stripped)) !== null) {
    const close = stripped.indexOf("</AfterMount>", match.index);
    if (close === -1) continue;
    ranges.push([match.index, close]);
  }
  return ranges;
}

const sites = clerkSites();

describe("Clerk's UI components are mounted behind the browser gate", () => {
  it("walks every directory whose markup reaches the app", () => {
    expect(
      roots.length,
      "tailwind.config.ts declares no `content` globs, so this census would be about nothing",
    ).toBe(globs.length);
    expect(roots.length).toBeGreaterThanOrEqual(3);
    for (const root of roots) {
      expect(
        statSync(root, { throwIfNoEntry: false })?.isDirectory() ?? false,
        `${root} is a content-glob root that does not exist — the census cannot see inside it`,
      ).toBe(true);
    }
  });

  it("parsed as many Clerk files as the sources contain", () => {
    /* THE SIZE ASSERTION. Counted by a second expression that shares no regex
       with `clerkSites()` — a bare substring test for the package name — so a
       parse that silently stops matching fails here with a number instead of
       passing every assertion below on an empty list. */
    const byPlainText = roots
      .flatMap((root) => sources(root))
      .filter((full) => {
        const stripped = stripComments(readFileSync(full, "utf8"));
        return stripped.includes('from "@clerk/nextjs"') || stripped.includes('from "@clerk/clerk-react"');
      });
    expect(
      sites.length,
      `the sources contain ${byPlainText.length} files importing Clerk's browser package and this ` +
        `census parsed ${sites.length} — the import pattern has drifted`,
    ).toBe(byPlainText.length);
    expect(sites.length, "no file imports Clerk at all, so this census is about nothing").toBeGreaterThan(0);

    /* AND EVERY IMPORT STATEMENT YIELDED NAMES. A default or namespace import
       (`import Clerk from …`) has no brace list, so it would contribute a
       statement and zero names — a widget this census cannot see. The one
       legitimate zero is a file whose only Clerk import is the provider. */
    for (const site of sites) {
      const providerOnly = /import\s*\{[^}]*\bClerkProvider\b[^}]*\}/.test(site.stripped) && site.names.length === 0;
      expect(
        site.names.length > 0 || providerOnly,
        `${site.file} imports Clerk in ${site.statements} statement(s) and this census read no ` +
          `component name out of them — a default or namespace import it cannot see into`,
      ).toBe(true);
    }
  });

  it("names every Clerk widget it found, so a new one cannot arrive unnoticed", () => {
    const rendered = [...new Set(sites.flatMap((site) => site.names))].sort();
    /* Pinned to the widgets this app actually mounts. A new Clerk component
       fails HERE, next to the sentence explaining what it has to be wrapped
       in, rather than silently joining the set below. */
    expect(rendered).toEqual(["SignIn", "SignUp", "UserButton"]);
  });

  it("renders no Clerk widget outside <AfterMount>, except where the card is the page", () => {
    const ungated: string[] = [];
    for (const site of sites) {
      if ((CARD_IS_THE_PAGE as readonly string[]).includes(site.file)) continue;
      const ranges = gatedRanges(site.stripped);
      for (const name of site.names) {
        const use = new RegExp(`<${name}[\\s/>]`, "g");
        let match: RegExpExecArray | null;
        let seen = 0;
        while ((match = use.exec(site.stripped)) !== null) {
          seen += 1;
          const inside = ranges.some(([from, to]) => match!.index > from && match!.index < to);
          if (!inside) ungated.push(`${site.file}: <${name}> is rendered outside <AfterMount>`);
        }
        expect(
          seen,
          `${site.file} imports ${name} from Clerk and never renders it — an unused import, or the ` +
            `render-site pattern has drifted`,
        ).toBeGreaterThan(0);
      }
    }
    expect(
      ungated,
      "a Clerk UI component renders `clerk.loaded && …` — a flag read during render and false on the " +
        "server always — so one rendered bare is a React #418 element mismatch on every signed-in " +
        "page. Wrap it in <AfterMount> (components/AfterMount.tsx).",
    ).toEqual([]);
  });

  it("the two exempt files still exist and still render a Clerk card", () => {
    /* An allowlist that outlives what it exempts is how a rule gets quietly
       repealed. Each entry has to still be a file, and still be the reason it
       was added. */
    for (const file of CARD_IS_THE_PAGE) {
      const site = sites.find((candidate) => candidate.file === file);
      expect(site, `${file} is exempt from the mount gate and no longer imports Clerk — drop the exemption`)
        .toBeDefined();
      expect(site!.names.length, `${file} is exempt and renders no Clerk widget`).toBeGreaterThan(0);
    }
  });

  it("CONTROL: a comment quoting the gate does not gate, and one quoting the widget is not a site", () => {
    /* #185's shape, in both directions. `AfterMount.tsx` and `Topbar.tsx` both
       print `<UserButton />` in their headers, so this is not hypothetical. */
    const commentedGate = stripComments(
      ['/* <AfterMount> */', "<UserButton />", "// </AfterMount>"].join("\n"),
    );
    expect(gatedRanges(commentedGate)).toEqual([]);

    const commentedWidget = stripComments("/* renders <UserButton /> when loaded */\nconst x = 1;");
    expect(/<UserButton[\s/>]/.test(commentedWidget)).toBe(false);

    const realGate = stripComments("<AfterMount>\n  <UserButton />\n</AfterMount>");
    expect(gatedRanges(realGate)).toHaveLength(1);
  });

  it("CONTROL: the gate module is the one the app imports, and it renders nothing first", () => {
    /* A census pointed at a component that no longer gates would pass on
       every file while the app hydrated wrong. `afterMount.test.ts` owns the
       behaviour; this only checks the file the census names is still it. */
    const gate = stripComments(readFileSync(resolve(appDir, "components/AfterMount.tsx"), "utf8"));
    expect(gate).toMatch(/^["']use client["']/);
    expect(gate).toMatch(/useState\(false\)/);
    expect(gate).toMatch(/mounted \? <>\{children\}<\/> : null/);
  });
});
