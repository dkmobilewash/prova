/**
 * EVERY TEST FILE IN THIS REPOSITORY IS COLLECTED BY SOME RUNNER.
 *
 * WHY THIS FILE EXISTS. CLAUDE.md records 161 `.dbtest.ts` files that no
 * runner referenced — written, green by absence, never executed — and
 * `ci.yml`'s own `dbtest` job comment still describes them as "the 144
 * database tests that, until now, nothing ran". That was fixed by adding a
 * runner. Nothing was added to stop it happening again, and it was already
 * half-happening: `vitest.config.mts` includes `**​/*.test.ts` and NOT
 * `**​/*.test.tsx`, so on 2026-09-24 a deliberately-failing
 * `lib/ZZ_orphan_probe.test.tsx` was dropped into `apps/web` and
 * `pnpm test` reported 454 files, 7202 tests, all green. Asked to run that
 * one file, vitest printed `No test files found` and its own
 * `include: **​/*.test.ts` underneath.
 *
 * Nothing was orphaned at that moment, because no `.test.tsx` existed in
 * `apps/web` yet. That is the entire danger: `.tsx` is the natural
 * extension for a component test and it is the one `apps/mobile/screens`
 * already uses for exactly that, so the first person to write a rendered
 * component test here would have got a file that is collected by nothing
 * and reads as passing.
 *
 * WHAT IT REASONS ABOUT, and both halves are derived rather than listed:
 *
 *   SCOPE comes from `pnpm-workspace.yaml` — the repo's own definition of
 *   what a package is — and the file set comes from `git ls-files`. A new
 *   workspace package is in scope the day it is committed, with no edit
 *   here, and a workspace glob that expands to nothing fails loudly
 *   instead of silently shrinking the walk.
 *
 *   THE RUNNERS come from each package's own `package.json` scripts, and
 *   the include globs come from importing the config those scripts name —
 *   the same object vitest itself reads. Not a regex over the config text:
 *   a second copy of the includes here could drift from the real ones and
 *   report coverage that does not exist.
 *
 * WHAT IT CANNOT SEE, said plainly. It proves a file is COLLECTIBLE by a
 * script, not that CI runs that script: `test:db` and `ask:eval` are real
 * runners and `pnpm test` invokes neither (CI's `dbtest` job runs the
 * first; the eval is run by hand with a key). It says nothing about
 * whether a collected test asserts anything — every other census here is
 * for that. And a `describe` that generates no cases is collected and
 * still vacuous; `plumbing.test.ts` carries the size assertion for its own
 * `it.each`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/* ----------------------------------------------------------------- scope */

/**
 * The workspace package directories, expanded from `pnpm-workspace.yaml`.
 *
 * Parsed with a line matcher rather than a YAML library because this file
 * has exactly one shape and pulling in a parser to read six lines is a
 * dependency nobody reviews. The shape is asserted below: the glob list
 * must be non-empty and every glob must expand to at least one directory
 * that holds a `package.json`.
 */
function workspaceGlobs(): string[] {
  const text = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const globs: string[] = [];
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = line.match(/^\s+-\s*["']?([^"'\s]+)["']?\s*$/);
      if (item) {
        globs.push(item[1]);
        continue;
      }
      if (line.trim() !== "") break; // the next top-level key ends the list
    }
  }
  return globs;
}

/** `apps/*` → every directory under `apps/` that has a package.json. */
function expandGlob(glob: string): string[] {
  if (!glob.endsWith("/*")) {
    return existsSync(join(repoRoot, glob, "package.json")) ? [glob] : [];
  }
  const parent = glob.slice(0, -2);
  return readdirSync(join(repoRoot, parent))
    .map((name) => `${parent}/${name}`)
    .filter((rel) => statSync(join(repoRoot, rel)).isDirectory())
    .filter((rel) => existsSync(join(repoRoot, rel, "package.json")))
    .sort();
}

const GLOBS = workspaceGlobs();
const PACKAGES = [...new Set(GLOBS.flatMap(expandGlob))].sort();

/* ------------------------------------------------------------- the files */

