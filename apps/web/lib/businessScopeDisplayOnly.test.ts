/**
 * `isHiddenByBusinessScope` IS A DISPLAY PREFERENCE, AND ONLY THE RAIL MAY
 * ASK IT ANYTHING.
 *
 * WHY THIS FILE EXISTS. `lib/businessScope.ts` opens by saying, in capitals,
 * that it is "A DISPLAY PREFERENCE, NEVER A SECURITY BOUNDARY" — a route it
 * hides is still reachable by direct URL, still returned by global search,
 * still explained by Ask. Every word of that is true today and NOTHING
 * ENFORCES IT. The function is exported from a module any file in this app can
 * import with one line, and the moment a page, a loader, an action or a search
 * filter calls it, three promises break at once: the settings screen's
 * "nothing is removed for good", search's completeness, and Ask's ability to
 * explain a feature it can no longer see. None of those breakages is visible
 * on any screen — a customer who answered "no public work" simply never learns
 * that a page exists, which is indistinguishable from the feature working.
 *
 * This is the #540 shape one axis over: a section hidden from the nav whose
 * ACTION stayed reachable. There the hidden thing was still doable and should
 * not have been; here the hidden thing must STAY doable, and the failure mode
 * is somebody helpfully "finishing" a half-built feature by wiring the display
 * filter into a gate. The guard matters more as the map grows: it hides three
 * routes today and the coverage work in flight grows that list, so the blast
 * radius of one misplaced import grows with it.
 *
 * WHAT IT ASSERTS, in the three shapes CLAUDE.md requires of a check that
 * DERIVES the set it reasons about — all three failure modes are live here:
 *
 *   SIZE — the files referencing this module are found TWICE, by two
 *   mechanisms that share no regex: an import-statement grammar, and a
 *   backwards scan from the literal characters `businessScope` + a quote to
 *   whatever quoted specifier contains them. The two sets must be equal. And
 *   the FILE WALK is counted twice as well, by its own regex and by
 *   `path.extname`, because a discovery pattern that matches nothing is the
 *   failure that looks exactly like a pass: no file is ever an illegal
 *   importer in an empty list. Two named files must be in the walk, so a
 *   walk that collapses reports which file it lost.
 *
 *   SCOPE — the roots come from `tailwind.config.ts`'s `content` globs AND
 *   `tsconfig.json`'s `include`, each asserted to exist. The second source is
 *   not belt-and-braces: `content` covers `app/`, `components/` and
 *   `packages/ui/src` and does NOT cover `lib/`, which is where this module
 *   lives and where a server-side gate would most naturally be written. A
 *   census of this defect scoped to `content` alone could not see the likeliest
 *   offender at all. "Nothing is ever missing from a directory you do not
 *   walk" — theme-contrast.test.ts, 2026-09-16, one 1.53:1 button.
 *
 *   COMMENTS — every read is on the source with comments stripped, and the
 *   stripper is LENGTH-PRESERVING (comment bodies become spaces, newlines
 *   survive) so a byte offset still maps to a line number and an offender can
 *   be named with one. This is not hypothetical decoration: `businessScope.ts`
 *   and `navItems.tsx` both discuss `isHiddenByBusinessScope` at length in
 *   prose, and `navItems.test.ts` names it in a comment while importing
 *   something else. A raw-text census would find importers that do not exist
 *   and, worse, would go green on a real import hidden under a `//`. That is
 *   #185's shape.
 *
 * WHO IS ALLOWED, AND HOW TO ADD SOMEBODY. `RAIL_FILES` below is the rail's
 * own files, named rather than pattern-matched. If the rail legitimately grows
 * a fourth consumer — the coverage work in flight may move the call between
 * `Sidebar`, `MobileNav` and `navItems` — add its path there WITH the one-line
 * reason it is display-only, and the failure message says so rather than
 * leaving a reviewer to guess. Test files are exempt as a class, for the one
 * reason that cannot rot: a vitest module renders no rail and gates no
 * request, and the module's own tests have to import the thing they test. That
 * exemption is asserted rather than assumed — at least one test file must
 * actually be found importing the symbol, which doubles as the positive
 * control that the import detection works on a real file on disk.
 *
 * WHAT IT DOES AND DOES NOT CHECK, said plainly. It reads every way a static
 * specifier can reach this module — a named import, an alias, a namespace
 * import, a default import, a dynamic `import()` with a literal specifier, and
 * an `export … from`. That last one is not thoroughness for its own sake: a
 * re-export hands the symbol to a file importing the BARREL, which this census
 * would then have no reason to look at, so the barrel itself is the offender
 * and the message says so. What it CANNOT see is a specifier computed at
 * runtime, and a COPY of the `ROUTE_HIDDEN_WHEN` table pasted somewhere else.
 * That second one is the "is there a second list" question CLAUDE.md added on
 * 2026-09-26; it belongs to whoever owns the map, and this file answers the
 * other one — "does anything outside the rail ask the question" — which is the
 * one a wrong answer silently removes a feature over.
 */

