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

/** lib/wip.ts DECLARES the parameter; lib/labor-job-cost.ts BUILDS it. */
const OWNERS = new Set(["apps/web/lib/wip.ts", "apps/web/lib/labor-job-cost.ts"]);

const wipCallers = sources.filter(
  (f) => f.code.includes("calculateLineItemWip(") && !OWNERS.has(f.path),
);

/** The pre-#287 shape: cost entries summed straight into the field. */
const BARE_COST_ENTRY_SUM = /actualCostToDate\s*:\s*[\w.]+\.costEntries\s*\.\s*reduce\s*\(/;

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

  it("leaves no cost-entries-only actualCostToDate anywhere in the app", () => {
    const offenders = sources.filter((f) => BARE_COST_ENTRY_SUM.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
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
