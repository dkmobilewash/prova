/**
 * Every "Walk me through this page" step points at something its page
 * actually renders.
 *
 * WHY THIS EXISTS. A walkthrough is prose about a page, kept in a different
 * file from the page. The day someone renames a section or drops a button,
 * the step that pointed at it would be skipped at runtime without a sound —
 * the overlay skips any step whose anchor is not on screen, which is right
 * for a step hidden by permission and wrong for a step whose anchor no
 * longer exists anywhere. The first looks exactly like the second from the
 * browser. This file tells them apart at build time.
 *
 * WHAT "ITS PAGE RENDERS" MEANS HERE. The route's `page.tsx` plus every
 * module it imports from this app, followed transitively (`@/…` and
 * relative imports). That over-approximates — a component imported for one
 * branch counts for all of them — but never under-approximates, and the
 * runtime skip covers the branch that is not taken.
 *
 * A CHECK THAT DERIVES ITS INPUT HAS TWO FAILURE MODES (CLAUDE.md). An
 * import walk that silently resolves nothing would find no anchors, and
 * then "every step's anchor exists" would fail loudly — but "no two steps
 * share an anchor" and "no orphan anchors" would pass on an empty set. So
 * both sets are pinned to counts taken by a different method: the page
 * files to `git ls-files`, and the anchor literals to `git grep -o`, which
 * knows nothing about imports. Every literal in the repo must be reached by
 * the walk, so a walk that stops following imports goes red with a count.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/navItems";
import { ROUTES_WITHOUT_WALKTHROUGH, WALKTHROUGHS, walkthroughFor } from "./index";

const webRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repoRoot = resolve(webRoot, "../..");
const appDir = join(webRoot, "app");

/** `data-tour="…"`, literal, lowercase words and hyphens. */
const ANCHOR = /data-tour="([a-z0-9-]+)"/g;

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function anchorsIn(source: string): string[] {
  return [...withoutComments(source).matchAll(ANCHOR)].map((match) => match[1]);
}

// ------------------------------------------------------------ page files --