const TEST_FILE = /\.(test|dbtest|eval)\.(ts|tsx|mts)$/;

/** Every test file the repo tracks OR merely holds. `--others
 * --exclude-standard` for the same reason `counterCensus.test.ts` uses it:
 * a file written but not yet `git add`ed is exactly the one that needs
 * this answer, and `--cached` alone would let it sit outside the census
 * until after the review. */
function testFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean).filter((p) => TEST_FILE.test(p)).sort();
}

const FILES = testFiles();

/* ----------------------------------------------------------- the runners */

type Runner = { pkg: string; script: string; config: string; include: string[] };

/** The config a `vitest run …` command uses: the one it names, or the
 * package's default `vitest.config.*`. */
function configFor(pkg: string, command: string): string | null {
  const named = command.match(/--config[= ]+(\S+)/);
  if (named) return named[1];
  for (const name of ["vitest.config.mts", "vitest.config.ts", "vitest.config.mjs", "vitest.config.js"]) {
    if (existsSync(join(repoRoot, pkg, name))) return name;
  }
  return null;
}

/** Every (package, script, config) that runs vitest, with the include globs
 * read out of the config module itself. */
async function runners(): Promise<Runner[]> {
  const found: Runner[] = [];
  for (const pkg of PACKAGES) {
    const scripts: Record<string, string> =
      JSON.parse(readFileSync(join(repoRoot, pkg, "package.json"), "utf8")).scripts ?? {};
    for (const [script, command] of Object.entries(scripts)) {
      // One script may run vitest more than once (`vitest run && vitest run
      // --config …`), so each `vitest run` is taken separately.
      for (const part of command.split("&&")) {
        if (!/\bvitest\s+run\b/.test(part)) continue;
        const config = configFor(pkg, part);
        expect(config, `${pkg} script "${script}" runs vitest with no config this can find`).not.toBeNull();
        const mod = (await import(/* @vite-ignore */ join(repoRoot, pkg, config!))) as {
          default?: { test?: { include?: string[] } };
        };
        found.push({ pkg, script, config: config!, include: mod.default?.test?.include ?? [] });
      }
    }
  }
  return found;
}

/* ------------------------------------------------------------ the matcher */

/** A vitest include glob as a RegExp over the path RELATIVE to its package.
 * Only the three constructs these configs use, spelled out rather than
 * approximated: `**​/` (any depth, including none), `**` and `*`. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      out += ".*";
      i += 1;
    } else if (glob[i] === "*") {
      out += "[^/]*";
    } else {
      out += glob[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

/* -------------------------------------------------------------- the suite */

