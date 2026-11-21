import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runsHeldOffEstimate } from "./estimateHold";
import { heldOnSheet, type HeldInput, type HeldModels } from "./heldOnSheet";
import type { WallModel } from "./wallClassifier";
import { FEATURE_NAMES } from "./wallFeatures";
import { RUN_FEATURE_NAMES } from "./wallRunFeatures";
import { renoModelRemovals, runModelVerdicts } from "./wallRunVerdicts";
import type { WallCandidate } from "./wallVectors";

/** `heldOnSheet`: the held set detection and the live list both use (prereg-live-list-parity.md). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const pairModel = JSON.parse(read("../../models/wall-model.json")) as WallModel;
const constant = (p: number): WallModel => ({ format: "gbdt-binary-v1", kind: "run", features: [...RUN_FEATURE_NAMES], learningRate: 0.05, init: Math.log(p / (1 - p)), trees: [] }) as WallModel;
const run = (y: number): WallCandidate => ({ x1: 0.1, y1: y, x2: 0.5, y2: y, thicknessFeet: 0.4, lengthFeet: 40 }) as WallCandidate;
const a = run(0.1), b = run(0.3), doubted = run(0.45), setAside = run(0.6);
const pairings = [{ x1: 0.1, y1: 0.45, x2: 0.5, y2: 0.45, thicknessFeet: 0.4, features: FEATURE_NAMES.map(() => 0) }];
const kept = [{ ...a }, { ...b }, { ...doubted }];
const renovation = [{ str: "EXISTING WALL" }, { str: "EXISTING DOOR" }, { str: "EXISTING" }].map((t) => ({ ...t, x: 0, y: 0, width: 1, height: 1 }));
const prior = { lines: [], faces: [] };
const input = { beforeCompare: [a, b, doubted, setAside], kept, pairings, segments: [], textItems: renovation, widthPt: 1000, feetPerUnit: 100, scanned: false, prior };
const none: HeldModels = { hold: null, pair: null, run: null, reno: null };

describe("heldOnSheet", () => {
  it("with no model file at all, holds nothing and scores nothing: the server and the viewer fall back alike", () => {
    expect(heldOnSheet(input, none)).toEqual({ held: [], runScore: [NaN, NaN, NaN], modelScore: [null, null, null] });
  });

  it("is exactly detection's old block: the 0.55 hold, then the run model's removals, then R's, each run once", () => {
    const models: HeldModels = { hold: pairModel, pair: pairModel, run: constant(0.05), reno: constant(0.05) };
    const got = heldOnSheet(input, models);
    const old: WallCandidate[] = runsHeldOffEstimate(pairModel, kept, pairings, 100, false);
    const v = { offered: input.beforeCompare, kept, pairings, pairModel, segments: [], textItems: renovation, widthPt: 1000, feetPerUnit: 100, prior };
    const verdicts = runModelVerdicts(v, constant(0.05));
    for (const one of verdicts.removed) if (!old.includes(one)) old.push(one);
    for (const one of renoModelRemovals(v, constant(0.05))) if (!old.includes(one)) old.push(one);
    expect(got.held).toEqual(old);
    expect(got.held).toContain(kept[0]);
    expect(got.runScore).toEqual(verdicts.scores);
    expect(new Set(got.held).size).toBe(got.held.length);
  });

  it("the hold model alone holds what the pairwise model doubts and nothing more; the company switch turning it off holds nothing", () => {
    expect(heldOnSheet(input, { ...none, hold: pairModel }).held).toEqual(runsHeldOffEstimate(pairModel, kept, pairings, 100, false));
    expect(heldOnSheet(input, { ...none, pair: pairModel, run: constant(0.5) }).held).toEqual([]);
  });

  it("a scanned sheet never meets the run model or R, as trained", () => {
    const got = heldOnSheet({ ...input, scanned: true }, { hold: null, pair: pairModel, run: constant(0.05), reno: constant(0.05) });
    expect(got.held).toEqual([]);
    expect(got.runScore.every((s) => Number.isNaN(s))).toBe(true);
  });

  it("R alone acts only on a renovation sheet with its demolition plan aligned", () => {
    const reno: HeldModels = { hold: null, pair: pairModel, run: null, reno: constant(0.05) };
    expect(heldOnSheet(input, reno).held.length).toBeGreaterThan(0);
    const unpaired: HeldInput = { ...input };
    delete unpaired.prior;
    expect(heldOnSheet(unpaired, reno).held).toEqual([]);
  });
});
