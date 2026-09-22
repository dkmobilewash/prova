import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NOTHING THE BROWSER LOADS MAY REACH `@prova/db`.
 *
 * The mirror image of `client-boundary.test.ts`, which guards the other
 * direction (a server module importing a value out of a "use client" file).
 * This one is the direction that fired on 2026-09-21.
 *
 * `PrismaClient` throws the moment it is evaluated outside Node —
 * "PrismaClient is unable to run in this browser environment". A "use client"
 * module that imports it, at any depth, therefore takes the whole route down
 * DURING HYDRATION: the server render is perfect, the HTML arrives, and then
 * the client bundle blows up and the error boundary replaces the page with
 * "This page didn't load". Nothing appears in the server log, because nothing
 * went wrong on the server.
 *
 * Two pure constants did it, both living in modules that also talk to the
 * database — `TRADE_SCOPES` in `lib/actions/shared.ts` and
 * `RESPONSIBLE_PARTIES` in `lib/delays-core.ts`. Seven routes shipped
 * PrismaClient to the browser: /punch-lists, /settings, /settings/import,
 * /settings/integrations, /team, /catalog and /jobs/[id]/estimate. Typecheck,
 * lint and `next build` were all green — a browser bundle carrying a module
 * that throws when evaluated is a perfectly valid build.
 *
 * WHY A WHOLE-GRAPH WALK AND NOT A GREP. Not one of the offending client
 * components mentioned `@prova/db`. `PunchItemFields.tsx` imported a label
 * array; four files down that chain was `import { prisma }`. Only the
 * transitive closure can see it, which is exactly what the bundler computes.
 *
 * TWO THINGS THIS FILE ASSERTS ABOUT ITSELF, per CLAUDE.md's two census
 * scars. It asserts its SCOPE — the roots come from `tsconfig.json`'s `@/*`
 * path mapping, the same source the compiler resolves `@/` with, so a walk
 * that cannot see part of the app fails instead of quietly finding nothing
 * ("nothing is ever missing from a directory you do not walk"). And it
 * asserts its MACHINERY on a synthetic graph that contains a known
 * violation, so a matcher that has stopped matching fails loudly rather than
 * reporting a clean app.
 */

// ---------------------------------------------------------------- scope
/** The roots the compiler itself resolves `@/` against. Derived, not typed
 * out here: a second alias added to tsconfig extends this census with no
 * edit to this file, and an alias that resolves to nothing fails below. */
function aliasRoots(): string[] {
  const tsconfigPath = path.resolve(__dirname, "../tsconfig.json");
  const raw = readFileSync(tsconfigPath, "utf8").replace(/^\s*\/\/.*$/gm, "");
  const paths = JSON.parse(raw).compilerOptions?.paths ?? {};
  const globs: string[] = Object.values(paths).flat() as string[];
  return [...new Set(globs.map((g) => path.resolve(path.dirname(tsconfigPath), g.replace(/\/?\*$/, ""))))];
}

const SKIP = new Set(["node_modules", ".next", ".turbo", ".git", "e2e", "public"]);
const IS_TEST = /\.(test|dbtest|spec)\.tsx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ((full.endsWith(".ts") || full.endsWith(".tsx")) && !IS_TEST.test(full)) out.push(full);
  }
  return out;
}

// ------------------------------------------------------------- parsing
/** Strip block comments and whole-line `//` comments, so a directive or an
 * import quoted inside prose is not mistaken for code. Deliberately does NOT
 * strip trailing `//`, which would eat a `https://` inside a string. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** The directive, as the first statement, past any leading comments. */
const USE_CLIENT = /^\s*["']use client["']/;
const USE_SERVER = /^\s*["']use server["']/;

/**
 * Every module specifier this file imports or re-exports AS A VALUE.
 *
 * `import type { X } from "m"` is erased before bundling and is skipped.
 * `import { a, type B } from "m"` is NOT: an inline `type` specifier still
 * loads the module at runtime, and that distinction is not academic — it is
 * how `ChangeOrders.tsx` was pulling prisma in. `[^;]*?` keeps a match inside
 * one statement while still spanning a multi-line brace list.
 */
function valueImports(source: string): string[] {
  const text = stripComments(source);
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(?:import|export)\b([^;]*?)\bfrom[ \t]*["']([^"']+)["']/g)) {
    if (/^\s*type\b/.test(m[1])) continue;
    out.push(m[2]);
  }
  for (const m of text.matchAll(/(?:^|\n)[ \t]*import[ \t]*["']([^"']+)["']/g)) out.push(m[1]);
  return out;
}

const isDb = (spec: string) => spec === "@prova/db" || spec.startsWith("@prova/db/") || spec === "@prisma/client";

// ------------------------------------------------------------- the walk
type Graph = {
  sources: Map<string, string>;
  resolve: (spec: string, from: string) => string | null;
};