import { extname, dirname, resolve, relative, sep } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import tailwind from "../tailwind.config";

const appDir = resolve(new URL("..", import.meta.url).pathname);

/** The module under guard, and the symbol that must stay display-only. */
const MODULE = resolve(appDir, "lib/businessScope.ts");
const SYMBOL = "isHiddenByBusinessScope";

/**
 * The rail's own files. Named, not matched: `components/*Nav*` would admit
 * whatever somebody names a new file, which is an allowlist that grows by
 * itself. Each one must still exist (an exemption that outlives its file is a
 * rule quietly repealed) and the rail as a whole must still consult the
 * symbol, but no individual file is required to — the call lives in
 * `navItems.tsx` today and may legitimately move between these three.
 */
const RAIL_FILES = [
  // Builds the nav groups and is the one place the filter is applied today.
  "components/navItems.tsx",
  // Renders whatever `navGroupsFor()` hands it; may legitimately filter.
  "components/Sidebar.tsx",
  // The phone's rail, same decision on a narrower screen.
  "components/MobileNav.tsx",
] as const;

/* ------------------------------------------------------------------ *
 * Comment stripping, length-preserving and string-aware.
 * ------------------------------------------------------------------ */

/**
 * Comment bodies become spaces; newlines, quotes and every other byte keep
 * their offset, so `lineOf()` below can turn an index into a line number.
 *
 * String- and template-aware, so a `//` inside a URL literal does not start a
 * comment. Its one known limitation, stated rather than hidden: an unbalanced
 * quote inside a REGEX literal would flip the scanner into string state and
 * swallow the rest of the file. Import statements sit above any such code, and
 * if it ever happened the size assertion and the two positive controls below
 * go red naming the file, rather than this census quietly shrinking.
 */
function stripComments(source: string): string {
  const out = [...source];
  let state: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "tpl";
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") state = "code";
      else out[i] = " ";
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "code";
        i += 2;
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i += 1;
      continue;
    }
    /* inside a string literal */
    if (c === "\\") {
      i += 2;
      continue;
    }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) state = "code";
    i += 1;
  }
  return out.join("");
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/* ------------------------------------------------------------------ *
 * SCOPE: the roots, from two sources that cannot drift with this file.
 * ------------------------------------------------------------------ */

type Tsconfig = {
  compilerOptions?: { paths?: Record<string, string[]> };
  include?: string[];
  exclude?: string[];
};

const tsconfig = JSON.parse(readFileSync(resolve(appDir, "tsconfig.json"), "utf8")) as Tsconfig;

/** The prefix of a glob, up to its first `*`. `""` means the root itself. */
function globRoot(glob: string): string {
  const star = glob.indexOf("*");
  return resolve(appDir, star === -1 ? glob : glob.slice(0, star));
}

const contentGlobs = (Array.isArray(tailwind.content) ? tailwind.content : []) as string[];
const contentRoots = contentGlobs.map(globRoot);

/**
 * `include` entries fall into exactly three kinds, and an entry matching none
 * of them is reported by name rather than dropped: a source-glob root we walk,
 * a single declaration FILE (`next-env.d.ts` — no `*`, nothing to walk), and
 * GENERATED output under a dot-directory (`.next/types/**`), which is absent
 * on a fresh checkout and is not source anybody could hide an import in.
 */
const includeEntries = Array.isArray(tsconfig.include) ? tsconfig.include : [];
const classified = includeEntries.map((entry) => ({
  entry,
  kind: entry.startsWith(".") ? "generated" : !entry.includes("*") ? "file" : "root",
}));
const tsRoots = classified.filter((c) => c.kind === "root").map((c) => globRoot(c.entry));

/** Directories never walked: `node_modules` comes from tsconfig's own
 * `exclude`, and a dot-directory is build output (`.next`, `.turbo`). */
