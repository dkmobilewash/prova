/**
 * ── THE MODEL-FILE CENSUS'S OWN GUARDS (2026-11-24) ──
 *
 * Born from production running with the pairwise wall classifier silently OFF: TAKEOFF_WALL_MODEL
 * named a file the deployed function did not ship, the only symptom was one stderr line on a page
 * production rarely loads, and the file sat in `outputFileTracingIncludes` beside three siblings
 * that WERE shipped. No test here can see a Vercel bundle — what source can carry is pinned
 * instead, each half sized against a source that cannot drift with it:
 *
 *   1. every committed model file is NAMED in `outputFileTracingIncludes` (door-model.json was
 *      committed and never traced — found by this test's first run);
 *   2. `resolveModelPath` accepts both documented spellings and lands on the committed file;
 *   3. `modelFileCensus` reports a configured-but-missing file, and treats unset as a choice;
 *   4. MODEL_FILE_ENVS is the ONLY list — a `TAKEOFF_*_MODEL` literal in lib/takeoff that the
 *      census does not cover fails here, so a seventh model var cannot ship outside the census.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODEL_FILE_ENVS, modelFileCensus, RENO_ALL_MODEL_ENV, RENO_MODEL_ENV, RUN_MODEL_ENV } from "./wallRunModel";
import { DECISION_MODEL_ENV, resolveModelPath } from "./wallModelFile";

const appDir = fileURLToPath(new URL("../..", import.meta.url));
const modelsDir = join(appDir, "models");

/** The committed model files (the .control.json copies are training artefacts, not loadable models). */
const committedModels = readdirSync(modelsDir).filter((f) => f.endsWith(".json") && !f.endsWith(".control.json"));

describe("the model env list", () => {
  it("is exactly the owning modules' constants — no sixth list, nothing retyped", () => {
    const expected = new Set([...Object.values(DECISION_MODEL_ENV), RUN_MODEL_ENV, RENO_MODEL_ENV, RENO_ALL_MODEL_ENV]);
    expect(new Set(MODEL_FILE_ENVS)).toEqual(expected);
    // The floor: walls, types, doors, run, reno, reno-all. A parse of nothing passes every
    // downstream assertion, so the size is pinned against the modules' own exports.
    expect(MODEL_FILE_ENVS.length).toBeGreaterThanOrEqual(6);
  });

  it("covers every TAKEOFF_*_MODEL literal in lib/takeoff — a model var outside the census fails the build", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const sources = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".dbtest.ts") && !f.endsWith(".eval.ts"),
    );
    expect(sources.length).toBeGreaterThan(20); // scope floor: an empty walk sees nothing missing
    const found = new Set<string>();
    for (const f of sources) {
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        const code = line.trimStart();
        if (code.startsWith("*") || code.startsWith("//")) continue; // prose quoting a name is not a second list
        for (const m of code.matchAll(/"(TAKEOFF_[A-Z0-9_]*_MODEL)"/g)) found.add(m[1]);
      }
    }
    expect(found.size).toBeGreaterThanOrEqual(6); // the six definitions themselves — a regex matching nothing fails loudly
    for (const name of found) expect(MODEL_FILE_ENVS).toContain(name);
  });
});

describe("resolveModelPath", () => {
  it("lands on the committed pairwise model from both documented spellings", () => {
    const underApp = resolveModelPath("models/wall-model.json");
    const fromRepoRoot = resolveModelPath("apps/web/models/wall-model.json");
    expect(existsSync(underApp)).toBe(true);
    expect(existsSync(fromRepoRoot)).toBe(true);
    expect(fromRepoRoot).toBe(underApp);
  });
});

describe("modelFileCensus", () => {
  it("reports every committed model ok when each var names its file the way production does", () => {
    const env: Record<string, string> = {
      [DECISION_MODEL_ENV.walls]: "models/wall-model.json",
      [DECISION_MODEL_ENV.doors]: "models/door-model.json",
      [RUN_MODEL_ENV]: "models/wall-run-model.json",
      [RENO_MODEL_ENV]: "models/wall-reno-model.json",
      [RENO_ALL_MODEL_ENV]: "models/wall-reno-all-model.json",
    };
    const byName = new Map(modelFileCensus(env).map((s) => [s.envName, s]));
    for (const envName of Object.keys(env)) {
      expect(byName.get(envName)?.ok, envName).toBe(true);
      expect(byName.get(envName)?.resolved, envName).not.toBeNull();
    }
  });

  it("treats an unset variable as a choice, and a configured-but-missing file as the failure it is", () => {
    const rows = modelFileCensus({ [DECISION_MODEL_ENV.walls]: "models/zz-not-shipped.json" });
    const walls = rows.find((s) => s.envName === DECISION_MODEL_ENV.walls);
    expect(walls?.ok).toBe(false);
    expect(walls?.resolved).toContain("zz-not-shipped.json"); // the log line names where it looked
    for (const other of rows.filter((s) => s.envName !== DECISION_MODEL_ENV.walls)) {
      expect(other.ok, other.envName).toBe(true);
      expect(other.resolved, other.envName).toBeNull();
    }
  });
});

describe("output file tracing", () => {
  it("names every committed model file, so a deploy cannot ship the variable without the file", () => {
    const config = readFileSync(join(appDir, "next.config.mjs"), "utf8");
    const included = new Set([...config.matchAll(/"\.\/models\/([^"]+)"/g)].map((m) => m[1]));
    expect(committedModels.length).toBeGreaterThanOrEqual(4); // nothing is missing from a directory you do not walk
    expect(included.size).toBeGreaterThanOrEqual(4);
    for (const file of committedModels) expect(included, file).toContain(file);
  });
});
