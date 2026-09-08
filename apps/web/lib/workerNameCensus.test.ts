/**
 * No email address reaches a column where a worker's name belongs.
 *
 * `lib/worker-name.ts` states the rule and `worker-name.test.ts` proves the
 * helper obeys it. This file answers the other half, which is the half that
 * kept failing: did somebody write an eighth `name ?? email` somewhere.
 *
 * WHY IT NEEDS A CENSUS AND NOT JUST A HELPER. This defect has recurred
 * four times. PR #181 fixed seven call sites and deliberately left four
 * more, in writing, because another agent was live in those files — and
 * those four then sat on `main`, including one feeding
 * `RemittanceReport.uncomputedNames`, which RENDERS on `/union-compliance`.
 * So an email address was printing on a compliance screen while the helper
 * that exists to prevent exactly that sat one import away. A rule enforced
 * by remembering is not enforced.
 *
 * WHAT IT SCANS. Only the modules that feed documents which LEAVE THE
 * BUILDING — certified payroll, prevailing wage, fringe remittance, the
 * apprentice ratio. Those name a person to a government agency, a trust
 * fund or an inspector. Elsewhere the fallback is reasonable: it identifies
 * somebody on an internal screen, which is what `today-dashboard.ts`'s crew
 * chips and `certifications.ts`'s sort comparator do, and both are
 * deliberately out of scope rather than forgotten.
 *
 * WHAT IT CANNOT SEE, so nobody trusts it further than it goes: an email
 * reaching a name through a variable assigned earlier, a helper of somebody
 * else's that does the fallback internally, or a page rendering
 * `user.email` directly without going through these modules.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const libDir = fileURLToPath(new URL(".", import.meta.url));

/**
 * The modules whose output ends up on a filing. Adding one here is the
 * cheap half of keeping this honest; the expensive half is noticing that a
 * new module belongs on the list at all.
 */
const FILING_MODULES = [
  "union-compliance-query.ts",
  "prevailing-wage-query.ts",
  "apprenticeship-query.ts",
  "certified-payroll-query.ts",
  "fringe-remittance.ts",
  "wh347.ts",
];

/** `something.name ?? something.email` — the exact shape, in any spacing. */
const EMAIL_FALLBACK = /\.name\s*\?\?\s*[A-Za-z0-9_.[\]]*\.?email\b/g;

/**
 * Comments are stripped before scanning, and this is not decoration.
 * PR #176's census was silently disarmed for a whole file because an
 * explanatory comment contained the literal pattern it looked for, and the
 * assertion stopped depending on the code. It happened again writing THIS
 * fix: a guard that skipped files already mentioning "worker-name" was
 * satisfied by a comment saying "see lib/worker-name.ts", so two imports
 * were never added. Third instance of one failure mode. Do not remove this.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("the worker-name census", () => {
  const files = FILING_MODULES.map((name) => ({
    name,
    source: stripComments(readFileSync(join(libDir, name), "utf8")),
  }));

  it("finds every module it claims to scan, so an empty sweep cannot pass", () => {
    // readFileSync above throws on a renamed file, which is the point: this
    // census must fail loudly rather than quietly scan five of six.
    expect(files).toHaveLength(FILING_MODULES.length);
    for (const f of files) expect(f.source.length).toBeGreaterThan(0);
  });

  it("proves the pattern matches when the defect is present", () => {
    // Guards the guard. If the regex is ever broken, every assertion below
    // goes quiet instead of red — which reads exactly like a clean sweep.
    const sample = "employeeName: e.employeeUser.name ?? e.employeeUser.email,";
    expect(sample.match(EMAIL_FALLBACK)).not.toBeNull();
  });

  it("never falls back to an email for a name on anything that gets filed", () => {
    const offenders = files
      .map((f) => ({ name: f.name, hits: [...f.source.matchAll(EMAIL_FALLBACK)].map((m) => m[0]) }))
      .filter((f) => f.hits.length > 0)
      .map((f) => `${f.name} (${f.hits.length}x)`);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "An email address can reach a column where a worker's name belongs.",
            "",
            "These modules feed documents that LEAVE THE BUILDING: a certified",
            "payroll names a worker to a government agency, a fringe remittance",
            "credits hours to a named member's trust-fund account, and the",
            "apprentice ratio names people to an inspector. An email address is",
            "not that person's name, and a wrong name on a filed form is a",
            "correction to an agency rather than a patch.",
            "",
            "Use payrollWorkerName() from lib/worker-name.ts. It returns",
            "{ label, nameMissing } and never an email, so the page can SHOW THE",
            "GAP instead of filling it — the same call hasUncomputedHours makes",
            "about hours it cannot price.",
            "",
            "This has recurred four times. #181 fixed seven call sites and left",
            "four, and those four shipped to main. That is why this is a test",
            "and not a convention.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });

  it("derives a name from a user only through the helper", () => {
    // The negative check above catches the `?? email` shape. This catches
    // the other route to the same defect: any OTHER expression that turns a
    // user record into a name string.
    //
    // Scoped to lines that ASSIGN to a name-ish key from an expression
    // mentioning a user — not to modules that merely fetch one.
    // `certified-payroll-query.ts` includes `employeeUser` in a Prisma
    // select and hands the object on for the page to resolve, which is
    // correct and must not be flagged. `fringe-remittance.ts` never sees a
    // user at all. Two earlier drafts of this test got that wrong by
    // scanning whole files instead of assignments, and both were reshaped
    // until they passed — which is the vacuous shape this file exists to
    // avoid, so the reasoning is recorded rather than the third attempt
    // quietly presented as the first.
    // `\bUser\b` was WRONG here and matched nothing, because the word
    // boundary fails inside `employeeUser`. This test passed vacuously
    // until a mutation that should have reddened it did not. Kept as
    // `[Uu]ser\b` so it matches the identifiers this codebase actually
    // uses: employeeUser, apprenticeUser, uploadedByUser.
    const NAME_FROM_USER = /\b\w*[Nn]ame\s*:\s*[^,;\n]*[Uu]ser\b[^,;\n]*/g;

    const offenders = files.flatMap((f) =>
      [...f.source.matchAll(NAME_FROM_USER)]
        .map((m) => m[0].trim())
        .filter((line) => !/payrollWorkerName/.test(line))
        .map((line) => `${f.name}: ${line}`),
    );

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "A user record is being turned into a name without the helper that",
            "owns the rule. Use payrollWorkerName() from lib/worker-name.ts —",
            "it never returns an email, and it reports nameMissing so the page",
            "can show the gap instead of filling it.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });
});
