/**
 * Every surface that costs logged hours as JOB COST reads the employer
 * burden — and every surface that reports WAGES does not.
 *
 * WHY THIS IS A TEST AND NOT A SENTENCE IN A COMMENT. The burden parameter
 * on `lineItemCostToDate`, `unassignedLaborCost`, `laborCostForRows`,
 * `catalogSourcedLine` and `phaseCodeRollupLine` DEFAULTS to
 * `NO_EMPLOYER_BURDEN`, and that default is deliberate: it is what guarantees
 * a company with no rate recorded gets byte-identical figures. The cost of
 * that guarantee is that forgetting to pass the rates is silent. A forgotten
 * call site is one screen quoting a lower cost than the screen beside it for
 * the same job — exactly the #287 shape, which `jobCostCensus.test.ts` exists
 * to stop and which this file extends to the second input.
 *
 * THE OTHER HALF IS AS IMPORTANT AND POINTS THE OPPOSITE WAY. A certified
 * payroll (WH-347) and a fringe remittance report what the WORKER was paid
 * and what was owed to the funds. An employer payroll tax inside either is a
 * wrong number on a federal form. So this file also asserts that those
 * modules never reach for the burden at all.
 *
 * WHAT IT CANNOT SEE: a caller that builds the rates into a variable under
 * another name, and anything reaching these figures by raw SQL. It is a
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

it("finds the app's source files at all", () => {
  // The scope assertion, before anything else. theme-contrast.test.ts had the
  // right pattern and the wrong scan root, and no size check could see it:
  // nothing is ever missing from a directory you do not walk.
  expect(sources.length).toBeGreaterThanOrEqual(200);
});

/** The files that DECLARE the plumbing rather than use it. `labor-job-cost.ts`
 * owns the parameter and its default; `employer-burden.ts` is the arithmetic;
 * `employer-burden-query.ts` is the loader. */
const OWNERS = new Set([
  "apps/web/lib/labor-job-cost.ts",
  "apps/web/lib/employer-burden.ts",
  "apps/web/lib/employer-burden-query.ts",
]);

/** Any entry point that turns logged hours into job-cost dollars. */
const JOB_COST_ENTRY_POINTS =
  /\b(lineItemCostToDate|unassignedLaborCost|laborCostForRows|catalogSourcedLine|phaseCodeRollupLine)\s*\(/;

/** Passing the company's rates, forwarding a parameter of its own, or saying
 * in code — not in a comment — that this surface has no company behind it. */
const CARRIES_BURDEN = /\b(employerBurdenRates|burdenRates|NO_EMPLOYER_BURDEN)\b/;

const jobCostCallers = sources.filter(
  (f) => !OWNERS.has(f.path) && JOB_COST_ENTRY_POINTS.test(f.code),
);

describe("the employer-burden census", () => {
  it("finds the job-cost call sites at all", () => {
    // Twelve today. A floor rather than an equality so adding a surface is
    // not a test edit — but a floor that fails loudly if the pattern ever
    // stops matching, which is how scratch-cleanup-order.test.ts passed
    // thirteen assertions while parsing 180 of 181 foreign keys.
    expect(jobCostCallers.length).toBeGreaterThanOrEqual(12);
  });

  it("has every job-cost caller pass the employer burden", () => {
    const missing = jobCostCallers.filter((f) => !CARRIES_BURDEN.test(f.code)).map((f) => f.path);
    expect(missing).toEqual([]);
  });

  // -------------------------------------------------------------------
  // The opposite rule, and it is not the same rule with a "not" in front:
  // these files must not merely omit the burden, they must be unable to
  // reach it. A WH-347 carrying employer FICA is a wrong federal form.
  // -------------------------------------------------------------------
  const WAGE_ONLY_MODULES = [
    "apps/web/lib/certified-payroll.ts",
    "apps/web/lib/wh347.ts",
    "apps/web/lib/fringe-remittance.ts",
    "apps/web/lib/labor-cost.ts",
  ];

  it("finds the wage-reporting modules at all", () => {
    const found = WAGE_ONLY_MODULES.filter((path) => sources.some((f) => f.path === path));
    // If one of these is renamed this fails here, naming it, rather than
    // certifying a file that no longer exists.
    expect(found).toEqual(WAGE_ONLY_MODULES);
  });

  it("keeps the employer burden out of certified payroll and fringe remittance", () => {
    const offenders = sources
      .filter((f) => WAGE_ONLY_MODULES.includes(f.path))
      .filter((f) => /employer-burden|employerBurden|burdenRates/.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  // -------------------------------------------------------------------
  // THE QUERY-SHAPE RULE, the one that generalises — the same reasoning
  // jobCostCensus.test.ts uses for cost entries and hours. A file that asks
  // the database for a company's fringe schedules is a file pricing labor,
  // and it needs the second half of the rate.
  // -------------------------------------------------------------------
  const LOADS_SCHEDULES = /loadFringeSchedulesByCraft\s*\(/;
  const LOADS_BURDEN = /loadEmployerBurdenRates\s*\(/;

  const scheduleLoaders = sources.filter((f) => !OWNERS.has(f.path) && LOADS_SCHEDULES.test(f.code));

  it("finds the files that load fringe schedules at all", () => {
    expect(scheduleLoaders.length).toBeGreaterThanOrEqual(9);
  });

  it("has every file that loads fringe schedules load the burden rates beside them", () => {
    const missing = scheduleLoaders.filter((f) => !LOADS_BURDEN.test(f.code)).map((f) => f.path);
    expect(missing).toEqual([]);
  });
});
