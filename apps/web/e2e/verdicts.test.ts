/**
 * PROVES `verdicts.mjs` SAYS WHAT IT FOUND WHERE IT CAN BE READ WITHOUT THE
 * JOB LOG — and proves it by RUNNING the script, not by reading it.
 *
 * `verdicts.mjs` is the guard behind CLAUDE.md's "absence of a failure is not
 * a pass": it requires the number of verdicts returned to equal the number
 * collected, and every one of them to be `expected`. That guard was correct
 * and nearly unreadable. A failing `e2e` job's only check-run annotation was
 * `Process completed with exit code 1`, and `collected N, returned N` — the
 * line that decides whether a red run is main's known baseline or proof of
 * nothing — lived only in the job log. The log and the report artifact both
 * download from `*.blob.core.windows.net`, which an agent container's egress
 * proxy refuses at CONNECT, so from one of those the single most important
 * number in CI was unobtainable.
 *
 * So the script now emits `::error::` workflow commands as well, and this
 * file pins the three things that can silently stop being true:
 *
 *   1. the annotations appear when, and only when, something is wrong;
 *   2. they appear ONLY under GitHub Actions, so a local run stays quiet;
 *   3. no verdict can FORGE a workflow command. GitHub parses any stdout line
 *      beginning with `::`, so a newline inside a spec title would end the
 *      line it sits on and let the remainder be read as a command. Writing
 *      this file found that live in the HUMAN-READABLE half — the half with no
 *      escaping and nobody watching it — not in the annotations. The script
 *      now flattens every title and error to one line, and the annotation
 *      escapes on top of that.
 *
 * It spawns the real file rather than importing it, because the thing under
 * test is the process's stdout and exit code — which is all CI ever reads.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./verdicts.mjs", import.meta.url));

/** One leaf test in Playwright's JSON report shape. */
function test_(title: string, status: string | null, error?: string) {
  return {
    projectName: "chromium",
    title,
    tests: [
      {
        projectName: "chromium",
        status: status ?? "expected",
        // `results: []` is the "never ran" case: a verdict that is absent
        // rather than negative, which is the whole point of the guard.
        results: status === null ? [] : [error ? { error: { message: error } } : {}],
      },
    ],
  };
}

function report(specs: ReturnType<typeof test_>[]) {
  return { suites: [{ specs }] };
}

/** Runs the script and returns its exit code and stdout. */
function run(
  reportBody: unknown,
  expected: number | string,
  env: Record<string, string> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "verdicts-"));
  const path = join(dir, "results.json");
  writeFileSync(path, JSON.stringify(reportBody));
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, path, String(expected)], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "", ...env },
    });
    return { code: 0, stdout };
  } catch (error) {
    // execFileSync throws an Error carrying the child's status and streams.
    const failure = error as { status?: number; stdout?: string };
    return { code: failure.status ?? 1, stdout: String(failure.stdout ?? "") };
  }
}

const CI = { GITHUB_ACTIONS: "true" };
const annotations = (stdout: string) =>
  stdout.split("\n").filter((l) => l.startsWith("::error"));

