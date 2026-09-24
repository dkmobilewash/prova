/**
 * Every sequence counter is bumped inside a transaction, and no counter
 * model exists that nothing bumps.
 *
 * WHY THIS FILE RATHER THAN THE SENTENCE IN CLAUDE.md. That file states
 * the rule and, since 2026-09-09, carries two shell commands to re-derive
 * its own roll-call rather than be trusted. Both printed 8 the day they
 * were written. #228 added `ContractDocumentVersionCounter` the next day
 * and both print 9 — the number in the prose was stale within 24 hours,
 * exactly as its own paragraph predicted. A count in a document rots; a
 * count in a test fails.
 *
 * WHAT IT CHECKS, and each one is a defect this repo has actually shipped:
 *
 *   1. Every `model *Counter` is bumped through a TRANSACTION client.
 *      `#224` shipped invoice numbers as `max(n)+1` read outside any
 *      transaction, and two concurrent submits collided on
 *      `@@unique([jobId, number])` — a thrown Server Action message, which
 *      production redacts, on a document a GC is waiting for.
 *
 *   2. No counter is bumped on the bare client. A counter incremented by
 *      `prisma.xCounter.upsert` is not in the insert's transaction, so it
 *      is `max(n)+1` again wearing a counter's clothes.
 *
 *   3. No counter model exists that NOTHING bumps — this repo's
 *      "written, documented, and never called" shape, wearing a schema.
 *
 * WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it
 * goes: raw SQL, a nested write reaching a counter through another model,
 * and anything run against Neon by hand. It is a source scan.
 *
 * IT DOES NOT CHECK CLEANUP REGISTRATION. A per-job counter is also a
 * RESTRICT child of `Job` and must be deleted by the cleanup scripts —
 * #224 and #228 both missed that. `scratch-cleanup-order.test.ts` owns it,
 * derived from the migration SQL, and `billing.dbtest.ts` /
 * `contract-documents.dbtest.ts` prove it against a real database.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NUMBERED_TABLES } from "../../../packages/db/scripts/numbered-tables.mjs";

const libDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const schemaDir = join(repoRoot, "packages/db/prisma/schema");

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".turbo"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|dbtest)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Same shape as the other censuses here. A comment that quotes the pattern
 * it explains disarmed one of them once (#185), so comments never count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const schemaText = readdirSync(schemaDir)
  .filter((name) => name.endsWith(".prisma"))
  .map((name) => readFileSync(join(schemaDir, name), "utf8"))
  .join("\n");

const counterModels = [...schemaText.matchAll(/^model\s+(\w*Counter)\s*\{/gm)].map((m) => m[1]);

const sources = sourceFiles(libDir).map((full) => ({
  path: relative(repoRoot, full),
  source: stripComments(readFileSync(full, "utf8")),
}));

/** `tx.rfiCounter.upsert(` — the accessor, not the variable name, except
 * that the client identifier IS the point here: it has to be a transaction
 * handle rather than the bare `prisma`. */
