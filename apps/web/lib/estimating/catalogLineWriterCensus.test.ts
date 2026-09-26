import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY WRITER OF A CATALOG-SOURCED LINE CARRIES THE PRODUCTION RATE.
 *
 * THE DEFECT THIS IS BUILT FROM, and it was live in the branch that added
 * this file. `catalogLineFields` exists because two writers of catalog-sourced
 * `JobLineItem` rows would drift, and its own docstring says so. By the time
 * #514 added `LineItemCatalogEntry.productionRate` there were FOUR writers,
 * only one of which goes through that function:
 *
 *   - `catalog-line.ts`   — `catalogLineFields`, the shared mapping
 *   - `draft-lines.ts`    — the AI draft, which falls back to the model's own
 *                           values when no entry matched, so its mapping is
 *                           genuinely different rather than a copy
 *   - `wall-schedule.ts`  — `syncWallScheduleLines`, which builds its own
 *                           `data` literal and writes the largest block of
 *                           labor on a framing bid
 *
 * Three files, three hand-written mappings. Adding the rate to the shared one
 * and to the draft would have left wall-schedule lines — a wall type's whole
 * board, stud and track take-off — outside the actual-productivity back-check
 * while every hand-typed line was inside it, with typecheck, lint and the
 * whole suite green, because a field you do not write is not an error.
 * `wall-schedule.ts` was found by grep, not by any check.
 *
 * WHAT IT ASSERTS. The set of files that write `sourceCatalogEntryId` into a
 * row is derived from the tree, pinned against a literal, and each one is
 * required to mention `productionRate`. A fourth writer fails the FIRST
 * assertion by name, before the second one can quietly not apply to it.
 *
 * WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes.
 * It is a source scan, so it proves the identifier is PRESENT in the file, not
 * that the value written is right, not that it is in the same object literal,
 * and not that it is the correct rate for that writer. `catalog-line.test.ts`
 * is where the values are pinned. This file answers the question that one
 * cannot: "is there a writer nobody remembered".
 *
 * HOW IT KEEPS ITSELF HONEST, because a deriving check has two failure modes
 * and only one of them looks like a failure (CLAUDE.md):
 *
 *   - SCOPE, to `git ls-files`. Nothing is ever missing from a directory you
 *     do not walk — the `theme-contrast.test.ts` scar, where the pattern was
 *     fine, the size assertion was fine, and the one offending file in the
 *     repo was not under the scanned root. The listing is asserted non-empty
 *     and asserted to contain the three writers by name, so a walk that
 *     resolved to nothing fails loudly instead of finding no offenders.
 *   - SIZE, to a `git grep -c` count run by git over the raw bytes, sharing
 *     nothing with the filter below. A filter that silently stopped matching
 *     would otherwise pass every assertion after it — the
 *     `scratch-cleanup-order.test.ts` scar, 180 foreign keys parsed out of
 *     181 with thirteen tests green.
 *   - ONE BLIND SPOT IT KEEPS, named rather than fixed: `git ls-files` lists
 *     TRACKED files, so a brand-new writer that has not been `git add`ed yet
 *     is invisible to this check on the laptop that is writing it. It becomes
 *     visible the moment it is staged, and it is always visible in CI, which is
 *     where the assertion has to hold. `hoursRenderCensus.test.ts` makes the
 *     same trade for the same reason — a directory walk sees the untracked file
 *     and in exchange cannot see a root nobody added to it, and missing a ROOT
 *     is the failure that has actually happened here (theme-contrast).
 *   - COMMENTS NEVER COUNT. Four files mention `sourceCatalogEntryId` only in
 *     prose, including this one, and a census that counted comments would
 *     report seven writers and be wrong in the direction that looks safe.
 *     #185 was disarmed by a comment quoting the pattern looking for it.
 */

const WEB_ROOT = resolve(__dirname, "..", "..");
const REPO_ROOT = resolve(WEB_ROOT, "..", "..");

/** Git is the scope. A directory walk can miss a root; `ls-files` cannot miss
 * a tracked file. */