const excluded = new Set(tsconfig.exclude ?? []);

/** Roots with any root that is nested inside another root removed, so a file
 * under both `**` and `./app/**` is read once. Existence is asserted on every
 * glob-derived root BEFORE this collapse, so a glob resolving to nothing still
 * fails loudly instead of being absorbed by its parent. */
function outermost(all: string[]): string[] {
  const unique = [...new Set(all)];
  return unique.filter(
    (candidate) => !unique.some((other) => other !== candidate && !relative(other, candidate).startsWith("..")),
  );
}

const roots = outermost([...contentRoots, ...tsRoots]);

/* ------------------------------------------------------------------ *
 * THE WALK, counted two ways.
 * ------------------------------------------------------------------ */

const SOURCE_FILE = /\.tsx?$/;
const TEST_FILE = /\.(test|spec|dbtest)\.tsx?$/;

/** Every file under `root`, by the given predicate. A root that is not a
 * directory yields EMPTY rather than throwing: an exception at module scope
 * collects no tests at all, which reads as "no tests" and names nothing —
 * the scope assertion below is what reports it, by name. */
function walk(root: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  if (!(statSync(root, { throwIfNoEntry: false })?.isDirectory() ?? false)) return out;
  const recurse = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || excluded.has(entry.name)) continue;
        recurse(full);
      } else if (keep(entry.name)) out.push(full);
    }
  };
  recurse(root);
  return out;
}

const scanned = roots.flatMap((root) => walk(root, (name) => SOURCE_FILE.test(name)));
/* THE SECOND COUNT OF THE WALK, sharing no regex with the first — a discovery
   pattern that matches nothing passes every assertion downstream, because
   nothing is ever an illegal importer in an empty list. */
const scannedByExtname = roots.flatMap((root) => walk(root, (name) => [".ts", ".tsx"].includes(extname(name))));

const rel = (full: string) => relative(appDir, full).split(sep).join("/");

/* ------------------------------------------------------------------ *
 * Which files reference the module — found two ways.
 * ------------------------------------------------------------------ */

const paths = tsconfig.compilerOptions?.paths ?? {};

/**
 * A specifier to an absolute file, or null. `@/…` comes from tsconfig's own
 * `paths` rather than a hardcoded guess, so an alias change moves this with it.
 */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let bare: string | null = null;
  if (specifier.startsWith(".")) bare = resolve(dirname(fromFile), specifier);
  else {
    for (const [pattern, targets] of Object.entries(paths)) {
      const prefix = pattern.replace(/\*$/, "");
      if (!pattern.endsWith("*") || !specifier.startsWith(prefix)) continue;
      const target = targets[0]?.replace(/\*$/, "") ?? "";
      bare = resolve(appDir, target, specifier.slice(prefix.length));
      break;
    }
  }
  if (bare === null) return null;
  for (const candidate of [bare, `${bare}.ts`, `${bare}.tsx`, resolve(bare, "index.ts")]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile() ?? false) return candidate;
  }
  return null;
}

/** MECHANISM ONE: the import-statement grammar. `[^;]` rather than `[\s\S]`
 * so a clause cannot run past the end of its own statement. The keyword is
 * captured, not discarded: an `export … from` of this module is a RE-EXPORT,
 * which hands the symbol to importers this census would then never see. */
