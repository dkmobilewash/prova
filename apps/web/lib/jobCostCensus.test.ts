/**
 * Every surface that computes a job's cost to date reads LABOR, not just
 * cost entries.
 *
 * WHY THIS IS A TEST AND NOT A SENTENCE IN A COMMENT. Issue #287's defect
 * was never an arithmetic mistake: `calculateTimeEntryLaborCost` has
 * produced the right burdened figure since the week it was written, and
 * /jobs/[id] printed it on the time-entry row. It was simply never ADDED to
 * anything, so percent complete, earned revenue, over/under billing, gross
 * margin, the metric bar and the surety's WIP schedule were all computed
 * over roughly a third of a self-performed job's cost, with every screen
 * looking complete. That is this repo's "written, documented, and never
 * called" shape at its most expensive.
 *
 * The fix is one helper (`lineItemCostToDate`) used by every caller of
 * `calculateLineItemWip`. Nothing about that is self-enforcing: the NEXT
 * surface to want a WIP figure will copy the nearest existing call, and if
 * it copies the shape without the labor it reintroduces the defect on one
 * screen while the others stay right — two pages disagreeing about the same
 * job's cost, which is worse than both being wrong the same way.
 *
 * THE BRIEF THAT COMMISSIONED THE FIX SAID THERE WERE THREE SITES. There
 * were seven. That is the whole argument for deriving the set here rather
 * than listing it: a hand-written roll-call of call sites is wrong the day
 * somebody adds the eighth.
 *
 * WHAT IT CANNOT SEE: a caller that passes a hand-built `actualCostToDate`
 * through a variable, and anything reaching the figure by raw SQL. It is a
 * source scan and it is a floor, not a proof.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

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

/** A comment quoting the pattern it explains disarmed a census here once
 * (#185), so comments never count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const sources = sourceFiles(appDir)
  .map((full) => ({ path: relative(repoRoot, full), source: readFileSync(full, "utf8") }))
  .map((f) => ({ ...f, code: stripComments(f.source) }));

/**
 * lib/wip.ts DECLARES the parameter; lib/labor-job-cost.ts BUILDS it;
 * lib/catalog-actuals.ts builds the catalog's equivalent. These three are
 * where a `costEntries.reduce` is SUPPOSED to live — everywhere else it is
 * the defect.
 */
const OWNERS = new Set([
  "apps/web/lib/wip.ts",
  "apps/web/lib/labor-job-cost.ts",
  "apps/web/lib/catalog-actuals.ts",
]);

const wipCallers = sources.filter(
  (f) => f.code.includes("calculateLineItemWip(") && !OWNERS.has(f.path),
);

/**
 * The pre-#287 shape: cost entries summed straight into a cost field.
 *
 * The field name is NOT pinned to `actualCostToDate` any more, and that
 * widening is the whole of what this census missed the first time. The
 * catalog's own loop spelled the identical mistake as
 * `actualCost: line.costEntries.reduce(...)` — one word different — so it
 * sailed past a pattern that named the WIP field, and went on pricing every
 * future bid off materials alone for two days after #287 was called fixed.
 */
