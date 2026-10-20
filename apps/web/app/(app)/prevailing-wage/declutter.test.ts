/**
 * /prevailing-wage after declutter round 3 (density audit #22: a 492-char
 * explainer, then every worker × every day inline, then the job mapping and
 * every rule set). Read from SOURCE — the page is an async server component
 * over Prisma; what is pinned is which part sits in which tab or row.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
const at = (needle: string) => {
  const i = page.indexOf(needle);
  expect(i, `missing: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("/prevailing-wage", () => {
  it("keeps the explainer, in a disclosure", () => {
    expect(at("These are rules, never rates.")).toBeGreaterThan(at('<Disclosure variant="plain"'));
  });

  it("defaults to the week check; rules and the job mapping are on ?tab=setup", () => {
    expect(page).toContain('{ href: "/prevailing-wage?tab=setup", label: "Rules & jobs" }');
    const week = at("{!onSetup && (");
    const setup = at("{onSetup && (");
    expect(at('data-tour="pw-check-week"')).toBeGreaterThan(week);
    expect(at('data-tour="pw-check-week"')).toBeLessThan(setup);
    expect(at('data-tour="pw-which-job"')).toBeGreaterThan(setup);
    expect(at("<RuleSetForm />")).toBeGreaterThan(setup);
  });

  it("draws one closed row per worker, with the verdict on it and the days inside", () => {
    const row = at('<Disclosure\n                          variant="row"');
    expect(at("{weekVerdict(employee.review)}")).toBeGreaterThan(row);
    expect(at("employee.review.disagreements.map")).toBeGreaterThan(at("{weekVerdict(employee.review)}"));
    expect(page).toMatch(/if \(reviewIsClean\(review\)\) return <span className="text-tag-green-ink">matches<\/span>/);
  });
});
