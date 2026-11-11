// The daily synthetic check's verdict: pass, slow or fail, and the Slack text.
//
// Plain .mjs (with syntheticReport.d.mts) so the workflow runs it with bare
// `node`, no build, and syntheticReport.test.ts tests the same file.
//
// A step is SLOW when it took more than 1.5x its baseline — the median of the
// same step over the last BASELINE_RUNS passing runs — and at least
// SLOW_FLOOR_SECONDS more in absolute terms, so a 2s step taking 3.1s is not
// an alert. No baseline yet (fewer than MIN_SAMPLES passing runs) is said, not
// guessed.

/** The walk's steps, in order (e2e/synthetic/demo-check.synthetic.spec.ts). */
export const SYNTHETIC_STEPS = ["sign in", "create job", "upload plans", "run takeoff", "review queue", "build estimate", "open proposal"];

export const BASELINE_RUNS = 7;
export const MIN_SAMPLES = 3;
export const SLOW_FACTOR = 1.5;
export const SLOW_FLOOR_SECONDS = 5;
export const HISTORY_KEEP = 30;

/** @param {number[]} xs */
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** @param {import("./syntheticReport.d.mts").SyntheticRun[]} history @param {string} step */
export function baselineFor(history, step) {
  const samples = history
    .filter((run) => run.ok)
    .slice(-BASELINE_RUNS)
    .map((run) => run.steps.find((s) => s.name === step && s.ok)?.seconds)
    .filter((x) => typeof x === "number");
  return samples.length >= MIN_SAMPLES ? median(samples) : null;
}

/**
 * @param {import("./syntheticReport.d.mts").SyntheticRun[]} history
 * @param {import("./syntheticReport.d.mts").SyntheticRun | null} run  null = the walk wrote nothing
 * @param {string[]} expectedSteps
 */
export function verdict(history, run, expectedSteps) {
  if (!run) return { status: "fail", rows: [], problems: ["The check wrote no results: it died before its first step (read the run log)."] };
  const problems = [];
  const rows = expectedSteps.map((name) => {
    const step = run.steps.find((s) => s.name === name);
    const baseline = baselineFor(history, name);
    if (!step) {
      problems.push(`${name}: never reached`);
      return { name, state: "not reached", seconds: null, baseline };
    }
    if (!step.ok) {
      problems.push(`${name}: FAILED after ${step.seconds}s — ${step.error ?? "no message"}`);
      return { name, state: "failed", seconds: step.seconds, baseline };
    }
    const slow = baseline !== null && step.seconds > baseline * SLOW_FACTOR && step.seconds - baseline >= SLOW_FLOOR_SECONDS;
    if (slow) problems.push(`${name}: SLOW, ${step.seconds}s against a usual ${baseline}s (+${Math.round((step.seconds / baseline - 1) * 100)}%)`);
    return { name, state: slow ? "slow" : "ok", seconds: step.seconds, baseline };
  });
  const failed = !run.ok || rows.some((r) => r.state === "failed" || r.state === "not reached");
  return { status: failed ? "fail" : problems.length ? "slow" : "pass", rows, problems };
}

/** @param {ReturnType<typeof verdict>} v @param {{ baseUrl: string, commit: string, runUrl: string }} where */
export function slackText(v, where) {
  const head = { pass: "✅ Synthetic check PASSED", slow: "⚠️ Synthetic check SLOW", fail: "🚨 Synthetic check FAILED" }[v.status];
  const total = v.rows.reduce((t, r) => t + (r.seconds ?? 0), 0);
  const lines = [
    `${head} on the demo environment (${where.baseUrl}, commit ${where.commit.slice(0, 8)}), ${Math.round(total)}s in all`,
    ...v.problems.map((p) => `• ${p}`),
    v.rows.map((r) => `${r.name} ${r.seconds === null ? "—" : `${r.seconds}s`}${r.baseline === null ? "" : ` (usual ${r.baseline}s)`}${r.state === "ok" ? "" : ` ${r.state.toUpperCase()}`}`).join(" · "),
    `Run: ${where.runUrl}`,
  ];
  return lines.join("\n");
}

/** Append and trim. Only passing runs set a baseline, but every run is kept for the record. */
export function nextHistory(history, run) {
  return run ? [...history, run].slice(-HISTORY_KEEP) : history;
}