const TX_BUMP = /\b(?!prisma\b)\w+\s*\.\s*(\w*Counter)\s*\.\s*upsert\s*\(/g;
const CLIENT_BUMP = /\bprisma\s*\.\s*(\w*Counter)\s*\.\s*(upsert|update|create)\s*\(/g;

function modelName(accessor: string) {
  return accessor.charAt(0).toUpperCase() + accessor.slice(1);
}

describe("the sequence counter census", () => {
  // THE SIZE CHECK COMES FIRST, and it is the reason the rest means
  // anything. scratch-cleanup-order.test.ts passed all thirteen of its
  // assertions while parsing 180 of 181 foreign keys, because a pattern
  // that matches nothing is never missing anything. Both sets are counted
  // against a literal that cannot drift with the pattern.
  it("parses every counter the schema declares — an empty question passes everything below", () => {
    const literal = (schemaText.match(/^model\s+\w*Counter\s*\{/gm) ?? []).length;
    expect(counterModels.length).toBe(literal);
    expect(counterModels.length).toBeGreaterThanOrEqual(9);
  });

  it("finds every counter bump the sources contain", () => {
    const parsed = sources.flatMap((f) => [...f.source.matchAll(TX_BUMP)]).length;
    const literal = sources.reduce(
      (n, f) => n + (f.source.match(/\w*Counter\s*\.\s*upsert\s*\(/g) ?? []).length,
      0,
    );
    expect(parsed).toBe(literal);
    expect(parsed).toBeGreaterThanOrEqual(9);
  });

  it("bumps every counter model through a transaction client", () => {
    const bumped = new Set(
      sources.flatMap((f) => [...f.source.matchAll(TX_BUMP)].map((m) => modelName(m[1]))),
    );
    const unbumped = counterModels.filter((model) => !bumped.has(model));
    expect(
      unbumped,
      `These counter models are declared and nothing increments them inside a transaction: ` +
        `${unbumped.join(", ")}. A counter nothing bumps is the "written, documented, and never ` +
        `called" shape wearing a schema; a counter bumped outside a transaction is max(n)+1 again.`,
    ).toEqual([]);
  });

  it("never bumps a counter on the bare prisma client, outside any transaction", () => {
    const offenders = sources.flatMap((f) =>
      [...f.source.matchAll(CLIENT_BUMP)].map((m) => `${f.path}: prisma.${m[1]}.${m[2]}(`),
    );
    expect(
      offenders,
      `A counter incremented outside a transaction is not atomic with the insert it numbers, ` +
        `which is the #224 defect exactly: ${offenders.join("; ")}`,
    ).toEqual([]);
  });
});

/**
 * Which table each counter numbers, and the helper that must issue that
 * number. Issue #279.
 *
 * THE CENSUS ABOVE CANNOT SEE THE DEFECT THIS CATCHES, and was green
 * throughout it. It asks whether each counter is bumped, and inside a
 * transaction. `ContractDocumentVersionCounter` passed both: one of the two
 * writers of `ContractDocument` bumped it, correctly, in a transaction. The
 * other never touched it and computed `MAX(versionNumber) + 1` instead, so
 * the counter and the table disagreed and the counter-issued insert
 * collided on `@@unique([jobId, versionNumber])` — deterministically, on
 * the ordinary order of events, not as a race.
 *
 * So this asks the question from the other end: does every writer of a
 * NUMBERED TABLE go through the counter? "Is the counter used" and "is the
 * counter the only source of the number" are different claims, and only the
 * second one is the rule.
 *
 * The map is not derived, because nothing in the schema says which table a
 * counter numbers — `SafetyCaseCounter` numbers `SafetyIncident`, and no
 * naming rule gets you there. It does not need to be derived to be safe:
 * the first test pins its keys to the schema's own counter list, so a new
 * counter FAILS until somebody writes down what it numbers. That is the
 * point rather than a formality — the declaring is the review.
 *
 * IT MOVED to `packages/db/scripts/numbered-tables.mjs` and is imported at
 * the top of this file. Not a tidy-up: the third census below scans plain
 * `.mjs` scripts in `packages/db`, and the database test that exercises the
 * demo seed needs the same map. Neither can import a file full of
 * `describe()` without running this suite inside theirs.
 */

/** `tx.contractDocument.create(` but never
 * `tx.contractDocumentVersionCounter.upsert(` — the negative lookahead is
 * what keeps a counter's own accessor from matching the table it numbers,
 * since one is a prefix of the other. */
function insertPattern(accessor: string) {
  return new RegExp(`\\.\\s*${accessor}(?![A-Za-z0-9_])\\s*\\.\\s*(create|createMany)\\s*\\(`, "g");
}

describe("the numbered-table census — every writer goes through the counter", () => {
  it("declares what every counter in the schema numbers", () => {
    // A new counter with no entry here fails, rather than silently being
    // exempt from every assertion below. Same reason the size checks above
    // come first: an unasked question passes.
    expect([...Object.keys(NUMBERED_TABLES)].sort()).toEqual([...counterModels].sort());
  });

  it("issues the number from the counter in every file that inserts a numbered row", () => {
    const offenders: string[] = [];
    for (const [counter, { accessor, helper }] of Object.entries(NUMBERED_TABLES)) {
      for (const file of sources) {
        if (!insertPattern(accessor).test(file.source)) continue;
        if (file.source.includes(helper)) continue;
        offenders.push(`${file.path} inserts ${accessor} without calling ${helper} (${counter})`);
      }
    }
    expect(
      offenders,
      `A writer of a numbered table that never calls its counter's issuing helper is computing ` +
        `the number itself, which is issue #279 exactly: ${offenders.join("; ")}`,
    ).toEqual([]);
  });

  it("issues a number at least as often as it inserts a numbered row", () => {
    // Catches the case the file-level check above cannot: a file that calls
    // the helper once and then inserts twice, the second insert carrying a
    // number from somewhere else.
    const offenders: string[] = [];
    for (const { accessor, helper } of Object.values(NUMBERED_TABLES)) {
      const inserts = sources.reduce(
        (n, f) => n + (f.source.match(insertPattern(accessor)) ?? []).length,
        0,
      );
      const issues = sources.reduce(
        (n, f) =>
          n + (f.source.match(new RegExp(`\\b${helper}\\s*\\(`, "g")) ?? []).length,
        0,
      );
      if (issues < inserts) {
        offenders.push(`${accessor}: ${inserts} insert(s) but only ${issues} call(s) to ${helper}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * THE SAME QUESTION, ASKED WHERE THE ANSWER COULD ACTUALLY BE — every file
 * in the repo that inserts a numbered row, not just the TypeScript under
 * `apps/web/lib`.
 *
 * WHAT WENT WRONG, and it is CLAUDE.md's `theme-contrast` scar arriving
 * again from the same side. `packages/db/scripts/seed-demo.mjs` wrote three
 * `Invoice` rows (#1, #1, #2) and two `ChangeOrder` rows (#1, #2) and
 * created NEITHER counter. So `issueInvoiceNumber` upserted `lastNumber: 1`,
 * the insert collided with the seeded #1 on `@@unique([jobId, number])`, and
 * because the bump and the insert share one `$transaction` the counter
 * ROLLED BACK with it — every retry failed identically, forever. "Create
 * invoice" was permanently dead on every demo-seeded job, which is to say on
 * every Vercel preview and every demo a tester was shown.
 *
 * The two censuses above exist to stop exactly that and were GREEN the whole
 * time. Their patterns were fine. `sourceFiles(libDir)` walks `apps/web/lib`
 * and takes `.tsx?` only, so a `.mjs` script in `packages/db` was never a
 * candidate — and **nothing is ever missing from a directory you do not
 * walk.** A size assertion cannot help: it answers "did the pattern stop
 * matching", and the pattern matched plenty.
 *
 * Two live files were outside that walk and happened to be CORRECT, which is
 * the more unsettling half: the v1 API routes for material orders and
 * incidents bump their counters inline, well outside `apps/web/lib`. A third
 * route that forgot would have been just as invisible.
 *
 * WHAT IT REASONS ABOUT: every tracked source file that inserts a row into a
 * counter-numbered table must, in that same file, make the counter agree —
 * either by calling the issuing helper or by bumping the counter itself. The
 * seed does the second; app actions do the first.
 *
 * SCOPE IS GIT'S, NOT A LIST WRITTEN HERE. `git ls-files` is the repo's own
 * definition of what is in the repo, and it cannot drift with this file's
 * patterns — which is the whole property the directory list lacked. It also
 * excludes `node_modules`, `.next` and the agent worktrees under `.claude`
 * for free, and it fails loudly rather than silently returning fewer files.
 *
 * WHAT IT THEREFORE CANNOT CATCH, said plainly so nobody trusts it further
 * than it goes:
 *
 *   - TEST FIXTURES ARE EXCLUDED. A `.dbtest.ts` inserts numbered rows with
 *     literal numbers on purpose, to build the state under test; requiring a
 *     counter there would make the fixtures lie about what they are setting
 *     up.
 *   - It is file-level. A script that seeds a counter for job A and inserts
 *     rows for job B passes this and is still broken. That claim is only
 *     provable against a database, and `seed-demo-counters.dbtest.ts` runs
 *     the real seed and proves it per job.
 *   - Raw SQL, a nested write reaching a numbered table through a parent,
 *     and anything run against Neon by hand. It is a source scan.
 */

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
/** Only the two suffixes that mean "fixture". `.eval.ts` is NOT one of them:
 * the narrow census above scans those files, and a wider scan that quietly
 * dropped them would be narrower in one direction while claiming to be
 * wider — which the containment check below exists to refuse. */
const FIXTURE = /\.(test|dbtest)\.(ts|tsx|mts)$/;

/**
 * Every source file the repo tracks. Shelling out to git is the point rather
 * than a shortcut: the alternative is a directory list maintained by hand,
 * and a directory list maintained by hand is the defect this section exists
 * for. `-z` because a path may contain anything but NUL.
 */
function trackedSourcePaths(): string[] {
  // `--cached --others --exclude-standard` — committed files AND the ones
  // that are merely written but not staged yet, minus everything ignored.
  // `--cached` alone was the first version and it was wrong in the direction
  // that matters here: a brand new writer is untracked until somebody runs
  // `git add`, so a bare `ls-files` would have let exactly the kind of file
  // this census is for sit outside it until after the review. Found by
  // another agent creating a file in this checkout mid-run.
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((p) => SOURCE_EXT.test(p) && !FIXTURE.test(p));
}

const tracked = trackedSourcePaths();
const repoSources = tracked.map((path) => ({
  path,
  source: stripComments(readFileSync(join(repoRoot, path), "utf8")),
}));

/** The accessors, longest first, so `contractDocument` cannot be claimed by a
 * shorter name that prefixes it before the lookahead gets a chance. */
const ACCESSORS = Object.entries(NUMBERED_TABLES).sort(
  (a, b) => b[1].accessor.length - a[1].accessor.length,
);

/** Which numbered tables a file inserts into, by accessor. */
function insertedAccessors(source: string): string[] {
  return ACCESSORS.filter(([, t]) => insertPattern(t.accessor).test(source)).map(
    ([, t]) => t.accessor,
  );
}

/**
 * Files this census MUST be able to see, and what it must see in them.
 *
 * A PINNED MEMBER OF THE SET RATHER THAN A COUNT OF IT, deliberately. The
 * failure being guarded against is a scanner that sees NOTHING in a whole
 * directory, and a count of an empty set looks perfectly healthy — every
 * size assertion in this file would have passed throughout the defect above.
 * Naming a file the scan is known to contain is the one check that goes red
 * when the walk narrows, the extension list drops `.mjs`, or the insert
 * pattern stops matching.
 *
 * `seed-demo.mjs` is the pin because it is the file that was invisible. If
 * you add a numbered family to the seed, this fails and the fix is to add
 * the accessor here AND seed its counter — which is the review, not a chore.
 */
const MUST_SEE: Record<string, string[]> = {
  "packages/db/scripts/seed-demo.mjs": [
    "backcharge",
    "changeOrder",
    "closeoutSubmission",
    "invoice",
    "materialOrder",
    "rfi",
    "safetyIncident",
    "submittal",
  ],
};

describe("the numbered-table census, repo-wide — scope pinned to git", () => {
  it("asks git what is in the repo, and git answers", () => {
    // An empty or tiny answer means git failed, or this ran somewhere that
    // is not a checkout. Either way the rest of this describe would pass
    // vacuously, which is the one outcome worth failing loudly on.
    expect(tracked.length).toBeGreaterThan(500);
  });

  it("walks every extension a database writer is written in here", () => {
    // The defect was an extension filter, not a pattern. `.mjs` is the one
    // that was missing; `.ts` and `.tsx` prove the filter has not inverted.
    for (const ext of [".mjs", ".ts", ".tsx"]) {
      expect(
        tracked.some((p) => p.endsWith(ext)),
        `no ${ext} file in scope — the walk has narrowed`,
      ).toBe(true);
    }
  });

  it("is strictly wider than the apps/web/lib census above", () => {
    // Anti-narrowing, stated as containment rather than as two numbers: a
    // widened scan that somehow drops a file the narrow one had is a
    // regression no count would show.
    const wide = new Set(tracked);
    const missing = sources.map((f) => f.path).filter((p) => !wide.has(p));
    expect(missing, `dropped by the wider walk: ${missing.join(", ")}`).toEqual([]);
  });

  it("sees the numbered inserts in the file that was invisible", () => {
    for (const [path, expected] of Object.entries(MUST_SEE)) {
      const file = repoSources.find((f) => f.path === path);
      expect(file, `${path} is not in scope at all`).toBeDefined();
      expect(insertedAccessors(file!.source).sort()).toEqual([...expected].sort());
    }
  });

  it("parses the same number of inserts as a deliberately dumber scanner", () => {
    // The size check the entry above says cannot save you on its own — kept
    // because it catches the OTHER failure, a pattern that silently stops
    // matching a syntax somebody starts writing. The dumb scanner knows
    // nothing about accessors: it finds every `.x.create(` and then filters.
    const known = new Set(Object.values(NUMBERED_TABLES).map((t) => t.accessor));
    let strict = 0;
    let dumb = 0;
    for (const file of repoSources) {
      for (const [, t] of ACCESSORS) {
        strict += (file.source.match(insertPattern(t.accessor)) ?? []).length;
      }
      for (const m of file.source.matchAll(
        /\.\s*([A-Za-z][A-Za-z0-9_]*)\s*\.\s*(?:create|createMany)\s*\(/g,
      )) {
        if (known.has(m[1])) dumb += 1;
      }
    }
    expect(strict).toBe(dumb);
    expect(strict).toBeGreaterThanOrEqual(15);
  });

  it("makes the counter agree in every file that inserts a numbered row", () => {
    const offenders: string[] = [];
    for (const file of repoSources) {
      for (const [counter, t] of ACCESSORS) {
        if (!insertPattern(t.accessor).test(file.source)) continue;
        // Either route is fine and both appear in this repo: app actions
        // call the issuing helper, the v1 API routes and the demo seed bump
        // the counter themselves. What is NOT fine is neither.
        if (file.source.includes(t.helper)) continue;
        if (new RegExp(`\\b${t.counterAccessor}\\s*\\.\\s*(upsert|update|create)\\s*\\(`).test(file.source)) {
          continue;
        }
        offenders.push(
          `${file.path} inserts ${t.accessor} rows but never calls ${t.helper} ` +
            `or writes ${t.counterAccessor} (${counter})`,
        );
      }
    }
    expect(
      offenders,
      `A file that writes numbered rows and leaves the counter behind hands the next real ` +
        `record a number that is already taken. In a seed that is permanent: the insert ` +
        `collides on the unique index and the counter bump rolls back with it, so every ` +
        `retry fails identically. ${offenders.join("; ")}`,
    ).toEqual([]);
  });
});

/**
 * THE TRANSACTION QUESTION, ASKED WHERE THE ANSWER COULD ACTUALLY BE.
 *
 * The `never bumps a counter on the bare prisma client` test at the top of
 * this file is the whole #224 guard, and it reads `sourceFiles(libDir)` —
 * `apps/web/lib`. The census directly above this one already records why
 * that is not enough, and then only widened the INSERT question:
 *
 *   > Two live files were outside that walk and happened to be CORRECT …
 *   > the v1 API routes for material orders and incidents bump their
 *   > counters inline, well outside `apps/web/lib`. A third route that
 *   > forgot would have been just as invisible.
 *
 * A route that bumped on the bare client rather than on `tx` was ALSO
 * invisible, and that is the #224 defect exactly rather than a variant of
 * it: two concurrent POSTs read the same counter, the second collides on
 * the unique index, and the message production shows is a digest. Proved by
 * mutation on 2026-09-24 — `tx.safetyCaseCounter.upsert` changed to
 * `prisma.safetyCaseCounter.upsert` in
 * `app/api/v1/jobs/[id]/incidents/route.ts`, and all thirteen assertions
 * above stayed green. That route is how the phone files an OSHA case.
 *
 * SCOPE IS `apps/`, TAKEN FROM THE GIT-DERIVED SET ABOVE rather than from a
 * directory list here, so it cannot drift with this file. Everything under
 * `apps/` is request-scoped runtime: a counter bump there is racing another
 * request by definition and must be inside the insert's transaction.
 *
 * `packages/db/scripts/**` is NOT in scope and that is deliberate, not an
 * exemption: `seed-demo.mjs` bumps `prisma.invoiceCounter` outside any
 * transaction on purpose — it is a one-shot script reconciling counters to
 * rows it has just written, with nothing to race, and the census above is
 * what holds it to doing that at all. Scoping by "is this request-scoped"
 * rather than listing a path keeps that a rule instead of a hole.
 */
describe("the transaction question, repo-wide — every request-scoped bump is in a transaction", () => {
  const appSources = repoSources.filter((f) => f.path.startsWith("apps/"));

  it("sees the counter bumps that live outside apps/web/lib", () => {
    // SCOPE, pinned by naming members the set is known to contain rather
    // than by counting it: a count of a set that lost a whole directory
    // looks perfectly healthy, which is the mistake this block exists for.
    const paths = appSources.map((f) => f.path);
    for (const pinned of [
      "apps/web/app/api/v1/jobs/[id]/incidents/route.ts",
      "apps/web/app/api/v1/jobs/[id]/material-orders/route.ts",
      "apps/web/lib/billing/invoice-number.ts",
    ]) {
      expect(paths, `${pinned} is not in scope — the walk has narrowed`).toContain(pinned);
    }
    // SIZE, from a literal the bump patterns cannot shrink with.
    const literal = appSources.reduce(
      (n, f) => n + (f.source.match(/\w*Counter\s*\.\s*(?:upsert|update|create)\s*\(/g) ?? []).length,
      0,
    );
    const seen = appSources.reduce(
      (n, f) =>
        n +
        [...f.source.matchAll(TX_BUMP)].length +
        [...f.source.matchAll(CLIENT_BUMP)].length,
      0,
    );
    expect(seen).toBe(literal);
    expect(literal).toBeGreaterThanOrEqual(11);
  });

  it("never bumps a counter on the bare prisma client anywhere under apps/", () => {
    const offenders = appSources.flatMap((f) =>
      [...f.source.matchAll(CLIENT_BUMP)].map((m) => `${f.path}: prisma.${m[1]}.${m[2]}(`),
    );
    expect(
      offenders,
      `A counter incremented outside a transaction is not atomic with the insert it numbers, ` +
        `which is the #224 defect exactly — two concurrent requests read the same number and ` +
        `the second collides on the unique index, throwing a message production redacts. ` +
        `Take the transaction client: ${offenders.join("; ")}`,
    ).toEqual([]);
  });
});
