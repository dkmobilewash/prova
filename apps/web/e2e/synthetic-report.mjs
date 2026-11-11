#!/usr/bin/env node
// The synthetic check's report: verdict, history, and the #prova-build post.
//
//   node e2e/synthetic-report.mjs <result.json> <history.json>
//
// Reads the walk's result (missing = the walk died before writing it), compares
// each step with its usual time from history.json, rewrites history.json with
// this run appended, and posts the verdict to SLACK_WEBHOOK_URL (an incoming
// webhook for #prova-build). Exits 1 on a failed check or a failed post, so the
// workflow run is red whenever the channel did not hear the truth.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SYNTHETIC_STEPS, nextHistory, slackText, verdict } from "./lib/syntheticReport.mjs";

const [resultPath, historyPath] = process.argv.slice(2);
if (!resultPath || !historyPath) {
  console.error("usage: synthetic-report.mjs <result.json> <history.json>");
  process.exit(2);
}
const read = (p, fallback) => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback;
  } catch {
    return fallback;
  }
};

const run = read(resultPath, null);
const history = read(historyPath, []);
const v = verdict(history, run, SYNTHETIC_STEPS);
// The workflow stopped before the walk (branch sync, or the preview never served main): say which.
if (!run && process.env.SYNTHETIC_PRECHECK_ERROR) v.problems = [process.env.SYNTHETIC_PRECHECK_ERROR];
writeFileSync(historyPath, JSON.stringify(nextHistory(history, run), null, 2));

const text = slackText(v, {
  baseUrl: process.env.SYNTHETIC_BASE_URL ?? "?",
  commit: run?.commit ?? process.env.SYNTHETIC_EXPECT_COMMIT ?? "unknown",
  runUrl: process.env.RUN_URL ?? "(local run)",
});
console.log(text);

let posted = true;
const hook = process.env.SLACK_WEBHOOK_URL;
if (!hook) {
  console.error("::error::SLACK_WEBHOOK_URL is not set: the verdict above reached nobody. Add the #prova-build incoming webhook as a repository secret.");
  posted = false;
} else {
  const response = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  if (!response.ok) {
    console.error(`::error::Slack refused the post: HTTP ${response.status} ${await response.text()}`);
    posted = false;
  }
}
process.exit(v.status === "fail" || !posted ? 1 : 0);
