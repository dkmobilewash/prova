import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deciderFor } from "./wallClassifier";
import { FEATURE_NAMES } from "./wallFeatures";
import { DEFAULT_WALL_MODEL_CUT, forgetWallModel, loadWallModel } from "./wallModelFile";

/**
 * ── THE COMMITTED MODEL LOADS AGAINST THIS BUILD, OR THE BUILD FAILS ──
 *
 * `models/wall-model.json` is the 28-column model trained with round 8
 * (`train-20261029-164211-signals28-round8`). `loadWallModel` refuses a model
 * whose columns do not match `FEATURE_NAMES`, and refusing is a classifier
 * that is silently off — so this asserts the committed file is ACCEPTED,
 * that `deciderFor` scores with it, and what cut it runs at. A deploy names
 * the file with `TAKEOFF_WALL_MODEL`; this is the path it names.
 */
const FILE = join(__dirname, "..", "..", "models", "wall-model.json");

describe("the committed wall model", () => {
  it("IS ACCEPTED BY loadWallModel AND SCORED BY deciderFor", () => {
    const loaded = loadWallModel({ TAKEOFF_WALL_MODEL: FILE });
    expect(loaded).not.toBeNull();
    expect(loaded!.model.features).toEqual([...FEATURE_NAMES]);
    expect(loaded!.cut).toBe(DEFAULT_WALL_MODEL_CUT);
    const score = deciderFor(loaded!.model, FEATURE_NAMES);
    expect(score).not.toBeNull();
    // a vector of zeros scores somewhere in (0, 1): the trees ran
    const p = score!(new Array(FEATURE_NAMES.length).fill(0), { x1: 0, y1: 0, x2: 1, y2: 0, lengthFeet: 10, thicknessFeet: 0.5 } as never);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });
});

/**
 * The reading `workspaceLoad` and the settings page both use. Written out here
 * rather than imported because both callers reach it through a Prisma query —
 * and the expression, not the query, is what an inverted flag gets wrong.
 */
function greyOutOn(row: { demotedWallsOff: boolean } | null): boolean {
  return !(row?.demotedWallsOff ?? false);
}

describe("the grey-out is on unless a company turned it off", () => {
  // Diego's decision, 2026-10-29: on for every company, existing and new.
  // The column is the NEGATION so that a default of false makes every existing
  // row on without an UPDATE over customer data — see company.prisma. These
  // cases pin the reading, because an inverted flag is read wrongly exactly
  // once and then shipped.
  it("is ON for a company that has never touched it", () => {
    expect(greyOutOn({ demotedWallsOff: false })).toBe(true);
  });

  it("is ON for a company with no settings row at all", () => {
    // The one that would quietly leave somebody out: `?? false` on the column
    // means "not off", so a missing row has to resolve to ON too.
    expect(greyOutOn(null)).toBe(true);
  });

  it("is OFF only when the company said so", () => {
    expect(greyOutOn({ demotedWallsOff: true })).toBe(false);
  });
});

describe("a model that cannot load is said ONCE", () => {
  // workspaceLoad calls loadWallModel on EVERY takeoff page load, and the
  // grey-out is on for every company now. Without memoising, one bad deploy
  // writes this line on every request and buries the log.
  it("logs the refusal once across many calls, and keeps returning null", () => {
    forgetWallModel();
    const said: unknown[][] = [];
    const real = console.error;
    console.error = (...args: unknown[]) => void said.push(args);
    try {
      const env = { TAKEOFF_WALL_MODEL: "/nowhere/no-such-model.json" };
      const answers = [loadWallModel(env), loadWallModel(env), loadWallModel(env), loadWallModel(env)];
      expect(answers, "a missing model must not become a config").toEqual([null, null, null, null]);
      expect(said.length, `the refusal was logged ${said.length} times, not once`).toBe(1);
    } finally {
      console.error = real;
      forgetWallModel();
    }
  });

  it("re-reads when the path changes, so the cache cannot pin a stale answer", () => {
    forgetWallModel();
    const real = console.error;
    console.error = () => {};
    try {
      expect(loadWallModel({ TAKEOFF_WALL_MODEL: "/nowhere/a.json" })).toBeNull();
      expect(loadWallModel({ TAKEOFF_WALL_MODEL: "" }), "an unset path is not the same question").toBeNull();
      expect(loadWallModel({ TAKEOFF_WALL_MODEL: "/nowhere/b.json" })).toBeNull();
    } finally {
      console.error = real;
      forgetWallModel();
    }
  });
});

describe("where a relative TAKEOFF_WALL_MODEL is looked for", () => {
  // `readFileSync` would resolve a relative path against the process's cwd,
  // which this repo relies on nowhere: `rasterWorkerPath()` computes its own
  // path from import.meta.url precisely because cwd is unreliable on Vercel.
  // A model that cannot be read is invisible — every company has the grey-out
  // on, the page behaves exactly as before, and one log line says why.
  it("finds the committed model by its path relative to apps/web", () => {
    const got = loadWallModel({ TAKEOFF_WALL_MODEL: "models/wall-model.json" });
    expect(got, "models/wall-model.json did not resolve").not.toBeNull();
    expect(got!.model.features).toEqual([...FEATURE_NAMES]);
  });

  it("finds it by its path relative to the repo root too", () => {
    // Both spellings are ones a person would reasonably put in Vercel, so
    // neither has to be remembered.
    const got = loadWallModel({ TAKEOFF_WALL_MODEL: "apps/web/models/wall-model.json" });
    expect(got, "apps/web/models/wall-model.json did not resolve").not.toBeNull();
    expect(got!.model.features).toEqual([...FEATURE_NAMES]);
  });

  it("does not depend on the process's working directory", () => {
    // The whole point: the same value answers the same way from anywhere.
    const was = process.cwd();
    try {
      process.chdir("/");
      const got = loadWallModel({ TAKEOFF_WALL_MODEL: "models/wall-model.json" });
      expect(got, "resolving broke when the cwd moved, which is the bug this prevents").not.toBeNull();
    } finally {
      process.chdir(was);
    }
  });

  it("uses an absolute path exactly as given", () => {
    const abs = join(fileURLToPath(import.meta.url), "..", "..", "..", "models", "wall-model.json");
    expect(loadWallModel({ TAKEOFF_WALL_MODEL: abs })).not.toBeNull();
  });
});

describe("a model whose columns are not this build's is refused", () => {
  // THIS LOST ITS TEST in #851's restructure, and it is the guard that makes a
  // wrong model safe: a 28-column model against a 24-column build DISABLES the
  // classifier rather than misreading it. That is not a hypothetical — it is
  // the exact failure found on #851 itself, and on its e2e fixture after that.
  it("returns null and says so, rather than scoring against the wrong columns", () => {
    const dir = mkdtempSync(join(tmpdir(), "wall-model-"));
    const file = join(dir, "wrong-columns.json");
    writeFileSync(
      file,
      JSON.stringify({
        format: "gbdt-binary-v1",
        features: ["thicknessVsCommon", "lengthPercentile"],
        learningRate: 0.1,
        init: 0,
        trees: [{ left: [-1], right: [-1], feature: [0], threshold: [0], value: [1] }],
      }),
    );
    const said: unknown[][] = [];
    const real = console.error;
    console.error = (...args: unknown[]) => void said.push(args);
    try {
      forgetWallModel();
      expect(
        loadWallModel({ TAKEOFF_WALL_MODEL: file }),
        "a two-column model was accepted by a 28-column build",
      ).toBeNull();
      expect(said.length, "the refusal was not logged").toBe(1);
    } finally {
      console.error = real;
      forgetWallModel();
    }
  });
});
