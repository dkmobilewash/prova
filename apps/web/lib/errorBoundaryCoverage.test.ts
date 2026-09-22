/**
 * Every layout and page under `app/` has an error boundary that can
 * actually catch it — and all three boundaries say the same useful thing.
 *
 * THE RULE THIS PINS. A Next.js `error.tsx` is rendered INSIDE the
 * `layout.tsx` of its own segment, so it catches the pages below it and
 * never that layout. A layout is therefore covered only by an `error.tsx`
 * in a STRICT ANCESTOR segment; the root layout is covered only by
 * `app/global-error.tsx`. For weeks `app/(app)/error.tsx` was the only
 * boundary in the app, and `app/(app)/layout.tsx` — `requireCompanyContext`,
 * the Company row, four queries, before any page renders — was the one
 * place it could not reach. On 2026-09-21 a brand-new owner's first screen
 * was Next's stock "Application error … Digest: 446730191", with the
 * preview hint that names that day's actual cause sitting one segment too
 * low to be shown.
 *
 * TWO INDEPENDENT SIZE CHECKS, per CLAUDE.md: a census that derives its
 * set has two failure modes, and only one of them looks like a failure.
 * The walk of `app/` is compared with `git ls-files`, so the walk cannot
 * quietly stop finding files; and the specific files this exists for are
 * named outright, so a renamed directory cannot shrink the set past them.
 *
 * The render tests are the other half: three boundaries exist, and each
 * one renders the SAME copy — the preview paragraph by environment, the
 * digest, the don't-resubmit line — so extending coverage did not fork the
 * message.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const appDir = resolve(fileURLToPath(new URL("../app", import.meta.url)));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name === "layout.tsx" || name === "page.tsx") out.push(full);
  }
  return out;
}

const files = walk(appDir).sort();
const layouts = files.filter((f) => f.endsWith(`${sep}layout.tsx`));
const pages = files.filter((f) => f.endsWith(`${sep}page.tsx`));
const rel = (f: string) => relative(repoRoot, f);

/** The same files, by git rather than by this file's own walk. */
function byGit(name: string): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", `apps/web/app/**/${name}`, `apps/web/app/${name}`],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return Array.from(new Set(out.split("\n").filter(Boolean))).sort();
}

/** Directories from `from` up to and including `app/`. */
function ancestorsInclusive(from: string): string[] {
  const dirs: string[] = [];
  let dir = from;
  for (;;) {
    dirs.push(dir);
    if (dir === appDir) break;
    dir = dirname(dir);
  }
  return dirs;
}

function hasErrorBoundary(dirs: string[]): boolean {
  return dirs.some((dir) => existsSync(join(dir, "error.tsx")));
}

describe("the census sees the same files git does", () => {
  it("finds every layout.tsx git knows about", () => {
    expect(layouts.map(rel)).toEqual(byGit("layout.tsx"));
  });

  it("finds every page.tsx git knows about", () => {
    expect(pages.map(rel)).toEqual(byGit("page.tsx"));
  });

  it("finds the two layouts this file exists for, by name", () => {
    expect(layouts.map(rel)).toContain("apps/web/app/layout.tsx");
    expect(layouts.map(rel)).toContain("apps/web/app/(app)/layout.tsx");
    expect(pages.map(rel)).toContain("apps/web/app/welcome/page.tsx");
  });
});

describe("every layout is covered by a boundary that can catch it", () => {
  it("the root layout has app/global-error.tsx — nothing else can catch it", () => {
    expect(existsSync(join(appDir, "global-error.tsx"))).toBe(true);
  });

  it.each(layouts.filter((f) => dirname(f) !== appDir).map((f) => [rel(f), f]))(
    "%s has an error.tsx in a STRICT ancestor segment",
    (_label, file) => {
      // Its own segment's error.tsx does not count: it renders inside this
      // very layout, which is the whole defect.
      const strictAncestors = ancestorsInclusive(dirname(dirname(file)));
      expect(hasErrorBoundary(strictAncestors)).toBe(true);
    },
  );
});