describe("the test-runner census can see what it claims to", () => {
  it("expands every workspace glob to at least one real package", () => {
    expect(GLOBS.length, "pnpm-workspace.yaml declared no packages: list").toBeGreaterThan(0);
    for (const glob of GLOBS) {
      expect(
        expandGlob(glob).length,
        `${glob} expands to no package — a glob that resolves to nothing removes whole ` +
          `directories from this census without removing them from the repo`,
      ).toBeGreaterThan(0);
    }
    // Named members, because a count of a set that lost a directory looks
    // perfectly healthy. These are the packages that hold code today.
    for (const pkg of ["apps/web", "apps/mobile", "packages/db", "packages/integrations", "packages/ui"]) {
      expect(PACKAGES, `${pkg} is not in the workspace expansion`).toContain(pkg);
    }
  });

  it("finds every test file git knows about, counted twice", () => {
    // Size, from a second derivation that shares no pattern with the first:
    // git's own pathspec filter instead of this file's regex.
    const byPathspec = execFileSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "*.test.ts",
        "*.test.tsx",
        "*.test.mts",
        "*.dbtest.ts",
        "*.dbtest.tsx",
        "*.dbtest.mts",
        "*.eval.ts",
        "*.eval.tsx",
        "*.eval.mts",
      ],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
      .split("\0")
      .filter(Boolean)
      .sort();
    expect(FILES).toEqual(byPathspec);
    expect(FILES.length, "almost no test files found — is this a checkout?").toBeGreaterThan(400);
    // Both extensions, so a filter that has narrowed to one fails here.
    expect(FILES.some((f) => f.endsWith(".test.ts"))).toBe(true);
    expect(FILES.some((f) => f.endsWith(".test.tsx"))).toBe(true);
    expect(FILES.some((f) => f.endsWith(".dbtest.ts"))).toBe(true);
  });

  it("reads the include globs out of the configs the scripts actually name", async () => {
    const found = await runners();
    expect(found.length, "no package.json script in this workspace runs vitest").toBeGreaterThanOrEqual(5);
    for (const r of found) {
      expect(
        r.include.length,
        `${r.pkg}/${r.config} (script "${r.script}") declares no test.include, so this census ` +
          `cannot tell what it collects`,
      ).toBeGreaterThan(0);
    }
    // The five runners that exist today, named — so a script or config that
    // disappears fails here rather than shrinking the coverage silently.
    const named = found.map((r) => `${r.pkg}:${r.config}`).sort();
    for (const pinned of [
      "apps/mobile:vitest.config.mts",
      "apps/mobile:vitest.screens.config.mts",
      "apps/web:vitest.config.mts",
      "apps/web:vitest.db.config.mts",
      "apps/web:vitest.eval.config.mts",
    ]) {
      expect(named, `${pinned} no longer runs from any package.json script`).toContain(pinned);
    }
  });

  it("matches globs the way the configs mean them", () => {
    // The machinery, on the exact shapes in use — so a matcher that has
    // stopped matching fails here while the verdict below still looks clean.
    expect(globToRegExp("**/*.test.ts").test("lib/a.test.ts")).toBe(true);
    expect(globToRegExp("**/*.test.ts").test("a.test.ts")).toBe(true);
    expect(globToRegExp("**/*.test.ts").test("lib/deep/a.test.ts")).toBe(true);
    expect(globToRegExp("**/*.test.ts").test("lib/a.test.tsx")).toBe(false);
    expect(globToRegExp("**/*.test.tsx").test("lib/a.test.tsx")).toBe(true);
    expect(globToRegExp("lib/**/*.test.ts").test("lib/a.test.ts")).toBe(true);
    expect(globToRegExp("lib/**/*.test.ts").test("screens/a.test.ts")).toBe(false);
    expect(globToRegExp("screens/**/*.test.tsx").test("screens/a.test.tsx")).toBe(true);
    expect(globToRegExp("**/*.dbtest.ts").test("lib/actions/a.dbtest.ts")).toBe(true);
    // `*` must not cross a directory boundary.
    expect(globToRegExp("lib/*.test.ts").test("lib/deep/a.test.ts")).toBe(false);
  });
});

describe("no test file is collected by nothing", () => {
  it("every test file in the repo is reachable by some package script", async () => {
    const found = await runners();
    const byPackage = new Map<string, Runner[]>();
    for (const r of found) byPackage.set(r.pkg, [...(byPackage.get(r.pkg) ?? []), r]);

    const orphans: string[] = [];
    for (const file of FILES) {
      const pkg = PACKAGES.filter((p) => file.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0];
      if (!pkg) {
        orphans.push(`${file} — sits outside every workspace package`);
        continue;
      }
      const rs = byPackage.get(pkg) ?? [];
      if (rs.length === 0) {
        orphans.push(`${file} — ${pkg} has no package.json script that runs vitest`);
        continue;
      }
      const rel = file.slice(pkg.length + 1);
      const collected = rs.some((r) => r.include.some((glob) => globToRegExp(glob).test(rel)));
      if (!collected) {
        orphans.push(
          `${file} — no include glob in ${rs.map((r) => r.config).join(", ")} matches "${rel}"`,
        );
      }
    }

    expect(
      orphans,
      orphans.length === 0
        ? ""
        : [
            "",
            `${orphans.length} test file(s) are collected by no runner in this workspace.`,
            "",
            ...orphans.map((o) => `  ${o}`),
            "",
            "A test nothing runs is worse than no test: it reads as coverage, it goes",
            "green by absence, and it is never wrong. CLAUDE.md records 161 of these.",
            "Either widen the config's `include`, or add a script for the package that",
            "holds the file.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });
});
