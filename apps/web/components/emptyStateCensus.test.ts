/**
 * Every nav page's empty branch is the shared EmptyState, or is listed here
 * with the reason it is not.
 *
 * WHY. Cyrus walked the app as a brand-new company and called the empty
 * pages "super blank" and "weak looking": a grey sentence under a heading,
 * written a different way on each of fifteen pages. `EmptyState.tsx` is the
 * one shape they now share. Without this file the sixteenth page gets its
 * own sentence again and nobody notices, because an empty state is the one
 * screen the people building the app never see — they all have data.
 *
 * WHAT IT HOLDS EACH ADOPTING PAGE TO, beyond importing the component:
 *   - every `<EmptyState` carries a literal walkthrough anchor as its FIRST
 *     attribute, so the "Walk me through this page" tour can point at it
 *     (walkthroughCensus.test.ts then holds the anchor to a step);
 *   - every `opens:` action names a `data-tour` anchor the page actually
 *     renders — the button presses whatever sits at that anchor, and an
 *     anchor that is not there makes it a button that does nothing.
 *
 * A CHECK THAT DERIVES ITS INPUT HAS TWO FAILURE MODES (CLAUDE.md), and a
 * census can also have the right pattern and the wrong SCOPE. So: the nav
 * routes it scans are counted a second way, straight out of navItems.tsx's
 * source text; the pages that import the component are counted a second
 * way, by `git grep`, and the two sets must be equal — so a page that
 * adopts it outside the walk, or a walk that stops finding pages, fails
 * with a count instead of passing on an empty set.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/navItems";

const webRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(webRoot, "../..");
const appDir = join(webRoot, "app");

/**
 * Nav pages that do not use EmptyState, and why. A reason is a sentence,
 * not a placeholder: adding a line here is a decision somebody should be
 * able to read back.
 */
const EMPTY_STATE_EXCEPTIONS: Record<string, string> = {
  "/dashboard":
    "the Getting started card is this page's empty state — a checklist ticked from real data, not a single missing list",
  "/ask": "not a list: the assistant box with its example questions is the whole page",
  "/team": "never empty — the owner is always on it, and the invite form is the first thing on the page",
  "/settings": "a set of forms, not a list; each section says in one line what it is for",
  "/settings/integrations": "a card per connection with its own Connect button; there is no list to be empty",
  "/sales": "operator-only CRM for C Stream's own sales, never seen by a customer",
  "/internal/usage": "operator-only usage figures, never seen by a customer",
  "/certifications":
    "a crew-by-requirement matrix whose empty branches depend on crew and requirements separately; not yet converted",
  "/deployment": "a board of crews and gear per job, each empty in its own cell; not yet converted",
  "/union-compliance": "five setup sections, each with its own one-line empty; no single empty branch",
  "/prevailing-wage": "three setup sections, each with its own one-line empty; no single empty branch",
  "/intake": "already a boxed drop-zone empty state with its own upload button; not yet converted",
  "/closeout": "already a boxed empty state linking to jobs; not yet converted",
  "/lien-deadlines": "its empty state lives inside LienDeadlinesBoard, beside the add form; not yet converted",
  "/cash-flow": "Diego's lane — its zero-money empty state was designed on purpose (no $0.00 tiles); not yet converted",
  "/phase-codes": "Diego's lane — already a boxed empty state with its own add button; not yet converted",
  "/vendors/pricing": "Diego's lane — already a boxed empty state pointing at the quote form; not yet converted",
};

// ----------------------------------------------------------------- routes --

const navRoutes = [...new Set(NAV_ITEMS.map((item) => item.href))];

