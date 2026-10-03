import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE BAND MUST NEVER BECOME A MODEL'S OPINION.
 *
 * `lib/sales-qualification.ts` decides whether a prospect is worth calling.
 * CLAUDE.md's product rule is that where an AI feature meets numbers, the
 * arithmetic stays deterministic code and the model only narrates what it is
 * handed. This is the file that rule exists to protect: the cheapest possible
 * "improvement" to a qualification score is to ask a model, and it would be
 * invisible in a diff that also added a screen.
 *
 * So this asserts the module reaches no model. Not a convention, not a comment
 * in its header — a build failure.
 *
 * WHY A SIZE ASSERTION WOULD NOT WORK HERE, and what replaces it. This repo's
 * deriving-check rule says assert the size of the set you reason about against
 * a source that cannot drift. The set here is the module's imports, and the
 * correct value is ZERO — so "did the parse find anything" cannot be the
 * control, and a regex matching nothing would look exactly like success.
 *
 * The control is on the OTHER side instead: every forbidden pattern must match
 * at least one real import somewhere in this app. That is what proves the
 * patterns are live. A typo (`@prova/integration`, singular) or a package that
 * has been renamed would otherwise sit here forever, forbidding a string that
 * no longer exists and permitting the thing it was written to catch — the
 * "nothing is ever missing from a question nobody is asking" shape, wearing an
 * allow-list.
 *
 * COMMENTS ARE STRIPPED, and that is load-bearing rather than tidy: the
 * module's own header names `salesQualificationPurity.test.ts` and talks about
 * model packages at length, and this file's header names them too. A raw scan
 * would read prose about the rule as a violation of it — #185 exactly.
 */

const webDir = fileURLToPath(new URL("..", import.meta.url));
const TARGET = "lib/sales-qualification.ts";

/** Comments out, strings kept. */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      out += (end === -1 ? text.slice(i) : text.slice(i, end + 2)).replace(
        /[^\n]/g,
        "",
      );
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        i += 1;
      }
      out += text[i] ?? "";
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Every module specifier a file imports or re-exports — `import … from "x"`,
 * `export … from "x"`, and `import("x")`. Three forms rather than one, because
 * a dynamic import is exactly how somebody would reach a model from a module
 * that is not supposed to.
 */
function specifiersOf(code: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bimport\s[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bexport\s[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) found.push(m[1]);
  }
  return found;
}

/** Anything that can reach a language model, by specifier. */
const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  { pattern: /^@anthropic-ai\//, what: "the Anthropic SDK" },
  {
    pattern: /^@prova\/integrations/,
    what: "the integrations package, where every model call lives",
  },
  {
    pattern: /(^|\/)lib\/ask(\/|$)|^\.{1,2}\/ask(\/|$)/,
    what: "the Ask assistant",
  },
  {
    pattern: /(^|\/)lib\/ai(\/|$)|^\.{1,2}\/ai(\/|$)/,
    what: "the per-company AI settings",
  },
];

function sources(
  roots: readonly string[],
  base: string,
): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (
        name === "node_modules" ||
        name === ".next" ||
        name === "dist" ||
        name.startsWith(".")
      )
        continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts") || name.endsWith(".tsx"))
        out.push({
          path: relative(base, full).split("\\").join("/"),
          code: stripComments(readFileSync(full, "utf8")),
        });
    }
  };
  for (const root of roots) {
    const full = resolve(base, root);
    /* A root that does not exist would silently shrink the scan — the
       "nothing is ever missing from a directory you do not walk" shape. */
    if (!statSync(full).isDirectory())
      throw new Error(`scan root is not a directory: ${root}`);
    walk(full);
  }
  return out;
}

/** What this census GUARDS: the web app's own source. */
const files = sources(["app", "components", "lib"], webDir);
const target = files.find((f) => f.path === TARGET);

/**
 * What PROVES the patterns are live: the whole monorepo's source, a
 * deliberately WIDER set than the guarded one.
 *
 * The two scopes differ on purpose, and the distinction is the lesson this
 * file was nearly taught the expensive way. `@anthropic-ai/` is imported
 * nowhere under `apps/web` — the web app reaches a model only through
 * `@prova/integrations` — so judging that pattern against the guarded scope
 * alone declared it DEAD, and the obvious response would have been to delete
 * the census's own best rule. A pattern must be proven wherever the thing it
 * names could legitimately appear, and ENFORCED only where it is banned.
 */
const repoDir = resolve(webDir, "../..");
const controlCorpus = sources(
  ["apps/web/app", "apps/web/components", "apps/web/lib", "packages"],
  repoDir,
);

