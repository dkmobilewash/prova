import { describe, expect, it } from "vitest";
import { HIGH_CONFIDENCE_WALLS, MODEL_EVIDENCE, modelAutoPostAt, modelPostsItself, type ModelEvidence } from "./autoPost";
import { setReviewItems } from "./wallReview";

// METHOD v2 parts 2–3: a learned decision posts itself only at the score whose LOSO precision is ≥97% and
// whose held-out final is ≥95%, one row per decision (walls now; types and doors ready for the second).
const passing: ModelEvidence = { trainingPct: 97.4, trainingFt: 12000, heldOutPct: 95.6, heldOutFt: 6000, measured: "2026-11-13", trainingSheets: 20, heldOutSheets: 10, autoPostAt: 0.92, model: "wall-model.json@abc123" };

describe("a model's score posts itself only past its own measured bar", () => {
  it("nothing posts today: every decision's evidence is empty until the second measures LOSO on parity-correct rows", () => {
    for (const decision of ["walls", "types", "doors"] as const) expect(modelAutoPostAt(decision)).toBeNull();
    expect(Object.keys(MODEL_EVIDENCE).sort()).toEqual(["doors", "types", "walls"]);
  });
  it("evidence past both numbers gives its score; either number short, no model named, or a score that is not a probability gives null", () => {
    expect(modelAutoPostAt("walls", passing)).toBe(0.92);
    expect(modelAutoPostAt("walls", { ...passing, trainingPct: 96.9 })).toBeNull();
    expect(modelAutoPostAt("walls", { ...passing, heldOutPct: 94.9 })).toBeNull();
    expect(modelAutoPostAt("walls", { ...passing, heldOutPct: null })).toBeNull();
    expect(modelAutoPostAt("walls", { ...passing, model: null })).toBeNull();
    expect(modelAutoPostAt("walls", { ...passing, autoPostAt: 1.5 })).toBeNull();
    expect(modelAutoPostAt("types", passing)).toBe(0.92);
  });
  it("a run posts itself only with a score at or above the bar", () => {
    expect(modelPostsItself(0.92, 0.92)).toBe(true);
    expect(modelPostsItself(0.919, 0.92)).toBe(false);
    expect(modelPostsItself(null, 0.92)).toBe(false);
    expect(modelPostsItself(0.99, null)).toBe(false);
  });
  it("a wall the model posted itself is not in the junk review; the rest are", () => {
    const m = (id: string, label: string) => ({ id, kind: "LINEAR", source: "DETECTED", label, xs: [0, 0.1], ys: [0, 0] });
    const items = setReviewItems({ pageNumber: 1, feetPerUnit: 100, measurements: [m("a", HIGH_CONFIDENCE_WALLS), m("b", "wall, untyped")], storedRuns: [], heldLabel: "held", droppedLabel: "dropped" });
    expect(items.map((i) => i.measurementId)).toEqual(["b"]);
  });
});

describe("one model reader for every decision (part 3: types and doors plug in later)", () => {
  it("reads a types or doors model from its own variable, against the columns its build passes, and refuses a mismatch", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { readDecisionModel, DECISION_MODEL_ENV } = await import("./wallModelFile");
    const { scoreCandidate } = await import("./wallClassifier");
    const dir = mkdtempSync(join(tmpdir(), "decision-model-"));
    const file = join(dir, "types.json");
    writeFileSync(file, JSON.stringify({ format: "gbdt-binary-v1", features: ["tagDistanceFt", "thicknessMatch"], learningRate: 1, init: 0, trees: [{ left: [1, -1, -1], right: [2, -1, -1], feature: [0, 0, 0], threshold: [3, 0, 0], value: [0, 2, -2] }] }));
    expect(DECISION_MODEL_ENV).toEqual({ walls: "TAKEOFF_WALL_MODEL", types: "TAKEOFF_TYPE_MODEL", doors: "TAKEOFF_DOOR_MODEL" });
    const read = readDecisionModel("types", ["tagDistanceFt", "thicknessMatch"], { TAKEOFF_TYPE_MODEL: file });
    expect(read).not.toBeNull();
    // A tag 1 ft away scores high, 5 ft away low: the same evaluator the wall model uses.
    expect(scoreCandidate(read!.model, [1, 1])).toBeGreaterThan(0.8);
    expect(scoreCandidate(read!.model, [5, 1])).toBeLessThan(0.2);
    const real = console.error;
    console.error = () => {};
    try {
      expect(readDecisionModel("types", ["thicknessMatch", "tagDistanceFt"], { TAKEOFF_TYPE_MODEL: file }), "columns out of order").toBeNull();
      expect(readDecisionModel("doors", ["tagDistanceFt", "thicknessMatch"], { TAKEOFF_TYPE_MODEL: file }), "doors read their own variable").toBeNull();
    } finally {
      console.error = real;
    }
  });
});
