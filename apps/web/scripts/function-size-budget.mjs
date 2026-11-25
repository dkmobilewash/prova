/**
 * ── THE PER-FUNCTION SIZE BUDGET: FAIL A PR BEFORE IT TIPS A FUNCTION OVER VERCEL'S 5 GB ──
 *
 * 2026-11-14: production deploys were frozen at #1178 for ~12 hours because "api/ask" crossed
 * Vercel's 5 GB uncompressed function limit at #1179 (5.03 GB) and crept to 5.13 GB. GitHub CI
 * stayed green the whole time — Vercel build failures are invisible to the merge gates — so 19
 * consecutive production deploys failed before anyone looked. This script is the CI half of the
 * fix Diego ordered: WARN at 4 GB, FAIL at 4.5 GB, per traced entrypoint, after `next build`.
 *
 * WHAT IT MEASURES, and the bound on it: Next writes one `.nft.json` per server entrypoint with
 * the files that entry traces; this sums each entry's unique file bytes (the entry's own .js
 * included). Vercel may GROUP several entries into one function, and a group can exceed the sum
 * of any single member — so a pass here does not PROVE the deploy fits; the budget's headroom
 * (5 GB − 4.5 GB) is what absorbs grouping. A single entry over budget always means the deploy
 * would fail. The deriving-check rule: this script FAILS LOUDLY if it finds no entries at all —
 * a guard that scanned nothing must never pass (the vacuous-green family in CLAUDE.md).
 */
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(APP, ".next", "server");
const WARN_GB = Number(process.env.SIZE_BUDGET_WARN_GB ?? "4");
const FAIL_GB = Number(process.env.SIZE_BUDGET_FAIL_GB ?? "4.5");
const GB = 1024 ** 3;

function* nftFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* nftFiles(p);
    else if (e.name.endsWith(".nft.json")) yield p;
  }
}

const sizeCache = new Map();
const sizeOf = (p) => {
  let s = sizeCache.get(p);
  if (s === undefined) {
    try {
      s = statSync(p).size;
    } catch {
      s = 0; // a traced path that no longer exists weighs nothing in the deploy either
    }
    sizeCache.set(p, s);
  }
  return s;
};

// ── EVERY MODEL FILE THE INCLUDE LIST NAMES IS IN EVERY ENTRY'S TRACE (2026-11-24) ──
// The include key is "/**", so each model must ride in every function. A model named in the list and
// missing from a trace fails here, after the build, in CI. (The 2026-11-24 outage was NOT this — the
// file was traced and the resolver looked in the build directory; modelCensus.test.ts pins that.)
const CONFIG = readFileSync(join(APP, "next.config.mjs"), "utf8");
const INCLUDED_MODELS = [...CONFIG.matchAll(/"\.\/models\/([^"]+)"/g)].map((m) => resolve(APP, "models", m[1]));
if (INCLUDED_MODELS.length < 4) {
  console.error(`function-size-budget: parsed ${INCLUDED_MODELS.length} model files from next.config.mjs's include list (expected at least 4) — the model check would see nothing`);
  process.exit(1);
}
const missingModels = [];

const entries = [];
for (const nft of nftFiles(SERVER)) {
  const { files = [] } = JSON.parse(readFileSync(nft, "utf8"));
  const base = dirname(nft);
  const traced = new Set(files.map((f) => resolve(base, f)));
  for (const model of INCLUDED_MODELS) if (!traced.has(model)) missingModels.push(`${nft.slice(SERVER.length + 1)}: ${model.slice(APP.length + 1)}`);
  const seen = new Set();
  let bytes = sizeOf(nft.replace(/\.nft\.json$/, ".js"));
  for (const f of files) {
    const abs = resolve(base, f);
    if (seen.has(abs)) continue;
    seen.add(abs);
    bytes += sizeOf(abs);
  }
  entries.push({ entry: nft.slice(SERVER.length + 1, -".nft.json".length), bytes });
}

if (entries.length === 0) {
  console.error(`function-size-budget: found NO .nft.json entries under ${SERVER} — the guard scanned nothing, which must never pass. Did the build run with output file tracing?`);
  process.exit(1);
}

if (missingModels.length > 0) {
  console.error(`FAIL: ${missingModels.length} (entry, model) pairs where a model named in outputFileTracingIncludes is not in the entry's trace:`);
  for (const line of missingModels.slice(0, 20)) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`function-size-budget: all ${INCLUDED_MODELS.length} included model files traced into all ${entries.length} entries`);

entries.sort((a, b) => b.bytes - a.bytes);
const gb = (n) => (n / GB).toFixed(2);
console.log(`function-size-budget: ${entries.length} entries; largest:`);
for (const { entry, bytes } of entries.slice(0, 8)) console.log(`  ${gb(bytes).padStart(6)} GB  ${entry}`);

const over = entries.filter((e) => e.bytes > FAIL_GB * GB);
const warn = entries.filter((e) => e.bytes > WARN_GB * GB && e.bytes <= FAIL_GB * GB);
for (const { entry, bytes } of warn) console.log(`WARN: ${entry} is ${gb(bytes)} GB traced (warn line ${WARN_GB} GB; Vercel fails the FUNCTION at 5 GB)`);
if (over.length > 0) {
  for (const { entry, bytes } of over) console.error(`FAIL: ${entry} is ${gb(bytes)} GB traced, over the ${FAIL_GB} GB budget — a Vercel production deploy of this would die at the 5 GB function limit (see the 2026-11-14 outage in this file's header)`);
  process.exit(1);
}
console.log(`function-size-budget: all entries under ${FAIL_GB} GB (warned: ${warn.length})`);

// The scanned-sheet worker, run inside the scanned-sheet route's function as traced: CI already calls this script
// after `next build`, so the check rides here rather than in the workflow (raster-worker-trace-check.mjs says why).
const worker = spawnSync(process.execPath, [join(APP, "scripts", "raster-worker-trace-check.mjs")], { stdio: "inherit" });
if (worker.status !== 0) process.exit(1);
