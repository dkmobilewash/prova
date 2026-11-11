import { describe, expect, it } from "vitest";
import { baselineFor, nextHistory, slackText, verdict, HISTORY_KEEP } from "./syntheticReport.mjs";
import type { SyntheticRun } from "./syntheticReport.d.mts";

const STEPS = ["sign in", "upload", "takeoff"];
const run = (seconds: number[], ok = true): SyntheticRun => ({
  ok,
  startedAt: "2026-11-10T12:00:00Z",
  steps: seconds.map((s, i) => ({ name: STEPS[i]!, seconds: s, ok: true })),
});
const where = { baseUrl: "https://demo.example", commit: "18a75c3b0000", runUrl: "https://gh/run/1" };

describe("the synthetic check's verdict", () => {
  it("no baseline until three passing runs, and failed runs never set one", () => {
    expect(baselineFor([run([10, 20, 30]), run([12, 22, 32])], "upload")).toBeNull();
    expect(baselineFor([run([10, 20, 30]), run([99, 99, 99], false), run([12, 22, 32])], "upload")).toBeNull();
    expect(baselineFor([run([10, 20, 30]), run([12, 22, 32]), run([11, 21, 31])], "upload")).toBe(21);
  });

  it("passes at the usual times, and with no history at all", () => {
    const history = [run([10, 20, 30]), run([10, 20, 30]), run([10, 20, 30])];
    expect(verdict(history, run([11, 22, 33]), STEPS).status).toBe("pass");
    expect(verdict([], run([11, 22, 33]), STEPS).status).toBe("pass");
  });

  it("over 50% AND 5s slower is slow; 50% of a small number is not", () => {
    const history = [run([2, 20, 30]), run([2, 20, 30]), run([2, 20, 30])];
    const v = verdict(history, run([4, 31, 30]), STEPS);
    expect(v.status).toBe("slow");
    expect(v.problems).toEqual(["upload: SLOW, 31s against a usual 20s (+55%)"]);
    expect(verdict(history, run([2, 30, 30]), STEPS).status).toBe("pass"); // exactly +50% is not over it
  });

  it("a failed step, a step never reached, or no results at all is a failure", () => {
    const failed: SyntheticRun = { ok: false, startedAt: "x", steps: [{ name: "sign in", seconds: 3, ok: true }, { name: "upload", seconds: 60, ok: false, error: "Timeout" }] };
    const v = verdict([], failed, STEPS);
    expect(v.status).toBe("fail");
    expect(v.problems).toEqual(["upload: FAILED after 60s — Timeout", "takeoff: never reached"]);
    expect(verdict([], null, STEPS).status).toBe("fail");
  });

  it("the Slack text leads with the verdict and names every step with its time", () => {
    const history = [run([10, 20, 30]), run([10, 20, 30]), run([10, 20, 30])];
    const text = slackText(verdict(history, run([10, 40, 30]), STEPS), where);
    expect(text.split("\n")[0]).toBe("⚠️ Synthetic check SLOW on the demo environment (https://demo.example, commit 18a75c3b), 80s in all");
    expect(text).toContain("upload 40s (usual 20s) SLOW");
    expect(text).toContain("Run: https://gh/run/1");
  });

  it("keeps the last 30 runs", () => {
    const many = Array.from({ length: HISTORY_KEEP }, () => run([1, 1, 1]));
    expect(nextHistory(many, run([2, 2, 2]))).toHaveLength(HISTORY_KEEP);
    expect(nextHistory(many, null)).toBe(many);
  });
});