function walkPages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkPages(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

/** app/(app)/jobs/[id]/page.tsx -> /jobs/[id]. Route groups vanish. */
function routeOf(pageFile: string): string {
  const segments = relative(appDir, dirname(pageFile))
    .split(/[\\/]/)
    .filter((segment) => segment && !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

const pageFiles = walkPages(appDir);
const pages = new Map(pageFiles.map((file) => [routeOf(file), file]));

function pagesByGit(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "apps/web/app"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out.split("\n").filter((path) => /(^|\/)page\.tsx$/.test(path));
}

// ------------------------------------------------------------ import walk --

const IMPORT = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveImport(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(webRoot, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null; // a package: nothing of ours to render
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts"), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every module of this app a file reaches through its imports, itself
 * included. Test files are never followed. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = withoutComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(IMPORT)) {
      const target = resolveImport(match[1] ?? match[2], file);
      if (target && !/\.test\.tsx?$/.test(target) && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

const reachByRoute = new Map(
  WALKTHROUGHS.filter((w) => pages.has(w.route)).map((w) => [w.route, reachable(pages.get(w.route)!)]),
);

function anchorsReachedFrom(route: string): Set<string> {
  const ids = new Set<string>();
  for (const file of reachByRoute.get(route) ?? []) for (const id of anchorsIn(readFileSync(file, "utf8"))) ids.add(id);
  return ids;
}

/** The independent count: git's own grep over the app, no import walk. */
function anchorLiteralsByGit(): string[] {
  let out = "";
  try {
    out = execFileSync(
      "git",
      ["grep", "--untracked", "-h", "-o", "-E", 'data-tour="[a-z0-9-]+"', "--", "apps/web", ":!*.test.ts", ":!*.test.tsx"],
      { cwd: repoRoot, encoding: "utf8" },
    );
  } catch (error) {
    // git grep exits 1 when nothing matches, which is a finding, not a crash.
    if ((error as { status?: number }).status !== 1) throw error;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice('data-tour="'.length, -1));
}

// ------------------------------------------------------------------ tests --

describe("the census sees what it reasons about", () => {
  it("finds the same page files as git does", () => {
    const byGit = pagesByGit();
    expect(byGit.length, "git found almost no pages — is this a checkout?").toBeGreaterThan(40);
    expect(pageFiles.map((file) => relative(repoRoot, file)).sort()).toEqual([...byGit].sort());
  });

  it("reaches every anchor literal in the app through the registered pages' imports", () => {
    const byGit = anchorLiteralsByGit();
    const stepCount = WALKTHROUGHS.reduce((sum, w) => sum + w.steps.length, 0);
    // Floor first: an empty grep and an empty walk agree with each other.
    expect(byGit.length, "git grep found fewer anchors than there are steps").toBeGreaterThanOrEqual(
      new Set(WALKTHROUGHS.flatMap((w) => w.steps.map((s) => s.anchor))).size,
    );
    expect(stepCount).toBeGreaterThan(30);

    const union = new Set([...reachByRoute.values()].flatMap((files) => [...files]));
    const walked = [...union].flatMap((file) => anchorsIn(readFileSync(file, "utf8")));
    expect(
      walked.length,
      `the repo has ${byGit.length} data-tour literals and the import walk from the registered pages found ` +
        `${walked.length}. Either the walk stopped following imports, a literal sits in a comment, or an ` +
        "anchor was added to a file no walkthrough's page renders.",
    ).toBe(byGit.length);
  });

  it("every route's walk found more than the page file alone", () => {
    for (const [route, files] of reachByRoute) {
      expect(files.size, `${route}: the import walk found nothing past page.tsx`).toBeGreaterThan(1);
    }
  });
});

describe("walkthrough registry", () => {
  it("every registered route is a real page, registered once", () => {
    const routes = WALKTHROUGHS.map((w) => w.route);
    expect(new Set(routes).size, "a route is registered twice").toBe(routes.length);
    for (const route of routes) expect(pages.has(route), `${route} has no page.tsx`).toBe(true);
  });

  it("a static page beside a dynamic route is never given the dynamic route's walkthrough", () => {
    for (const { route } of WALKTHROUGHS.filter((w) => /\[/.test(w.route))) {
      const shape = route.split("/");
      const siblings = [...pages.keys()].filter((page) => {
        const parts = page.split("/");
        return (
          page !== route &&
          parts.length === shape.length &&
          parts.every((part, i) => part === shape[i] || (/^\[.*\]$/.test(shape[i]) && !/^\[.*\]$/.test(part)))
        );
      });
      for (const sibling of siblings) {
        expect(
          walkthroughFor(sibling)?.route,
          `${sibling} would get ${route}'s walkthrough — give it its own, or teach walkthroughFor it is not an id`,
        ).not.toBe(route);
      }
    }
  });
});

describe("every step points at something its page renders", () => {
  for (const walkthrough of WALKTHROUGHS) {
    describe(walkthrough.route, () => {
      it("has steps, each with a title and a short plain body", () => {
        expect(walkthrough.title.trim()).not.toBe("");
        expect(walkthrough.steps.length).toBeGreaterThan(0);
        for (const step of walkthrough.steps) {
          expect(step.anchor).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
          expect(step.title.trim(), step.anchor).not.toBe("");
          const sentences = step.body.split(/[.!?](?:\s|$)/).filter((part) => part.trim() !== "");
          expect(sentences.length, `${step.anchor}: say it in 1-3 sentences`).toBeLessThanOrEqual(3);
          expect(step.body.length, `${step.anchor}: too long for a phone sheet`).toBeLessThanOrEqual(300);
        }
      });

      it("no two steps share an anchor", () => {
        const anchors = walkthrough.steps.map((step) => step.anchor);
        expect(anchors.filter((anchor, i) => anchors.indexOf(anchor) !== i)).toEqual([]);
      });

      it("every anchor is a data-tour literal in the page or something it renders", () => {
        const present = anchorsReachedFrom(walkthrough.route);
        const missing = walkthrough.steps.map((step) => step.anchor).filter((anchor) => !present.has(anchor));
        expect(missing, `no data-tour="…" for these in ${walkthrough.route} or its imports`).toEqual([]);
      });
    });
  }

  it("no anchor in the app is left over with no step pointing at it", () => {
    const used = new Set(WALKTHROUGHS.flatMap((w) => w.steps.map((step) => step.anchor)));
    const orphans = [...new Set(anchorLiteralsByGit())].filter((id) => !used.has(id));
    expect(orphans, "data-tour attributes no step uses — remove them or write the step").toEqual([]);
  });

  it("anchors are literals, never expressions the census cannot read", () => {
    let out = "";
    try {
      out = execFileSync(
        "git",
        ["grep", "--untracked", "-n", "-E", "data-tour=[{']", "--", "apps/web", ":!*.test.ts"],
        { cwd: repoRoot, encoding: "utf8" },
      );
    } catch (error) {
      if ((error as { status?: number }).status !== 1) throw error;
    }
    expect(out.trim()).toBe("");
  });
});

describe("coverage of the nav", () => {
  const navRoutes = NAV_ITEMS.map((item) => item.href);
  const covered = (href: string) => walkthroughFor(href) !== null;

  it("reads the whole nav", () => {
    expect(navRoutes.length).toBeGreaterThan(30);
  });

  it("every nav page has a walkthrough or is listed as not having one yet", () => {
    const unaccounted = navRoutes.filter((href) => !covered(href) && !ROUTES_WITHOUT_WALKTHROUGH.includes(href));
    expect(unaccounted, "add these to ROUTES_WITHOUT_WALKTHROUGH, or write their walkthrough").toEqual([]);
  });

  it("nothing is both covered and listed as uncovered", () => {
    expect(ROUTES_WITHOUT_WALKTHROUGH.filter(covered), "take these off ROUTES_WITHOUT_WALKTHROUGH").toEqual([]);
  });

  it("the uncovered list names only nav pages, once each", () => {
    expect(ROUTES_WITHOUT_WALKTHROUGH.filter((href) => !navRoutes.includes(href))).toEqual([]);
    expect(new Set(ROUTES_WITHOUT_WALKTHROUGH).size).toBe(ROUTES_WITHOUT_WALKTHROUGH.length);
  });
});
