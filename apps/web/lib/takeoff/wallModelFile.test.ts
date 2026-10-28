import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FEATURE_NAMES } from "./wallFeatures";
import { loadWallModel } from "./wallModelFile";

const dir = mkdtempSync(path.join(tmpdir(), "wall-model-"));
const good = { format: "gbdt-binary-v1", features: [...FEATURE_NAMES], learningRate: 0.1, init: 0, trees: [] };
const write = (name: string, body: unknown) => {
  const p = path.join(dir, name);
  writeFileSync(p, JSON.stringify(body));
  return p;
};

describe("loadWallModel", () => {
  it("is null with no file named, so nothing is demoted by a model nobody configured", () => {
    expect(loadWallModel({})).toBeNull();
  });
  it("loads a matching model at the default cut, the env cut, or the file's own cut (file wins)", () => {
    const file = write("good.json", good);
    expect(loadWallModel({ TAKEOFF_WALL_MODEL: file })).toEqual({ model: good, cut: 0.2 });
    expect(loadWallModel({ TAKEOFF_WALL_MODEL: file, TAKEOFF_WALL_MODEL_CUT: "0.45" })?.cut).toBe(0.45);
    const withCut = write("cut.json", { ...good, cut: 0.25 });
    expect(loadWallModel({ TAKEOFF_WALL_MODEL: withCut, TAKEOFF_WALL_MODEL_CUT: "0.45" })?.cut).toBe(0.25);
  });
  it("refuses a model whose columns are not this build's, a bad cut, and an unreadable file — loudly", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stale = write("stale.json", { ...good, features: [...FEATURE_NAMES].reverse() });
    expect(loadWallModel({ TAKEOFF_WALL_MODEL: stale })).toBeNull();
    expect(loadWallModel({ TAKEOFF_WALL_MODEL: write("g2.json", good), TAKEOFF_WALL_MODEL_CUT: "1.5" })).toBeNull();
    expect(loadWallModel({ TAKEOFF_WALL_MODEL: path.join(dir, "missing.json") })).toBeNull();
    expect(error).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });
});
