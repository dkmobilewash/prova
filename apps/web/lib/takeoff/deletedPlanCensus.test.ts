import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ── A DELETED PLAN STAYS OUT OF SIGHT (Diego, 2026-11-26; coordination/plan-delete-undo.md U2-U3) ──
 *
 * A deleted plan is kept for its 10-minute Undo with `jobId` NULL, so every read scoped by job already skips it. This
 * fails the build on a read that is NOT: a TakeoffPlan model call, or a `plan: { … }` relation filter, whose argument
 * names neither `jobId` nor `deletedAt`. A read that must see deleted plans (Undo, the purge) is on the allowlist with
 * its reason. The set scanned is asserted against a floor, so a pattern that stopped matching goes red, not green.
 */
const WEB = fileURLToPath(new URL("../..", import.meta.url));
const ROOTS = ["lib", "app", "components"];
const SKIP = /\.(test|dbtest|eval|spec)\.tsx?$|\/e2e\//;

/** Comments out, strings kept: a comment quoting `takeoffPlan.findMany(` is not a read. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The text from `open` (a `(` or `{`) to its match, or "" when unbalanced (which then fails rather than passes). */
export function balanced(src: string, open: number): string {
  const pair: Record<string, string> = { "(": ")", "{": "}" };
  const close = pair[src[open]!];
  if (close === undefined) return "";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === src[open]) depth += 1;
    else if (src[i] === close && --depth === 0) return src.slice(open, i + 1);
  }
  return "";
}

const MODEL = /\btakeoffPlan\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy|update|updateMany)\(/g;
const RELATION = /\bplan:\s*\{/g;
const SCOPED = /\b(jobId|deletedAt)\b/;

/** Reads that must see a deleted plan, with why. Keyed `file :: a fragment of the read`. */
const ALLOWED: Record<string, string> = {
  "lib/plan-ingest/walls.ts :: select: { projectPages: true, planOfWorkPages: true }": "pipeline-internal read by id; the runner never starts a deleted plan (claim.ts filters deletedAt)",
  "lib/takeoff/workspaceLoad.ts :: fileName: plan.fileName": "a value object being returned, not a filter",
};

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(name) && !SKIP.test(full)) yield full;
  }
}

type Site = { file: string; line: number; kind: "model" | "relation"; text: string };
function sites(): Site[] {
  const out: Site[] = [];
  for (const root of ROOTS) {
    for (const full of files(join(WEB, root))) {
      const src = stripComments(readFileSync(full, "utf8"));
      const file = relative(WEB, full);
      for (const [re, kind] of [[MODEL, "model"], [RELATION, "relation"]] as const) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
          const open = m.index + m[0].length - 1;
          const text = balanced(src, open);
          // A `plan: { select: … }` is a selection, not a filter.
          if (kind === "relation" && /^\{\s*(select|include)\s*:/.test(text)) continue;
          if (kind === "relation" && /orderBy:\s*\{\s*$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
          out.push({ file, line: src.slice(0, m.index).split("\n").length, kind, text });
        }
      }
    }
  }
  return out;
}

describe("U3: every plan read not scoped by job skips deleted plans", () => {
  const found = sites();
  it("scans the reads it is meant to (the set cannot shrink to nothing)", () => {
    expect(found.filter((s) => s.kind === "model").length).toBeGreaterThanOrEqual(40);
    expect(found.filter((s) => s.kind === "relation").length).toBeGreaterThanOrEqual(30);
  });
  it("names jobId or deletedAt, or is allowed with a reason", () => {
    const allowed = (s: Site) => Object.keys(ALLOWED).some((key) => {
      const [file, fragment] = key.split(" :: ");
      return s.file === file && s.text.includes(fragment!);
    });
    const open = found.filter((s) => (s.text === "" || !SCOPED.test(s.text)) && !allowed(s)).map((s) => `${s.file}:${s.line} (${s.kind}) ${s.text.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(open).toEqual([]);
  });
});

describe("the scanner, on fixtures", () => {
  it("balances nested braces and parens, and fails an unbalanced one", () => {
    expect(balanced("f({ a: { b: 1 } }) x", 1)).toBe("({ a: { b: 1 } })");
    expect(balanced("plan: { jobId: { in: [1] } } y", 6)).toBe("{ jobId: { in: [1] } }");
    expect(balanced("f({ a: 1", 1)).toBe("");
  });
  it("does not count a read written in a comment", () => {
    expect(stripComments("// prisma.takeoffPlan.findMany({ where: {} })\nconst x = 1;")).not.toMatch(MODEL);
  });
});