/** Every client module from which `@prova/db` is reachable, with the chain. */
function offences(graph: Graph): string[] {
  const { sources, resolve } = graph;
  const isClient = (f: string) => USE_CLIENT.test(stripComments(sources.get(f) ?? "").trimStart());
  // A "use server" module is a real boundary: the bundler replaces it with a
  // client reference, so its own imports never reach the browser.
  const isServer = (f: string) => USE_SERVER.test(stripComments(sources.get(f) ?? "").trimStart());

  const found: string[] = [];
  for (const entry of [...sources.keys()].filter(isClient)) {
    const seen = new Set([entry]);
    const queue: [string, string[]][] = [[entry, [entry]]];
    let hit: string[] | null = null;
    while (queue.length && !hit) {
      const [file, trail] = queue.shift()!;
      for (const spec of valueImports(sources.get(file) ?? "")) {
        if (isDb(spec)) { hit = [...trail, spec]; break; }
        const target = resolve(spec, file);
        if (!target || !sources.has(target) || seen.has(target) || isServer(target)) continue;
        seen.add(target);
        queue.push([target, [...trail, target]]);
      }
    }
    if (hit) found.push(hit.join("\n      -> "));
  }
  return found;
}

// ------------------------------------------------------------ the suite
describe("no client module reaches PrismaClient", () => {
  const roots = aliasRoots();
  const files = roots.flatMap((r) => walk(r));
  const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

  const resolve = (spec: string, from: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(roots[0], spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else return null;
    for (const c of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
      if (existsSync(c)) return c;
    }
    return null;
  };

  it("walks every root the compiler resolves '@/' against", () => {
    // The scope assertion. A glob that resolves to nothing would otherwise
    // shrink this census in silence, and an empty set never has an offender.
    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) expect(existsSync(root), `${root} does not exist`).toBe(true);
    expect(files.length).toBeGreaterThan(300);
  });

  it("resolves the imports it walks, so the graph is not a set of islands", () => {
    // Without this, a resolver returning null for everything reports a clean
    // app in a few milliseconds.
    let resolved = 0;
    for (const [file, source] of sources) {
      for (const spec of valueImports(source)) if (resolve(spec, file)) resolved += 1;
    }
    expect(resolved).toBeGreaterThan(500);

    // Positive controls on the resolver's two forms, named rather than
    // counted. Deliberately modules that have nothing to do with the fix
    // this file shipped with: a control that only holds AFTER the fix would
    // fail on a mutation run for the wrong reason and hide whether the real
    // assertion below can still fire.
    const anyFile = path.join(roots[0], "lib/permissions.ts");
    expect(existsSync(anyFile), "lib/permissions.ts moved; pick another control").toBe(true);
    expect(resolve("@/lib/permissions", anyFile)).toBe(anyFile);
    expect(resolve("./permissions", anyFile)).toBe(anyFile);
  });

  it("reports a violation when there is one to report", () => {
    // The machinery, run against a graph built to fail. This is the answer to
    // "absence of a failure is not a pass": if the directive regex, the
    // import regex or the traversal stops working, THIS goes red while the
    // real app still looks clean.
    const fake = new Map([
      ["/x/Client.tsx", '"use client";\nimport { LABELS } from "./labels";\n'],
      ["/x/labels.ts", 'import { prisma } from "@prova/db";\nexport const LABELS = [];\n'],
      // A "use server" module in the chain must NOT be followed.
      ["/x/Safe.tsx", '"use client";\nimport { save } from "./action";\n'],
      ["/x/action.ts", '"use server";\nimport { prisma } from "@prova/db";\nexport async function save() {}\n'],
      // An erased type import must NOT count.
      ["/x/Typed.tsx", '"use client";\nimport type { Job } from "@prova/db";\n'],
      // An inline `type` specifier alongside a value one MUST count: the
      // module is still loaded at runtime. This is the ChangeOrders shape.
      ["/x/Inline.tsx", '"use client";\nimport { prisma, type Job } from "@prova/db";\n'],
    ]);
    const found = offences({
      sources: fake,
      resolve: (spec, from) => (spec.startsWith(".") ? path.resolve(path.dirname(from), spec) + ".ts" : null),
    });
    expect(found.map((f) => f.split("\n")[0]).sort()).toEqual(["/x/Client.tsx", "/x/Inline.tsx"]);
  });

  it("finds no client module in this app that reaches @prova/db", () => {
    const found = offences({ sources, resolve });
    const pretty = found.map((chain) => "  " + chain.replaceAll(roots[0] + "/", "")).join("\n\n");
    expect(
      found,
      found.length === 0
        ? ""
        : `\n${found.length} client module(s) pull PrismaClient into the browser bundle.\n` +
            "Each of these routes renders \"This page didn't load\" on hydration:\n\n" +
            pretty +
            "\n\nMove whatever is needed into a module that does not import @prova/db " +
            "(lib/trade-scopes.ts and lib/delay-options.ts are the two that exist for this), " +
            "or make the import `import type`.\n",
    ).toEqual([]);
  });
});