/** The same routes, read out of the source text instead of the import. */
function navRoutesBySource(): string[] {
  const source = readFileSync(join(webRoot, "components/navItems.tsx"), "utf8");
  return [...new Set([...source.matchAll(/^\s*href: "(\/[^"]*)",$/gm)].map((m) => m[1]))];
}

function walkPages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkPages(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

function routeOf(pageFile: string): string {
  const segments = relative(appDir, dirname(pageFile))
    .split(/[\\/]/)
    .filter((segment) => segment && !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

const pageByRoute = new Map(walkPages(appDir).map((file) => [routeOf(file), file]));
const navPages = navRoutes.map((route) => ({ route, file: pageByRoute.get(route) }));

// ---------------------------------------------------------------- reading --

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const IMPORTS_EMPTY_STATE = /from\s+["']@\/components\/EmptyState["']/;

function adopts(file: string): boolean {
  const source = withoutComments(readFileSync(file, "utf8"));
  return IMPORTS_EMPTY_STATE.test(source) && /<EmptyState\b/.test(source);
}

/** Importers by a different method: git's own grep, no nav, no walk. */
function importersByGit(): string[] {
  let out = "";
  try {
    out = execFileSync(
      "git",
      ["grep", "--untracked", "-l", "-E", `from ["']@/components/EmptyState["']`, "--", "apps/web", ":!*.test.ts", ":!*.test.tsx"],
      { cwd: repoRoot, encoding: "utf8" },
    );
  } catch (error) {
    if ((error as { status?: number }).status !== 1) throw error;
  }
  return out.split("\n").filter(Boolean).map((path) => resolve(repoRoot, path));
}

// The import walk walkthroughCensus.test.ts uses, so "the page renders this
// anchor" means the same thing in both files.
const IMPORT = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g;

function resolveImport(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(webRoot, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts"), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function anchorsReachedFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const anchors = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = withoutComments(readFileSync(file, "utf8"));
    for (const m of source.matchAll(/data-tour="([a-z0-9-]+)"/g)) anchors.add(m[1]);
    for (const m of source.matchAll(IMPORT)) {
      const target = resolveImport(m[1], file);
      if (target && !/\.test\.tsx?$/.test(target)) queue.push(target);
    }
  }
  return anchors;
}

// ------------------------------------------------------------------ tests --

describe("the census sees what it reasons about", () => {
  it("reads the whole nav, counted two ways", () => {
    const bySource = navRoutesBySource();
    expect(navRoutes.length, "the nav import came back nearly empty").toBeGreaterThan(30);
    expect([...navRoutes].sort()).toEqual([...bySource].sort());
  });

  it("finds a page file for every nav route", () => {
    const missing = navPages.filter((page) => !page.file).map((page) => page.route);
    expect(missing, "nav routes with no page.tsx — is the app walk broken?").toEqual([]);
  });

  it("the pages that import EmptyState are exactly the adopting nav pages, by git grep", () => {
    const adopting = navPages.filter((page) => page.file && adopts(page.file)).map((page) => page.file!);
    expect(adopting.length, "no nav page adopts EmptyState — the scan is looking at nothing").toBeGreaterThan(10);
    expect(importersByGit().sort()).toEqual([...adopting].sort());
  });
});

describe("every nav page's empty branch", () => {
  for (const { route, file } of navPages) {
    it(`${route} uses EmptyState or says why not`, () => {
      expect(file, `${route} has no page.tsx`).toBeTruthy();
      const uses = adopts(file!);
      const excepted = route in EMPTY_STATE_EXCEPTIONS;
      expect(
        uses || excepted,
        `${route}: render its empty branch with <EmptyState>, or add it to EMPTY_STATE_EXCEPTIONS with a reason`,
      ).toBe(true);
      expect(uses && excepted, `${route} uses EmptyState — take it off EMPTY_STATE_EXCEPTIONS`).toBe(false);
    });
  }

  it("every exception is a nav page and has a real reason", () => {
    for (const [route, reason] of Object.entries(EMPTY_STATE_EXCEPTIONS)) {
      expect(navRoutes, `${route} is not in the nav`).toContain(route);
      expect(reason.length, `${route}: say why in a sentence`).toBeGreaterThan(30);
    }
  });
});

describe("how the adopting pages use it", () => {
  const adopting = navPages.filter((page) => page.file && adopts(page.file));

  for (const { route, file } of adopting) {
    const source = withoutComments(readFileSync(file!, "utf8"));

    it(`${route}: every EmptyState carries a walkthrough anchor first`, () => {
      const uses = source.match(/<EmptyState\b/g) ?? [];
      const anchored = source.match(/<EmptyState\s+data-tour="[a-z0-9]+(?:-[a-z0-9]+)*"/g) ?? [];
      expect(uses.length).toBeGreaterThan(0);
      expect(anchored.length, `${route}: put data-tour="…" as the first attribute of each <EmptyState>`).toBe(
        uses.length,
      );
    });

    it(`${route}: every "opens" action names an anchor the page renders`, () => {
      const targets = [...source.matchAll(/\bopens:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
      const present = anchorsReachedFrom(file!);
      const dead = targets.filter((target) => !present.has(target));
      expect(dead, `${route}: these buttons would press nothing`).toEqual([]);
    });
  }
});

describe("the chrome is listening", () => {
  // "Written, documented, and never called" (CLAUDE.md): the buttons only
  // dispatch. If nothing listens, "Walk me through this page" and "Ask C
  // Stream to do it" are buttons that do nothing, and emptyStateButtons.test.ts
  // stays green because it only proves the event is sent.
  const read = (path: string) => withoutComments(readFileSync(join(webRoot, path), "utf8"));

  it("HelpButton starts the tour when an empty state asks for it", () => {
    expect(read("components/HelpButton.tsx")).toMatch(/addEventListener\(\s*WALKTHROUGH_EVENT\b/);
  });

  it("AskPanel takes the waiting sentence on mount and listens for the next one", () => {
    const panel = read("components/AskPanel.tsx");
    expect(panel).toMatch(/takePendingAsk\(\)/);
    expect(panel).toMatch(/addEventListener\(\s*ASK_PREFILL_EVENT\b/);
  });

  it("the launcher the Ask button looks for is still marked", () => {
    expect(read("components/AskLauncher.tsx")).toMatch(/\bdata-ask-launcher\b/);
  });
});
