import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WallModel } from "./wallClassifier";
import { storedRunsOrNull } from "./wallProposal";
import { RUN_FEATURE_NAMES } from "./wallRunFeatures";
import { loadRunModel, RUN_REMOVE_BELOW, runModelVerdicts } from "./wallRunModel";
import { FEATURE_NAMES } from "./wallFeatures";
import type { WallCandidate } from "./wallVectors";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const pairModel = JSON.parse(read("../../models/wall-model.json")) as WallModel;
/** A run model that scores every row `p`: no trees, the prior alone. */
const constant = (p: number): WallModel => ({ format: "gbdt-binary-v1", kind: "run", features: [...RUN_FEATURE_NAMES], learningRate: 0.05, init: Math.log(p / (1 - p)), trees: [] }) as WallModel;
const run = (y: number): WallCandidate => ({ x1: 0.1, y1: y, x2: 0.5, y2: y, thicknessFeet: 0.4, lengthFeet: 40 }) as WallCandidate;

describe("the run model at Run takeoff, behind TAKEOFF_WALL_RUN_MODEL", () => {
  it("is off unless the variable names a run model: unset, a missing file, and the pairwise model are all null", () => {
    expect(loadRunModel({})).toBeNull();
    expect(loadRunModel({ TAKEOFF_WALL_RUN_MODEL: "/nowhere/run.json" })).toBeNull();
    expect(loadRunModel({ TAKEOFF_WALL_RUN_MODEL: "models/wall-model.json" }), "the pairwise model has other columns").toBeNull();
    const model = loadRunModel({ TAKEOFF_WALL_RUN_MODEL: "models/wall-run-model.json" });
    expect(model?.features).toEqual([...RUN_FEATURE_NAMES]);
  });

  const a = run(0.1), b = run(0.3), doubted = run(0.45), setAside = run(0.6);
  // A pairing along `doubted` the pairwise model scores 0.47 (< the hold's 0.55): the hand chain already holds it.
  const pairings = [{ x1: 0.1, y1: 0.45, x2: 0.5, y2: 0.45, thicknessFeet: 0.4, features: FEATURE_NAMES.map(() => 0) }];
  // The compare re-offers the kept runs as new objects, as `productSheetRuns` does.
  const input = { offered: [a, b, doubted, setAside], kept: [{ ...a }, { ...b }, { ...doubted }], pairings, pairModel, segments: [], textItems: [], widthPt: 1000, feetPerUnit: 100 };

  it(`remove-only: a run the hand chain posts, scored below ${RUN_REMOVE_BELOW}, is held back; at or above, nothing is; one the hand chain already holds or the compare set aside is not the model's to remove`, () => {
    const low = runModelVerdicts(input, constant(0.05));
    expect(low.removed).toEqual([input.kept[0], input.kept[1]]);
    expect(low.scores.map((s) => +s.toFixed(6))).toEqual([0.05, 0.05, 0.05]);
    expect(runModelVerdicts(input, constant(0.0999)).removed).toHaveLength(2);
    expect(runModelVerdicts(input, constant(0.1001)).removed).toEqual([]);
  });

  it("the score rides on the stored run, and one that is not a probability is dropped", () => {
    const stored = storedRunsOrNull([{ x1: 0, y1: 0, x2: 1, y2: 0, thicknessFeet: 0.4, runScore: 0.97 }, { x1: 0, y1: 1, x2: 1, y2: 1, thicknessFeet: 0.4, runScore: 1.5 }]);
    expect(stored?.map((r) => r.runScore)).toEqual([0.97, undefined]);
  });

  it("detection scores with it only when it loads, and its removals join the hold the walls stage posts", () => {
    const detect = read("./detectWallsForCalibration.ts");
    expect(detect).toContain("const runModel = raster === null ? loadRunModel(process.env) : null;");
    expect(detect).toMatch(/runModelVerdicts\(\s*\{ offered: beforeCompare\.offeredRuns, kept: offered\.offeredRuns,/);
    expect(detect).toContain("for (const run of verdicts.removed) if (!held.includes(run)) held.push(run);");
    expect(detect.indexOf("held.push(run)")).toBeLessThan(detect.indexOf("target.onBoundary({ pairings, segments: detected.found.inUnits, held });"));
    // The exam's table builds its columns with the same call.
    expect(read("./realplan/zzWallFeatureTable.eval.ts")).toContain("runModelRows({ offered: off, kept, pairings, pairModel: config.model");
  });
});
