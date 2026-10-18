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
 *
 * AND IT SAYS ALL OF THAT WHERE IT CAN BE READ WITHOUT THE JOB LOG. Under
 * GitHub Actions the same findings are emitted as `::error::` workflow
 * commands, which become check-run annotations — visible on the PR and
 * readable from `/repos/{owner}/{repo}/check-runs/{id}/annotations`.
 *
 * The reason is a measured one rather than a nicety. Before this, a failing
 * `e2e` job's only annotation was `Process completed with exit code 1`, and
 * the line that decides whether a run was CONCLUSIVE — `collected N,
 * returned N` — existed solely in the job log. Both the log and the
 * Playwright report artifact download redirect to
 * `*.blob.core.windows.net`, which an agent container's egress proxy
 * refuses at CONNECT, so neither is reachable from one; and reading a log
 * tail by hand is not something the person this suite was built for does at
 * all. So the one number that distinguishes "this is main's known baseline"
 * from "this run proved nothing" was the hardest number in CI to obtain.
 *
 * Escaping is load-bearing, not defensive. A Playwright error message
 * carries newlines and `%`; unescaped, a newline ENDS a workflow command,
 * so the annotation is truncated and whatever follows is interpreted as the
 * next command. `escapeData`/`escapeProperty` are GitHub's own rules.
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

/**
 * ONE VERDICT IS ONE LINE, and that is a safety property rather than a
 * formatting preference. GitHub treats ANY stdout line beginning with `::` as
 * a workflow command, so a spec title carrying a newline — a title built from
 * a template literal is all it takes — would end this script's own report line
 * and let whatever followed be parsed as a command. Found by the test for
 * this file, in the human-readable half, which is the half nobody suspected.
 */
const oneLine = (value) =>
  value === undefined || value === null ? value : String(value).replace(/[\r\n]+/g, " ").trim();

const verdicts = [];
for (const suite of report.suites ?? []) {
  for (const spec of specs(suite)) {
    for (const test of spec.tests ?? []) {
      const last = test.results?.[test.results.length - 1];
      verdicts.push({
        title: oneLine(`[${test.projectName}] ${spec.title}`),
        // `status` is the test's OUTCOME across retries; `results` being
        // empty means the test never ran, which must not read as anything
        // other than a missing verdict.
        status: test.results?.length ? test.status : "NEVER RAN",
        error: oneLine(last?.error?.message?.split("\n")[0]),
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

/**
 * GitHub shows at most ten error annotations per step, so a catastrophic run
 * annotates the first ten and says how many it did not.
 */
const ANNOTATION_LIMIT = 10;

/** https://docs.github.com/actions/reference/workflow-commands-for-github-actions */
const escapeData = (value) =>
  String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (value) =>
  escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");

const annotate = (title, message) => {
  console.log(`::error title=${escapeProperty(title)}::${escapeData(message)}`);
};

if (process.env.GITHUB_ACTIONS === "true" && (verdicts.length !== expected || bad.length > 0)) {
  if (verdicts.length !== expected) {
    annotate(
      "E2E verdicts incomplete",
      `${expected} tests were collected and ${verdicts.length} verdicts came back. ` +
        "A missing verdict is its own failure state; it is never folded into 'passed'.",
    );
  }
  for (const v of bad.slice(0, ANNOTATION_LIMIT)) {
    annotate(`E2E ${v.status.toUpperCase()}`, `${v.title}${v.error ? ` — ${v.error}` : ""}`);
  }
  if (bad.length > ANNOTATION_LIMIT) {
    annotate(
      "E2E failures truncated",
      `${bad.length} tests did not return 'expected'; the first ${ANNOTATION_LIMIT} are ` +
        "annotated above and the full list is in this step's log.",
    );
  }
}

process.exit(verdicts.length === expected && bad.length === 0 ? 0 : 1);