describe("every page is covered by a boundary", () => {
  it.each(pages.map((f) => [rel(f), f]))("%s has an error.tsx in its own or an ancestor segment", (_label, file) => {
    expect(hasErrorBoundary(ancestorsInclusive(dirname(file)))).toBe(true);
  });
});

/* ---------------------------------------------------------------------- */

type Boundary = (props: { error: Error & { digest?: string }; reset: () => void }) => React.JSX.Element;

const BOUNDARIES: [string, () => Promise<{ default: Boundary }>][] = [
  ["app/error.tsx", () => import("@/app/error")],
  ["app/(app)/error.tsx", () => import("@/app/(app)/error")],
  ["app/global-error.tsx", () => import("@/app/global-error")],
];

/** What a production failure looks like from the client: a redacted
 * message and a digest. The copy must not depend on the message. */
function productionError(digest = "446730191"): Error & { digest?: string } {
  const error: Error & { digest?: string } = new Error(
    "An error occurred in the Server Components render. The specific message is omitted in production builds",
  );
  error.digest = digest;
  return error;
}

async function renderBoundary(
  load: () => Promise<{ default: Boundary }>,
  error: Error & { digest?: string } = productionError(),
): Promise<string> {
  const { default: Boundary } = await load();
  return renderToStaticMarkup(createElement(Boundary, { error, reset: () => {} }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("all three boundaries render the same screen", () => {
  it.each(BOUNDARIES)("%s quotes the digest and says not to resubmit", async (_name, load) => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_ENV", "production");
    const html = await renderBoundary(load);
    expect(html).toContain("This page didn&#x27;t load");
    expect(html).toContain("446730191");
    expect(html).toContain("Saving twice is how duplicates get made");
    // Next's stock wording is what this replaces; none of it may leak.
    expect(html).not.toContain("Application error");
    expect(html).not.toContain("server-side exception");
  });

  it.each(BOUNDARIES)("%s tells a PREVIEW to run Migrate demo database when the error IS drift", async (_name, load) => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_ENV", "preview");
    const html = await renderBoundary(load, productionError("SCHEMA_DRIFT_P2022"));
    expect(html).toContain("this is the database, not the code");
    expect(html).toContain("Run the");
    expect(html).toContain("Migrate demo database");
    expect(html).toContain("SCHEMA_DRIFT_P2022");
  });

  it.each(BOUNDARIES)("%s does NOT prescribe a migration on a PREVIEW for any other error", async (_name, load) => {
    // A thousands comma typed into an Amount field produced this screen on
    // 2026-09-21 with the migration advice under it. The advice was the
    // wrong diagnosis with a confident face; it must not come back.
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_ENV", "preview");
    const html = await renderBoundary(load, productionError("422176148"));
    expect(html).not.toContain("this is the database, not the code");
    expect(html).not.toContain("Run the");
    // The workflow may be NAMED — to say it will not help — never prescribed.
    expect(html).toContain("will not fix");
    expect(html).toContain("422176148");
  });

  it.each(BOUNDARIES)("%s says nothing about the demo database on PRODUCTION", async (_name, load) => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_ENV", "production");
    const html = await renderBoundary(load);
    expect(html).not.toContain("Migrate demo database");
    expect(html).not.toContain("preview");
  });

  it.each(BOUNDARIES)("%s on PRODUCTION names the deploy window when the error IS drift", async (_name, load) => {
    // CLAUDE.md's #378 entry: migrate.yml lands in seconds while the old
    // build is still live, so a P2022 on production is a window measured in
    // minutes, not a bug to file. Say that, and say to reload.
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_ENV", "production");
    const html = await renderBoundary(load, productionError("SCHEMA_DRIFT_P2021"));
    expect(html).toContain("just updated");
    expect(html).toContain("couple of minutes");
    expect(html).not.toContain("Migrate demo database");
  });
});

/* ---------------------------------------------------------------------- */

