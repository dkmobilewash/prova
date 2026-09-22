#!/usr/bin/env node
/**
 * COUNTS THE VERDICTS THE RUN ACTUALLY RETURNED, AND REQUIRES THAT NUMBER
 * TO EQUAL THE NUMBER OF TESTS IT COLLECTED.
 *
 * CLAUDE.md's rule, from #195 and from the workflow that scored branches
 * "contested" with `refutedBy: 0/0`: **absence of a failure is not a
 * pass.** A Playwright run that collected nothing exits 0. A run whose
 * every test was skipped exits 0. A run whose config resolved an empty
 * `testMatch` exits 0. All three are indistinguishable from "everything
 * passed" if the only thing read is the exit code — which is the only
 * thing a CI step reads.
 *
 * And it is the same shape as the census scars: a check that DERIVES the
 * set it reasons about has two failure modes, and only one of them looks
 * like a failure. So this asserts the SIZE of the set from a source that
 * cannot drift with it — `playwright test --list --reporter=json`, run
 * against the same config, before the run — and then requires every one of
 * those tests to carry a returned status of `passed`.
 *
 *     node e2e/verdicts.mjs <results.json> <expected-count>
 *
 * A skipped test is a FAILURE here, deliberately and with no opt-out. A
 * `test.skip()` added to get a branch green is exactly the thing this file
 * exists to make visible, and "it was skipped on purpose" is an argument
 * to have in a diff, not a state to pass silently.
 */
import { readFileSync } from "node:fs";

const [reportPath, expectedRaw] = process.argv.slice(2);
if (!reportPath || !expectedRaw) {
  console.error("usage: node e2e/verdicts.mjs <results.json> <expected-count>");
  process.exit(2);
}

const expected = Number(expectedRaw);
if (!Number.isInteger(expected) || expected < 1) {
  // Zero is not a pass. A config that collects no tests is a broken config,
  // and it is the single most likely way this whole suite quietly stops
  // meaning anything.
  console.error(`verdicts: expected-count was "${expectedRaw}" — a run that collects no tests proves nothing.`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  console.error(`verdicts: could not read ${reportPath} — ${error instanceof Error ? error.message : String(error)}`);
  console.error("verdicts: no report means no verdicts, which is its own failure state and never a pass.");
  process.exit(1);
}

/** Playwright's JSON report nests suites; every leaf `spec` carries tests. */
function* specs(suite) {
  for (const spec of suite.specs ?? []) yield spec;
  for (const child of suite.suites ?? []) yield* specs(child);
}

const verdicts = [];
for (const suite of report.suites ?? []) {
  for (const spec of specs(suite)) {
    for (const test of spec.tests ?? []) {
      const last = test.results?.[test.results.length - 1];
      verdicts.push({
        title: `[${test.projectName}] ${spec.title}`,
        // `status` is the test's OUTCOME across retries; `results` being
        // empty means the test never ran, which must not read as anything
        // other than a missing verdict.
        status: test.results?.length ? test.status : "NEVER RAN",
        error: last?.error?.message?.split("\n")[0],
      });
    }
  }
}

const bad = verdicts.filter((v) => v.status !== "expected");
const lines = [
  `verdicts: collected ${expected}, returned ${verdicts.length}`,
];

if (verdicts.length !== expected) {
  lines.push(
    `verdicts: FAILED — ${expected} tests were collected and ${verdicts.length} verdicts came back. ` +
      "A missing verdict is its own failure state; it is never folded into 'passed'.",
  );
}
for (const v of bad) lines.push(`verdicts:   ${v.status.toUpperCase()}  ${v.title}${v.error ? ` — ${v.error}` : ""}`);

console.log(lines.join("\n"));
process.exit(verdicts.length === expected && bad.length === 0 ? 0 : 1);
