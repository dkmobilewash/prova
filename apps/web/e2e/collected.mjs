#!/usr/bin/env node
/**
 * PRINTS HOW MANY TESTS A PLAYWRIGHT CONFIG COLLECTS — the number
 * `e2e/verdicts.mjs` then requires the run to return a verdict for.
 *
 *     playwright test --config <config> --list --reporter=json   # writes the
 *       # listing to $PLAYWRIGHT_JSON_OUTPUT_NAME
 *     node e2e/collected.mjs <listing.json>                      # prints N
 *
 * WHY THIS IS A FILE AND NOT A NUMBER IN THE WORKFLOW. `verdicts.mjs` exists
 * because an exit code cannot tell "every test passed" from "no test ran" —
 * a run that collected nothing, a run whose every test was skipped and a run
 * that went green are the same zero. Its answer to that is to check the
 * verdicts returned against the number COLLECTED, which only works if that
 * number comes from somewhere that cannot drift with the run. A literal in
 * ci.yml drifts the day somebody adds a spec: it goes stale upward (the new
 * test's verdict is spare, and nothing complains) or downward (the job goes
 * red for a reason that is not a defect). `--list` against the same config
 * is the source that moves when the suite moves.
 *
 * AND IT IS ITSELF A DERIVING CHECK, so it has the two failure modes
 * CLAUDE.md names: it can get the answer wrong, and it can get an empty
 * question. Only the first looks like a failure. So:
 *
 *   - zero is never printed. A listing with no tests in it is a broken
 *     config, not a suite that happens to be empty, and it must fail HERE
 *     rather than sail through as an expectation of nothing;
 *   - the walk over `suites`/`specs`/`tests` is cross-checked against the
 *     listing's own `stats` totals, which Playwright writes independently of
 *     the nesting this file walks. Two derivations from one file: if the
 *     report's shape ever changes under us, this disagrees and says so,
 *     instead of quietly returning a smaller number that every downstream
 *     assertion then passes. (Measured on playwright@1.63.0: `--list` marks
 *     every collected test `skipped`, so the four stats sum to the total.)
 *   - a listing carrying `errors` is refused. Playwright exits non-zero for
 *     those anyway, but this file must not be the one that turns a failed
 *     listing into a plausible-looking integer.
 *
 * Diagnostics go to stderr; stdout is the number and nothing else, because
 * the caller reads it with `$( )`.
 */
import { readFileSync } from "node:fs";

const [reportPath] = process.argv.slice(2);
const die = (message) => {
  process.stderr.write(`collected: ${message}\n`);
  process.exit(1);
};

if (!reportPath) die("usage: node e2e/collected.mjs <listing.json>");

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  die(
    `could not read ${reportPath} — ${error instanceof Error ? error.message : String(error)}. ` +
      "Did `playwright test --list --reporter=json` run with PLAYWRIGHT_JSON_OUTPUT_NAME set to this path?",
  );
}

if (report.errors?.length) {
  process.stderr.write(`collected: the listing reported ${report.errors.length} error(s):\n`);
  for (const error of report.errors) process.stderr.write(`collected:   ${error.message?.split("\n")[0] ?? String(error)}\n`);
  die("a listing that failed is not a count of anything.");
}

/** Playwright's JSON report nests suites; every leaf `spec` carries tests. */
function* specs(suite) {
  for (const spec of suite.specs ?? []) yield spec;
  for (const child of suite.suites ?? []) yield* specs(child);
}

let walked = 0;
for (const suite of report.suites ?? []) {
  for (const spec of specs(suite)) walked += (spec.tests ?? []).length;
}

const stats = report.stats ?? {};
const fromStats = ["expected", "skipped", "unexpected", "flaky"].reduce(
  (total, key) => total + (Number(stats[key]) || 0),
  0,
);

if (walked !== fromStats) {
  die(
    `this file walked ${walked} tests out of ${reportPath} and the listing's own stats say ` +
      `${fromStats} (expected ${stats.expected}, skipped ${stats.skipped}, unexpected ${stats.unexpected}, flaky ${stats.flaky}). ` +
      "Two derivations from one file disagree, so neither is a number to check a run against — " +
      "read the report's shape before trusting either.",
  );
}

if (walked < 1) {
  die(
    `${reportPath} collects no tests. That is a broken config, not an empty suite — ` +
      "check `testDir`, `testMatch` and the project list. Zero is never a count worth passing on.",
  );
}

process.stdout.write(`${walked}\n`);