describe("the drift marker in the Prisma client", () => {
  // Imported by path: `@prova/db`'s index constructs the client, and a
  // unit test has no database to construct it against.
  const load = () => import("../../../packages/db/src/schema-drift");

  it("stamps P2021 and P2022 with a SCHEMA_DRIFT digest and leaves the code", async () => {
    const { markSchemaDrift } = await load();
    for (const code of ["P2021", "P2022"]) {
      const err = Object.assign(new Error("redacted later"), { code }) as Error & { code: string; digest?: string };
      const out = markSchemaDrift(err);
      expect(out).toBe(err);
      expect(out.digest).toBe(`SCHEMA_DRIFT_${code}`);
      expect(out.code).toBe(code);
    }
  });

  it("leaves every other error exactly as it was", async () => {
    const { markSchemaDrift } = await load();
    const cases: unknown[] = [
      Object.assign(new Error("dup"), { code: "P2002" }),
      Object.assign(new Error("fk"), { code: "P2003" }),
      new Error("Amount must be a number"),
      new TypeError("network error"),
      "a string",
      null,
      undefined,
      42,
    ];
    for (const err of cases) {
      const before = JSON.stringify(err instanceof Error ? { ...err, message: err.message } : err);
      const out = markSchemaDrift(err);
      expect(out).toBe(err);
      expect((out as { digest?: unknown } | null)?.digest).toBeUndefined();
      expect(JSON.stringify(out instanceof Error ? { ...out, message: out.message } : out)).toBe(before);
    }
  });

  it("respects a digest that is already set — Next's own rule", async () => {
    const { markSchemaDrift } = await load();
    const err = Object.assign(new Error("x"), { code: "P2022", digest: "NEXT_REDIRECT;replace;/x;307;" });
    expect(markSchemaDrift(err).digest).toBe("NEXT_REDIRECT;replace;/x;307;");
  });

  it("the server prefix and the browser prefix are one string, in two files", async () => {
    // Two literals on purpose (the browser file must not import the Prisma
    // client). This is the check that keeps them one.
    const server = await load();
    const browser = await import("@/lib/schema-drift");
    expect(browser.SCHEMA_DRIFT_DIGEST_PREFIX).toBe(server.SCHEMA_DRIFT_DIGEST_PREFIX);
    expect(browser.isSchemaDriftDigest(`${server.SCHEMA_DRIFT_DIGEST_PREFIX}P2022`)).toBe(true);
    expect(browser.isSchemaDriftDigest("446730191")).toBe(false);
    expect(browser.isSchemaDriftDigest(undefined)).toBe(false);
  });

  it("nothing calls the two members an extended client drops ($on, $use) — the cast in index.ts depends on it", () => {
    // index.ts types the extended client as a plain PrismaClient so twenty
    // `tx: Prisma.TransactionClient` call sites keep typechecking. That is
    // sound only while nothing uses `$on` or `$use`, which `$extends`
    // removes at runtime; a call to either would typecheck and then throw.
    let out = "";
    try {
      out = execFileSync("git", ["grep", "--untracked", "-nE", "\\.\\$(on|use)\\(", "--", "apps", "packages"], {
        cwd: repoRoot,
        encoding: "utf8",
      });
    } catch {
      out = ""; // git grep exits 1 on no match, which is the pass
    }
    const offenders = out
      .split("\n")
      .filter(Boolean)
      // This test's own text, and comments that NAME the members, are not calls.
      .filter((line) => !line.startsWith("apps/web/lib/errorBoundaryCoverage.test.ts"))
      .filter((line) => !/^\S+:\d+:\s*(\/\/|\*|\/\*)/.test(line));
    expect(offenders).toEqual([]);
  });

  it("the client actually installs the hook — the marker is called, not just written", () => {
    // "Written, documented, and never called" is a recurring shape here.
    // The index is not importable in a unit test (it constructs the
    // client), so read it: the hook must reference markSchemaDrift inside
    // a $extends query block.
    const source = readFileSync(resolve(repoRoot, "packages/db/src/index.ts"), "utf8");
    expect(source).toContain('from "./schema-drift"');
    expect(source).toMatch(/\$extends\(\{[\s\S]*query:[\s\S]*\$allOperations[\s\S]*markSchemaDrift\(/);
  });
});

describe("global-error stands on its own", () => {
  it("renders <html> and <body>, because no layout is left to provide them", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_ENV", "production");
    const html = await renderBoundary(BOUNDARIES[2][1]);
    expect(html).toMatch(/^<html/);
    expect(html).toContain("<body");
  });
});