function trackedSources(): string[] {
  const out = execFileSync("git", ["ls-files", "--", "apps/web"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter((path) => /\.tsx?$/.test(path))
    .filter((path) => !/\.(test|dbtest|eval)\.tsx?$/.test(path));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * A WRITE, not a mention: `sourceCatalogEntryId` followed by a colon and
 * something other than `true` — a `select` uses `: true`, a `data` literal
 * never does.
 *
 * THE LOOKAHEAD SWALLOWS THE WHITESPACE ITSELF, and the first version of this
 * line did not: `…:\s*(?!true\b)` matches `: true`, because `\s*` backtracks
 * to zero characters and the lookahead then runs against the SPACE, which is
 * not the word `true`. So the exclusion never fired and every `select` clause
 * counted as a writer. Caught in seconds by the control below rather than by
 * anybody reading the regex — which is the argument for writing the control
 * even when the pattern looks obvious.
 */
const WRITES = /\bsourceCatalogEntryId:(?![ \t]*true\b)/;

const writers = trackedSources().filter((path) =>
  WRITES.test(stripComments(readFileSync(join(REPO_ROOT, path), "utf8"))),
);

/**
 * The innermost brace-balanced block containing `at` — the object literal the
 * row is written from.
 *
 * WHY THE BLOCK AND NOT THE FILE, and this is the second bug the controls in
 * this file caught rather than the prose. The first version asserted only that
 * `productionRate` appeared SOMEWHERE in each writer, and mutating
 * `wall-schedule.ts` back to its real pre-#514 state — the exact defect this
 * census was written for — left all seven tests GREEN, because that file
 * mentions `component.productionRate` sixty lines earlier while building its
 * inputs. A census that cannot fail on the bug it was built from is the
 * vacuous-green shape this whole directory exists to end, so it now reads the
 * literal the write is actually in.
 *
 * An unbalanced or unfound block returns "", which fails the assertion. That
 * is the safe direction on purpose: a scanner that breaks goes red rather than
 * finding nothing to complain about.
 */
function enclosingLiteral(source: string, at: number): string {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start < 0) return "";
  let open = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") open += 1;
    else if (ch === "}") {
      open -= 1;
      if (open === 0) return source.slice(start, i + 1);
    }
  }
  return "";
}

/** Every literal in `source` that writes `sourceCatalogEntryId`. */
function writeLiterals(source: string): string[] {
  const out: string[] = [];
  const all = new RegExp(WRITES.source, "g");
  let match: RegExpExecArray | null;
  while ((match = all.exec(source)) !== null) out.push(enclosingLiteral(source, match.index));
  return out;
}

/** The three hand-written mappings, by name. A fourth is not forbidden — it
 * is required to be added here, which is the one moment anybody reads this
 * file's subject line. */
const EXPECTED_WRITERS = [
  "apps/web/lib/estimating/catalog-line.ts",
  "apps/web/lib/estimating/draft-lines.ts",
  "apps/web/lib/estimating/wall-schedule.ts",
];

describe("the census can see what it is reasoning about", () => {
  it("lists tracked sources under apps/web", () => {
    const sources = trackedSources();
    expect(sources.length).toBeGreaterThan(200);
    // By name, so an `ls-files` that returned the wrong tree fails here rather
    // than reporting zero writers and passing everything below.
    expect(sources).toContain("apps/web/lib/estimating/catalog-line.ts");
    expect(sources).toContain("apps/web/lib/estimating/wall-schedule.ts");
  });

  it("finds as many writers as git counts, so a dead filter cannot pass", () => {
    // git's own count over raw bytes, comments included — so this is an UPPER
    // bound on the writers, and the filter's job is to be at most it and never
    // zero. The numbers are printed on failure, which is the whole point.
    const raw = execFileSync(
      "git",
      ["grep", "-l", "sourceCatalogEntryId:", "--", "apps/web"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((path) => !/\.(test|dbtest|eval)\.tsx?$/.test(path));

    expect(raw.length).toBeGreaterThan(0);
    expect(writers.length).toBeGreaterThan(0);
    expect(writers.length).toBeLessThanOrEqual(raw.length);
    // Every file the strict filter found must be one git found too. The
    // reverse does not hold: git counts `select` clauses and prose.
    for (const writer of writers) expect(raw).toContain(writer);
  });

  it("strips comments, proved on this file's own prose", () => {
    // This very file writes `sourceCatalogEntryId:` inside a comment and a
    // string. If the stripper regressed, it would appear in `writers`.
    expect(writers).not.toContain("apps/web/lib/estimating/catalogLineWriterCensus.test.ts");
    expect(stripComments("// sourceCatalogEntryId: entry.id\n")).not.toMatch(WRITES);
    expect(stripComments("  sourceCatalogEntryId: entry.id,\n")).toMatch(WRITES);
    // And the discriminator itself: a select clause is not a write.
    expect(stripComments("  sourceCatalogEntryId: true,\n")).not.toMatch(WRITES);
  });
});

describe("every catalog-sourced line carries the production rate", () => {
  it("is written by exactly the three known mappings", () => {
    expect([...writers].sort()).toEqual([...EXPECTED_WRITERS].sort());
  });

  for (const path of EXPECTED_WRITERS) {
    it(`${path} writes productionRate into the same literal as the row`, () => {
      const source = stripComments(readFileSync(join(REPO_ROOT, path), "utf8"));
      const literals = writeLiterals(source);
      // Non-empty, so a brace scanner that found nothing cannot pass this by
      // having nothing to check.
      expect(literals.length).toBeGreaterThan(0);
      for (const literal of literals) {
        expect(literal).not.toBe("");
        expect(literal).toMatch(/\bproductionRate\b/);
      }
    });
  }
});

describe("the brace scanner, on fixtures rather than on the real files", () => {
  // A matcher exercised only against code that passes proves nothing about
  // what it would do to code that should not. Both directions, through the
  // same function the real scan uses.
  const good = `
    await tx.jobLineItem.create({
      data: {
        jobId,
        laborHours,
        productionRate,
        sourceCatalogEntryId: entry?.id ?? null,
      },
    });
  `;
  const bad = `
    const productionRate = component?.productionRate ?? null;
    await tx.jobLineItem.create({
      data: {
        jobId,
        laborHours,
        sourceCatalogEntryId: entry?.id ?? null,
      },
    });
  `;

  it("accepts a literal carrying the rate", () => {
    const [literal] = writeLiterals(good);
    expect(literal).toMatch(/\bproductionRate\b/);
  });

  it("REJECTS the real pre-#514 shape, where the rate is in the file but not the row", () => {
    // This is `wall-schedule.ts` as it actually stood, reduced. The
    // file-wide version of this assertion passed it.
    expect(bad).toMatch(/\bproductionRate\b/);
    const [literal] = writeLiterals(bad);
    expect(literal).not.toBe("");
    expect(literal).not.toMatch(/\bproductionRate\b/);
  });

  it("returns empty for an unbalanced literal, which fails rather than passes", () => {
    expect(writeLiterals("data: { sourceCatalogEntryId: x,")).toEqual([""]);
  });
});
