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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
