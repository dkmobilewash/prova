/**
 * The parts of the walkthrough census that read the repo — page files, the
 * import walk, and the independent `git grep` count — shared by every
 * census that holds tour prose to the pages it describes
 * (walkthroughCensus.test.ts, fullTourCensus.test.ts).
 *
 * NOT a test file and never imported by the app: it reads the disk with
 * node:fs. The name keeps it out of vitest's `*.test.ts` include, so its
 * checks run once per census that imports it, not on their own.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const webRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const repoRoot = resolve(webRoot, "../..");
export const appDir = join(webRoot, "app");

/** `data-tour="…"`, literal, lowercase words and hyphens. */
const ANCHOR = /data-tour="([a-z0-9-]+)"/g;

export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export function anchorsIn(source: string): string[] {
  return [...withoutComments(source).matchAll(ANCHOR)].map((match) => match[1]);
}

// ------------------------------------------------------------ page files --

export function walkPages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkPages(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

/** app/(app)/jobs/[id]/page.tsx -> /jobs/[id]. Route groups vanish. */
export function routeOf(pageFile: string): string {
  const segments = relative(appDir, dirname(pageFile))
    .split(/[\\/]/)
    .filter((segment) => segment && !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

export const pageFiles = walkPages(appDir);
export const pages = new Map(pageFiles.map((file) => [routeOf(file), file]));

export function pagesByGit(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "apps/web/app"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out.split("\n").filter((path) => /(^|\/)page\.tsx$/.test(path));
}

// ------------------------------------------------------------ import walk --

const IMPORT = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

export function resolveImport(spec: string, fromFile: string): string | null {
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
export function reachable(entry: string): Set<string> {
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

/** The independent count: git's own grep over the app, no import walk. */
export function anchorLiteralsByGit(): string[] {
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


/** Every `data-tour` literal the page at `route` renders, through its imports. */
export function anchorsReachedFromPage(route: string): Set<string> {
  const ids = new Set<string>();
  const page = pages.get(route);
  if (!page) return ids;
  for (const file of reachable(page)) for (const id of anchorsIn(readFileSync(file, "utf8"))) ids.add(id);
  return ids;
}