describe("verdicts.mjs", () => {
  it("passes, and annotates nothing, when every collected test returned expected", () => {
    const { code, stdout } = run(report([test_("a", "expected"), test_("b", "expected")]), 2, CI);
    expect(code).toBe(0);
    expect(stdout).toContain("verdicts: collected 2, returned 2");
    expect(annotations(stdout)).toEqual([]);
  });

  it("annotates the counts when a verdict is MISSING, naming both numbers", () => {
    const { code, stdout } = run(report([test_("a", "expected")]), 2, CI);
    expect(code).toBe(1);
    const [first] = annotations(stdout);
    expect(first).toContain("title=E2E verdicts incomplete");
    expect(first).toContain("2 tests were collected and 1 verdicts came back");
  });

  it("annotates a test that NEVER RAN as its own state, not as a failure to fold away", () => {
    const { code, stdout } = run(report([test_("ghost", null)]), 1, CI);
    expect(code).toBe(1);
    expect(annotations(stdout).join("\n")).toContain("title=E2E NEVER RAN");
    expect(annotations(stdout).join("\n")).toContain("ghost");
  });

  it("annotates a skipped test, which has no opt-out", () => {
    const { code, stdout } = run(report([test_("parked", "skipped")]), 1, CI);
    expect(code).toBe(1);
    expect(annotations(stdout).join("\n")).toContain("title=E2E SKIPPED");
  });

  it("names the failing test and its first error line", () => {
    const { code, stdout } = run(
      report([test_("11. the browser threw nothing", "unexpected", "Minified React error #418")]),
      1,
      CI,
    );
    expect(code).toBe(1);
    const joined = annotations(stdout).join("\n");
    expect(joined).toContain("11. the browser threw nothing");
    expect(joined).toContain("Minified React error #418");
  });

  it("stays silent outside GitHub Actions, however red the run is", () => {
    const { code, stdout } = run(report([test_("a", "unexpected", "boom")]), 2);
    expect(code).toBe(1);
    expect(annotations(stdout)).toEqual([]);
    // the human-readable report is unchanged and still there
    expect(stdout).toContain("verdicts: collected 2, returned 1");
  });

  it("ESCAPES % in an error message, which arrives verbatim", () => {
    const { code, stdout } = run(
      report([test_("spec", "unexpected", "expected 50% got 10%")]),
      1,
      CI,
    );
    expect(code).toBe(1);
    const lines = annotations(stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("expected 50%25 got 10%25");
  });

  /**
   * The newline vector is the TITLE, not the error. `verdicts.mjs` already
   * reduces an error to `message.split("\n")[0]`, so a multi-line Playwright
   * failure cannot reach the annotation — this test asserted it could and was
   * wrong, which is worth recording: the escaping matters, the route to it was
   * not the obvious one. A spec title built from a template literal is the
   * route that remains, and an unescaped newline there would end the command
   * and let the remainder parse as the next one.
   */
  it("a newline in a title cannot forge a second workflow command", () => {
    const { code, stdout } = run(
      report([test_("step 11\n::error::forged", "unexpected", "boom")]),
      1,
      CI,
    );
    expect(code).toBe(1);
    // ONE annotation in the whole of stdout. Before `oneLine`, the
    // human-readable report printed the raw title, so `::error::forged`
    // started a line of its own and GitHub would have made it an annotation.
    expect(annotations(stdout)).toHaveLength(1);
    expect(stdout).not.toMatch(/^::error::forged/m);
    // The title survives, flattened, in both halves. It is NOT `:`-escaped in
    // the message and does not need to be: command parsing is anchored at the
    // start of a line, so a mid-line `::` is inert. Only the `title=`
    // PROPERTY escapes `:` and `,`, which are that list's own delimiters.
    expect(stdout).toContain("step 11 ::error::forged");
    expect(annotations(stdout)[0]).toContain("[chromium] step 11 ::error::forged — boom");
    expect(annotations(stdout)[0].split("\n")).toHaveLength(1);
  });

  it("escapes : and , in the title, which are property delimiters", () => {
    const { code, stdout } = run(report([test_("x", "timedOut")]), 1, CI);
    expect(code).toBe(1);
    // `timedOut` carries no delimiters itself; the title property is still run
    // through escapeProperty, and the injection case above is what proves it.
    expect(annotations(stdout)[0]).toMatch(/^::error title=E2E TIMEDOUT::/);
  });

  it("caps at ten annotations and says how many it did not show", () => {
    const specs = Array.from({ length: 14 }, (_, i) => test_(`t${i}`, "unexpected", "e"));
    const { code, stdout } = run(report(specs), 14, CI);
    expect(code).toBe(1);
    const lines = annotations(stdout);
    // 10 failures + the truncation notice
    expect(lines).toHaveLength(11);
    expect(lines.at(-1)).toContain("14 tests did not return 'expected'");
  });

  it("treats a missing report as a failure state rather than a pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "verdicts-"));
    let code = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [SCRIPT, join(dir, "nope.json"), "3"], {
        encoding: "utf8",
        env: { ...process.env, ...CI },
      });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      code = failure.status ?? 1;
      stderr = String(failure.stderr ?? "");
    }
    expect(code).toBe(1);
    expect(stderr).toContain("no report means no verdicts");
  });
});
