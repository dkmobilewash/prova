import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scoreCandidate, type WallModel } from "./wallClassifier";
import { coverShare, RUN_FEATURE_NAMES, runFeatureRows } from "./wallRunFeatures";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

// Page 1000 pt wide, 100 ft per page-width unit.
const W = 1000, FPU = 100;
const run = (y: number, lengthFeet = 40) => ({ x1: 0.1, y1: y, x2: 0.1 + lengthFeet / FPU, y2: y, lengthFeet, thicknessFeet: 0.5 }) as WallCandidate;
const faces = (y: number, lengthFeet: number, gray: number): StrokeSegment[] => [-2.5, 2.5].map((d) => ({ x1: 100, y1: y * W + d, x2: 100 + (lengthFeet / FPU) * W, y2: y * W + d, gray }));
const model: WallModel = { format: "gbdt-binary-v1", features: [], learningRate: 0.1, init: 0, trees: [] };

describe("runFeatureRows", () => {
  const runs = [run(0.2), run(0.3)];
  const base = { runs, kept: new Set([runs[0]!]), heldOff: new Set<WallCandidate>(), pairings: [], model, segments: [...faces(0.2, 40, 0.5), ...faces(0.3, 40, 0)], textItems: [{ str: "EXISTING", x: 300, y: 300, width: 40, height: 8 }], widthPt: W, feetPerUnit: FPU, renovation: true };
  const col = (n: (typeof RUN_FEATURE_NAMES)[number]) => RUN_FEATURE_NAMES.indexOf(n);

  it("writes one row per run, as wide as the names", () => {
    const rows = runFeatureRows(base);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toHaveLength(RUN_FEATURE_NAMES.length);
  });
  it("reads pen, words, the compare and the sheet, per run", () => {
    const [a, b] = runFeatureRows(base);
    expect([a![col("greyShare")], b![col("greyShare")]]).toEqual([1, 0]);
    expect(a![col("sheetGreyShare")]).toBe(0.5);
    expect([a![col("keptByCompare")], b![col("keptByCompare")]]).toEqual([1, 0]);
    expect(b![col("existWords5")]).toBe(1); // the word sits on the run at y 0.3
    expect(a![col("existWords5")]).toBe(0);
    expect(a![col("renovation")]).toBe(1);
    expect(a![col("paired")]).toBe(0);
    expect(a![col("demoAt05")]).toBe(-1); // no prior plan: the demo columns say so
  });
  it("measures how much of a run the demolition plan draws", () => {
    const [a] = runFeatureRows({ ...base, prior: { lines: [{ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.2 }], faces: [] } });
    expect(a![col("paired")]).toBe(1);
    expect(a![col("demoAt05")]).toBeCloseTo(0.5);
  });
});

describe("coverShare", () => {
  it("counts overlapping cover once and ignores lines across the run", () => {
    const base = { x1: 0, y1: 0, x2: 1, y2: 0 };
    expect(coverShare(base, [{ x1: 0, y1: 0, x2: 0.6, y2: 0 }, { x1: 0.4, y1: 0, x2: 0.8, y2: 0 }], 0.01)).toBeCloseTo(0.8);
    expect(coverShare(base, [{ x1: 0.5, y1: -1, x2: 0.5, y2: 1 }], 0.01)).toBe(0);
  });
});

// The shipped models must read exactly these columns, and score as scikit-learn did when they were trained.
describe.each(["wall-run-model", "wall-reno-model"])("%s", (name) => {
  const dir = join(__dirname, "../../models");
  const m = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as WallModel;
  const control = JSON.parse(readFileSync(join(dir, `${name}.control.json`), "utf8")) as { rows: number[][]; expected: number[] };
  it("reads RUN_FEATURE_NAMES in order", () => expect(m.features).toEqual([...RUN_FEATURE_NAMES]));
  it("scores the parity rows as training did", () => {
    expect(control.rows.length).toBeGreaterThanOrEqual(5);
    control.rows.forEach((r, i) => expect(scoreCandidate(m, r)).toBeCloseTo(control.expected[i]!, 6));
  });
});
