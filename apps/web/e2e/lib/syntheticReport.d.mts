export interface SyntheticStep {
  name: string;
  seconds: number;
  ok: boolean;
  error?: string;
  note?: string;
}
export interface SyntheticRun {
  ok: boolean;
  startedAt: string;
  steps: SyntheticStep[];
}
export interface VerdictRow {
  name: string;
  state: "ok" | "slow" | "failed" | "not reached";
  seconds: number | null;
  baseline: number | null;
}
export interface Verdict {
  status: "pass" | "slow" | "fail";
  rows: VerdictRow[];
  problems: string[];
}
export const SYNTHETIC_STEPS: readonly ["sign in", "create job", "upload plans", "run takeoff", "review queue", "build estimate", "open proposal"];
export const BASELINE_RUNS: number;
export const MIN_SAMPLES: number;
export const SLOW_FACTOR: number;
export const SLOW_FLOOR_SECONDS: number;
export const HISTORY_KEEP: number;
export function median(xs: number[]): number;
export function baselineFor(history: SyntheticRun[], step: string): number | null;
export function verdict(history: SyntheticRun[], run: SyntheticRun | null, expectedSteps: readonly string[]): Verdict;
export function slackText(v: Verdict, where: { baseUrl: string; commit: string; runUrl: string }): string;
export function nextHistory(history: SyntheticRun[], run: SyntheticRun | null): SyntheticRun[];