describe("the qualification band is deterministic code, not a model's opinion", () => {
  it("found the module it is about", () => {
    /* Named explicitly, so a rename fails here with the reason rather than
       further down as a vacuous pass over a file that no longer exists. */
    expect(
      target,
      `${TARGET} was not found. If the band moved, point this census at its new ` +
        "home — do not delete it.",
    ).toBeDefined();
    expect(target!.code).toContain("export function qualify");
  });

  it("imports nothing that can reach a model", () => {
    const violations = specifiersOf(target!.code)
      .map((spec) => {
        const hit = FORBIDDEN.find((f) => f.pattern.test(spec));
        return hit ? `${spec} — ${hit.what}` : null;
      })
      .filter((v): v is string => v !== null);

    expect(
      violations,
      `${TARGET} decides whether a prospect is worth calling, and it now reaches ` +
        "a model to do it.\n\nCLAUDE.md's product rule: the arithmetic stays " +
        "deterministic and the model only narrates what it is handed. A band a " +
        "model produced cannot be reviewed, cannot be tested from literals, and " +
        "cannot be explained to the person deciding who to ring.\n\nIf a model " +
        "should propose a SIGNAL, that belongs in the research seam — the signal " +
        "then arrives PROPOSED and a human confirms it before it counts.",
    ).toEqual([]);
  });

  it("every forbidden pattern still matches something real in this app", () => {
    /* THE CONTROL, and the reason this file is not vacuous. The set it reasons
       about is correctly empty, so nothing about the target can prove the
       patterns work. This can: each one must catch a live import somewhere. A
       pattern that matches nothing in the whole app is a pattern that has
       stopped describing this codebase, and it would permit exactly what it
       was written to forbid. */
    expect(
      files.length,
      "almost nothing was scanned — the guarded roots are wrong",
    ).toBeGreaterThanOrEqual(400);
    expect(
      controlCorpus.length,
      "the control corpus is not larger than the guarded set, which cannot be " +
        "right — it is a superset of it, so the wider walk has failed",
    ).toBeGreaterThan(files.length);

    const dead = FORBIDDEN.filter(
      ({ pattern }) =>
        !controlCorpus.some(
          (f) =>
            !f.path.endsWith(TARGET) &&
            specifiersOf(f.code).some((s) => pattern.test(s)),
        ),
    ).map(({ pattern, what }) => `${pattern} (${what})`);

    expect(
      dead,
      "These patterns match no import anywhere in the app, so they prove nothing " +
        "about the module they guard — a renamed package or a typo leaves a rule " +
        "that forbids a string nobody writes while permitting the real thing.\n\n" +
        "Fix the pattern against what the app actually imports today.",
    ).toEqual([]);
  });
});

describe("the band reaches a screen, and the kind list has no second copy", () => {
  it("has `qualify` itself called by a component or a page", () => {
    /* The "written, documented, and never called" shape, which this repo finds
       repeatedly. A pure module with a thorough suite and no consumer is the
       easiest version to ship: everything green, nothing rendered.

       IT ASKS FOR `qualify` BY NAME, AND THE FIRST VERSION DID NOT — it asked
       whether anything imported the MODULE, which is a different and much
       weaker question. Caught by mutation: every reference was stripped from
       all three real consumers and this test stayed GREEN, because
       `SalesSignalFields` imports `SALES_SIGNAL_KINDS` from here to build a
       dropdown. So the band could be orphaned while the kind list kept the
       module "used", and nothing would have said so.

       That is this repo's own recurring shape once more — nothing is ever
       missing from a question nobody is asking — arriving inside a census
       written to prevent it. */
    const callers = files
      .filter(
        (f) => f.path.startsWith("components/") || f.path.startsWith("app/"),
      )
      .filter((f) => !f.path.includes(".test."))
      .filter(
        (f) =>
          specifiersOf(f.code).some((spec) =>
            spec.includes("sales-qualification"),
          ) && /\bqualify\b/.test(f.code),
      )
      .map((f) => f.path);

    expect(
      callers,
      "No component or page calls `qualify`. The band is computed by nobody and " +
        "rendered nowhere, and every unit test in sales-qualification.test.ts stays " +
        "green while that is true.\n\nImporting the module for its KIND LIST does " +
        "not count — that is what made the first version of this check pass on an " +
        "orphaned band.",
    ).not.toEqual([]);
  });

  it("is the only list of signal kinds in the app", () => {
    /* THE OTHER QUESTION, per CLAUDE.md's #526 entry: a completeness test
       proves the shared list has every member and CANNOT see a consumer that
       has stopped reading it. Nothing is ever missing from a list nobody
       imports.

       The discriminator is free, and it is the same one #526 used: a kind
       written as a STRING LITERAL is the signature of a hand-rolled copy,
       because every legitimate consumer uses these names as object KEYS
       (`SIGNAL_KIND_LABELS`, `BAND_STYLE`), which are identifiers and do not
       match a quoted pattern. */
    const quoted = /["']GC_RELATIONSHIP["']/;
    const copies = files
      .filter((f) => f.path !== TARGET && !f.path.includes(".test."))
      .filter((f) => quoted.test(f.code))
      .map((f) => f.path);

    expect(
      copies,
      "These files spell a signal kind as a string literal, which is how a second " +
        `copy of the list starts. Import it from ${TARGET} instead — a label map ` +
        "keyed by the kind needs no quotes, and a copy is the defect #526 cost a " +
        "wrong bid total.",
    ).toEqual([]);

    /* And the control, because the pattern above could stop matching: the
       canonical module itself must contain it. A regex that matches nothing
       passes every assertion made from it. */
    expect(
      quoted.test(target!.code),
      "the pattern no longer matches the canonical list itself, so it proves " +
        "nothing about copies — the kind was renamed and this check is dead",
    ).toBe(true);
  });
});