const STATIC_FROM = /\b(import|export)\b([^;]*?)\bfrom\s*(["'])([^"']+)\3/g;
const SIDE_EFFECT = /\bimport\s*(["'])([^"']+)\1/g;
const DYNAMIC = /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g;

type Site = {
  file: string;
  line: number;
  clause: string;
  /** `import`/`export … from`, a bare side-effect import (reaches nothing), or
   * a dynamic `import()` (reaches every export). */
  kind: "import" | "export" | "bare" | "dynamic";
};

function sitesByGrammar(stripped: string, full: string): Site[] {
  const sites: Site[] = [];
  for (const match of stripped.matchAll(STATIC_FROM)) {
    if (resolveSpecifier(match[4], full) !== MODULE) continue;
    sites.push({
      file: rel(full),
      line: lineOf(stripped, match.index),
      clause: match[2],
      kind: match[1] === "export" ? "export" : "import",
    });
  }
  for (const [pattern, kind] of [
    [SIDE_EFFECT, "bare"],
    [DYNAMIC, "dynamic"],
  ] as const) {
    for (const match of stripped.matchAll(pattern)) {
      if (resolveSpecifier(match[2], full) !== MODULE) continue;
      sites.push({ file: rel(full), line: lineOf(stripped, match.index), clause: "", kind });
    }
  }
  return sites;
}

/**
 * MECHANISM TWO, for the size assertion: no regex and no knowledge of import
 * grammar at all. Find the literal characters `businessScope` followed by a
 * quote, walk BACKWARDS to that quote's partner, and resolve whatever string
 * that is. It therefore sees an `export … from`, a reformatted import, or a
 * spelling mechanism one has stopped matching — which is the drift it exists
 * to catch.
 */
function referencesModuleByScan(stripped: string, full: string): boolean {
  const needle = "businessScope";
  for (let at = stripped.indexOf(needle); at !== -1; at = stripped.indexOf(needle, at + 1)) {
    const after = stripped[at + needle.length];
    if (after !== '"' && after !== "'") continue;
    const open = stripped.lastIndexOf(after, at - 1);
    if (open === -1) continue;
    if (resolveSpecifier(stripped.slice(open + 1, at + needle.length), full) === MODULE) return true;
  }
  return false;
}

type Referencing = { file: string; full: string; stripped: string; sites: Site[] };

const referencing: Referencing[] = [];
const byScan: string[] = [];
for (const full of scanned) {
  if (full === MODULE) continue; /* the module does not import itself */
  const stripped = stripComments(readFileSync(full, "utf8"));
  const sites = sitesByGrammar(stripped, full);
  if (sites.length > 0) referencing.push({ file: rel(full), full, stripped, sites });
  if (referencesModuleByScan(stripped, full)) byScan.push(rel(full));
}

/** How this site reaches the symbol, or `false` if it cannot.
 *
 * Every way of reaching it is named rather than assumed away, because the ones
 * that look impossible are the ones no message would explain: a namespace
 * import reaches every export, a dynamic `import()` reaches every export at
 * runtime, and an `export … from` hands it to a file this census would then
 * have no reason to look at. A DEFAULT import is included for the same reason
 * and would be a type error today — `businessScope.ts` has no default export —
 * which is an argument for checking it cheaply, not for trusting it.
 *
 * `type`-only imports are NOT reaching it: a type cannot be called. This
 * matters more than it sounds, because the type is what nearly every file
 * importing this module actually wants — `BusinessScopeAnswers` travels
 * through the layout, the topbar and Ask — so a census that counted a type
 * import as a caller would fail on eight innocent files and be deleted. */
type Reach = "named" | "namespace" | "default" | "dynamic" | "re-export" | "re-export *";

function importsSymbol(site: Site): false | Reach {
  if (site.kind === "bare") return false;
  if (site.kind === "dynamic") return "dynamic";
  /* `import type { … }` and `export type { … }`: the modifier is dropped so
     the clause reads the same as an ordinary one, and the names below carry
     their own per-name `type` prefix anyway. */
  const clause = site.clause.replace(/^\s*type\b/, " ");
  const isTypeOnly = /^\s*type\b/.test(site.clause);
  const braces = clause.match(/\{([^}]*)\}/);
  const named = (braces?.[1] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .filter((part) => !/^type\s/.test(part))
    .map((part) => part.split(/\s+as\s+/)[0].trim());
  const NAMESPACE = /\*\s*as\s+[A-Za-z_$][\w$]*/;
  if (site.kind === "export") {
    if (isTypeOnly) return false;
    if (/^\s*\*/.test(clause)) return "re-export *";
    return named.includes(SYMBOL) ? "re-export" : false;
  }
  if (isTypeOnly) return false;
  if (named.includes(SYMBOL)) return "named";
  if (NAMESPACE.test(clause)) return "namespace";
  const rest = clause.replace(/\{[^}]*\}/g, " ").replace(NAMESPACE, " ").trim();
  return /^[A-Za-z_$][\w$]*\s*,?$/.test(rest) ? "default" : false;
}

const symbolImporters = referencing
  .flatMap((file) => file.sites.map((site) => ({ ...site, isTest: TEST_FILE.test(file.file) })))
  .map((site) => ({ ...site, how: importsSymbol(site) }))
  .filter((site) => site.how !== false);

describe(`${SYMBOL} is display-only, and only the rail may ask it`, () => {
  it("walks every directory a caller could live in", () => {
    expect(
      contentRoots.length,
      "tailwind.config.ts declares no `content` globs, so half this census's scope came from nothing",
    ).toBe(contentGlobs.length);
    expect(contentRoots.length).toBeGreaterThanOrEqual(3);
    expect(
      classified.filter((c) => c.kind === "root").map((c) => c.entry).length,
      "tsconfig.json's `include` yielded no source-glob root, so `lib/` — where this module lives and " +
        "where a server-side gate would be written — is outside the walk. `content` does not cover it.",
    ).toBeGreaterThan(0);
    for (const root of [...contentRoots, ...tsRoots]) {
      expect(
        statSync(root, { throwIfNoEntry: false })?.isDirectory() ?? false,
        `${root} is a glob-derived root that does not exist — nothing is ever missing from a directory ` +
          `you do not walk, so this census cannot report on it`,
      ).toBe(true);
    }
    /* `lib/` specifically, by name: the likeliest home for the gate this file
       exists to forbid, and the directory `content` alone would have missed. */
    expect(
      roots.some((root) => !relative(root, resolve(appDir, "lib")).startsWith("..")),
      "no root contains apps/web/lib, the directory this module itself lives in",
    ).toBe(true);
  });

  it("scanned as many files as the sources contain", () => {
    /* THE WALK'S SIZE, by `path.extname` rather than by the walk's own regex.
       A discovery pattern that matches nothing is the failure mode that looks
       like a pass. */
    expect(
      scanned.length,
      `the walk found ${scanned.length} TypeScript files and an independent extension check found ` +
        `${scannedByExtname.length} — the file-discovery pattern has drifted`,
    ).toBe(scannedByExtname.length);
    expect(scanned.length, "the walk found no TypeScript files at all, so this census is about nothing").toBeGreaterThan(
      500,
    );
    /* And two files BY NAME, so a walk that collapses says which it lost. */
    for (const named of ["lib/businessScope.ts", "components/navItems.tsx"]) {
      expect(scanned.map(rel), `${named} is not in the walk, so this census cannot see its own subject`).toContain(
        named,
      );
    }
  });

  it("parsed as many importing files as a grammar-free scan finds", () => {
    /* THE SIZE ASSERTION on the set actually reasoned about, by two mechanisms
       sharing no regex. A grammar that stops matching would otherwise report
       zero illegal importers, honestly and uselessly. */
    expect(
      referencing.map((file) => file.file).sort(),
      "the import grammar and a grammar-free scan for the module specifier disagree about which files " +
        "reference lib/businessScope — one of the two has drifted, and the census reasons about the first",
    ).toEqual(byScan.sort());
    expect(
      referencing.length,
      "no file in the walk imports lib/businessScope at all, so this census is about nothing",
    ).toBeGreaterThan(0);
  });

  it("nothing outside the rail imports it", () => {
    const allowed = new Set<string>(RAIL_FILES);
    const offenders = symbolImporters
      .filter((site) => !site.isTest && !allowed.has(site.file))
      .map(
        (site) =>
          `${site.file}:${site.line} imports ${SYMBOL} (${site.how})`,
      );
    expect(
      offenders,
      `${SYMBOL} decides what the RAIL advertises and nothing else. lib/businessScope.ts's own header ` +
        `says so, and the settings screen promises a customer that "nothing is removed for good: every ` +
        `page stays reachable by search, by Ask and by its own link". A caller outside the rail turns ` +
        `that promise false with no error and nothing on screen — the customer simply never learns the ` +
        `page exists.\n\nIf this caller IS the rail — the call may legitimately move between ` +
        `navItems/Sidebar/MobileNav — add its path to RAIL_FILES in this file with the one-line reason ` +
        `it is display-only. If it is not, the page it wants to hide needs a capability in ` +
        `lib/permissions.ts (ROUTE_CAPABILITY), which is the map that decides what a PERSON may do.`,
    ).toEqual([]);
  });

  it("the rail still consults it, and each allowed file still exists", () => {
    /* An allowlist nobody uses guards nothing, and one that outlives its files
       is a rule quietly repealed. Neither is asserted per-file: the call lives
       in navItems.tsx today and may move between these three. */
    for (const file of RAIL_FILES) {
      expect(
        statSync(resolve(appDir, file), { throwIfNoEntry: false })?.isFile() ?? false,
        `${file} is on this census's allowlist and is not a file — drop it or fix the path`,
      ).toBe(true);
    }
    const railImporters = symbolImporters.filter((site) => (RAIL_FILES as readonly string[]).includes(site.file));
    expect(
      railImporters.map((site) => `${site.file}:${site.line}`),
      `no rail file imports ${SYMBOL}, so either the feature stopped working or the import detection ` +
        `here has drifted — both of which this census would otherwise report as clean`,
    ).not.toEqual([]);
  });

  it("CONTROL: a test file imports it, which is what proves the detection works on disk", () => {
    /* The exemption for tests, doubling as a positive control. If this ever
       goes red, either lib/businessScope.test.ts stopped testing the symbol or
       nothing here can find an import that is demonstrably there. */
    const testImporters = symbolImporters.filter((site) => site.isTest).map((site) => site.file);
    expect(
      testImporters,
      "no test file imports the symbol — a vitest module renders no rail and gates no request, which is " +
        "why tests are exempt, but it means this control is the only proof the detection matches a real file",
    ).not.toEqual([]);
  });

  it("CONTROL: prose cannot create an importer, and cannot hide one", () => {
    /* #185's shape in both directions, and not hypothetical: businessScope.ts
       and navItems.tsx both name this symbol in their headers, and
       navItems.test.ts names it in a comment while importing something else. */
    const commented = stripComments(
      ['/* import { isHiddenByBusinessScope } from "@/lib/businessScope"; */', "const x = 1;"].join("\n"),
    );
    expect(commented).not.toContain(SYMBOL);
    expect(commented).toHaveLength(
      '/* import { isHiddenByBusinessScope } from "@/lib/businessScope"; */\nconst x = 1;'.length,
    );

    const lineCommented = stripComments(`// ${SYMBOL} is display-only\nconst y = 2;`);
    expect(lineCommented).not.toContain(SYMBOL);
    expect(lineOf(lineCommented, lineCommented.indexOf("const y"))).toBe(2);

    /* A `//` inside a string is not a comment, or every import under a URL
       literal would vanish from the census. */
    const url = stripComments('const u = "https://example.test/a";\nconst z = 3;');
    expect(url).toContain("https://example.test/a");

    /* And a real import is still there once stripped. */
    const real = `import { ${SYMBOL} } from "@/lib/businessScope";`;
    expect(stripComments(real)).toBe(real);
  });

  it("CONTROL: the clause reader sees named, aliased, namespace and type-only imports for what they are", () => {
    const at = (clause: string, kind: Site["kind"] = "import"): false | Reach =>
      importsSymbol({ file: "x", line: 1, clause, kind });
    expect(at(` { ${SYMBOL}, type BusinessScopeAnswers } `)).toBe("named");
    expect(at(` { ${SYMBOL} as hide } `)).toBe("named");
    expect(at(" * as scope ")).toBe("namespace");
    expect(at(" scope ")).toBe("default");
    expect(at("", "dynamic")).toBe("dynamic");
    expect(at("", "bare")).toBe(false);
    /* A re-export hands the symbol on, and the file that then imports the
       BARREL is invisible to this census — so the barrel itself is the
       offender. */
    expect(at(" * ", "export")).toBe("re-export *");
    expect(at(` { ${SYMBOL} } `, "export")).toBe("re-export");
    expect(at(" { UNANSWERED_SCOPE } ", "export")).toBe(false);
    /* The imports every other file in this app actually has: types and the
       other exports, none of which is the gate. A type cannot be called, and
       `BusinessScopeAnswers` travels through eight innocent files. */
    expect(at(" type { BusinessScopeAnswers } ")).toBe(false);
    expect(at(` type { ${SYMBOL} } `)).toBe(false);
    expect(at(` { type ${SYMBOL} } `)).toBe(false);
    expect(at(" { UNANSWERED_SCOPE } ")).toBe(false);
    expect(at(" { businessScopeLine, hasNoScopeAnswers, type BusinessScopeAnswers } ")).toBe(false);
  });

  it("CONTROL: the module still exports the symbol this census is named after", () => {
    /* A census hunting a renamed symbol is green forever. */
    const source = stripComments(readFileSync(MODULE, "utf8"));
    expect(source, `lib/businessScope.ts no longer exports ${SYMBOL} — this census is hunting a ghost`).toContain(
      `export function ${SYMBOL}(`,
    );
  });
});