const BARE_COST_ENTRY_SUM = /\b\w*[Cc]ost\w*\s*:\s*[\w.]+\.costEntries\s*\.\s*reduce\s*\(/;

describe("the job-cost census", () => {
  // THE SIZE CHECK FIRST, and it is what makes the rest mean anything.
  // scratch-cleanup-order.test.ts passed thirteen assertions while parsing
  // 180 of 181 foreign keys, because a pattern matching nothing is never
  // missing anything. If this scan ever finds no callers, it must fail
  // loudly rather than certify an empty set.
  it("finds the WIP call sites at all", () => {
    expect(wipCallers.length).toBeGreaterThanOrEqual(7);
  });

  it("has every caller of calculateLineItemWip build its cost through lineItemCostToDate", () => {
    const missing = wipCallers
      .filter((f) => !f.code.includes("lineItemCostToDate("))
      .map((f) => f.path);
    expect(missing).toEqual([]);
  });

  it("leaves no cost-entries-only cost figure anywhere in the app", () => {
    const offenders = sources
      .filter((f) => !OWNERS.has(f.path) && BARE_COST_ENTRY_SUM.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  // -------------------------------------------------------------------
  // The catalog, which #287's fix did not reach and which is the one
  // surface here that WRITES. "Update default from actuals" sets
  // LineItemCatalogEntry.defaultBudgetedUnitCost, and that number prices
  // every future bid and grounds every AI draft — so a cost-entries-only
  // sample here does not merely display low, it BANKS low, and each click
  // banks it again. The same one-directional walk toward zero that #105
  // finding 2 documents for unfinished jobs.
  // -------------------------------------------------------------------
  const catalogCallers = sources.filter(
    (f) => f.code.includes("catalogActuals(") && !OWNERS.has(f.path),
  );

  it("finds the catalog-actuals call sites at all", () => {
    // Two: the page that renders the badge and the action that writes the
    // default. If this ever reads 0 the two assertions below are certifying
    // an empty question, which is how scratch-cleanup-order.test.ts passed
    // while parsing 180 of 181 foreign keys.
    expect(catalogCallers.length).toBeGreaterThanOrEqual(2);
  });

  it("has every catalog caller build its lines through catalogSourcedLine", () => {
    const missing = catalogCallers
      .filter((f) => !f.code.includes("catalogSourcedLine("))
      .map((f) => f.path);
    expect(missing).toEqual([]);
  });

  it("has every catalog caller actually fetch the hours", () => {
    // catalogSourcedLine reads `row.timeEntries`. A caller that calls it but
    // never selects the column hands it an empty list, and an empty list of
    // hours is indistinguishable from a line nobody worked — the figure
    // would be exactly as wrong as before, through a function named for
    // getting it right.
    const missing = catalogCallers.filter((f) => !FETCHES_TIME_ENTRIES.test(f.code)).map((f) => f.path);
    expect(missing).toEqual([]);
  });

  // -------------------------------------------------------------------
  // THE QUERY-SHAPE RULE, and it is the one that generalises.
  //
  // Every rule above names a function, so each only covers a surface
  // somebody thought to route through that function. #287 was fixed on
  // seven surfaces and left wrong on three, and the three were missed for
  // three different reasons — a different field name (`actualCost`), a
  // different aggregate (the catalog), a different page (`/phase-codes`).
  // What all ten had in common was upstream of any of that: they ASK THE
  // DATABASE FOR COST ENTRIES.
  //
  // So the rule is about the query, not the arithmetic. A file that selects
  // CostEntry rows is a file computing what something cost, and it must
  // select the hours too. That catches the eleventh surface before anyone
  // has decided which helper it ought to use.
  // -------------------------------------------------------------------
  const FETCHES_COST_ENTRIES = /costEntries\s*:\s*(\{|true)/;
  // STRUCTURAL, not a token search, and BOTH shapes the app actually uses:
  // a nested `timeEntries: { ... }` relation, or a separate
  // `prisma.timeEntry.findMany({ select: TIME_ENTRY_COST_SELECT })` that the
  // company-wide loaders do because one query per job would be a query per
  // job.
  //
  // Bare `TIME_ENTRY_COST_SELECT` was the first draft and two mutations
  // walked straight through it: deleting the `timeEntries:` line from a query
  // leaves the symbol sitting in the file's IMPORT, so the census went on
  // certifying a query that had stopped fetching hours. Requiring `select:`
  // in front of it is what makes the difference between a name being present
  // and a column being asked for.
  const FETCHES_TIME_ENTRIES =
    /timeEntries\s*:\s*(\{|true)|select\s*:\s*\{?\s*(\.\.\.)?\s*TIME_ENTRY_COST_SELECT/;

  const costEntryReaders = sources.filter(
    (f) => !OWNERS.has(f.path) && FETCHES_COST_ENTRIES.test(f.code),
  );

  it("finds the files that read cost entries at all", () => {
    expect(costEntryReaders.length).toBeGreaterThanOrEqual(8);
  });

  it("has every file that fetches cost entries fetch the hours beside them", () => {
    const missing = costEntryReaders
      .filter((f) => !FETCHES_TIME_ENTRIES.test(f.code))
      .map((f) => f.path);
    expect(missing).toEqual([]);
  });

  it("has every caller account for hours that name no line item", () => {
    // TimeEntry.lineItemId is nullable and the log form's line-item select
    // defaults to "No specific line", so a caller that only sums the
    // attached entries drops most of a job's labor while looking fixed.
    const missing = wipCallers
      .filter((f) => !f.code.includes("unassignedLaborCost("))
      .map((f) => f.path);
    expect(missing).toEqual([]);
  });
});
