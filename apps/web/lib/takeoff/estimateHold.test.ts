import { describe, expect, it } from "vitest";
import { ESTIMATE_HOLD_CUT, isHeldRun, runsHeldOffEstimate } from "./estimateHold";
import type { WallModel } from "./wallClassifier";

const run = { x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.5, thicknessFeet: 0.4 };
const pairing = { ...run, features: [0] };
/** A model answering one log-odds whatever it is shown. */
const scoring = (score: number): WallModel =>
  ({ format: "gbdt-binary-v1", features: [], learningRate: 1, init: Math.log(score / (1 - score)), trees: [] }) as unknown as WallModel;

describe("runs held off the estimate", () => {
  it("holds a run the model scores under the cut, and not one above it", () => {
    expect(runsHeldOffEstimate(scoring(ESTIMATE_HOLD_CUT - 0.05), [run], [pairing], 100, false)).toEqual([run]);
    expect(runsHeldOffEstimate(scoring(ESTIMATE_HOLD_CUT + 0.05), [run], [pairing], 100, false)).toEqual([]);
  });
  it("holds nothing on a scan, or on a run with no pairing of its own", () => {
    expect(runsHeldOffEstimate(scoring(0.01), [run], [pairing], 100, true)).toEqual([]);
    expect(runsHeldOffEstimate(scoring(0.01), [run], [], 100, false)).toEqual([]);
  });
  it("knows a stored run by its coordinates", () => {
    expect(isHeldRun({ ...run }, [run])).toBe(true);
    expect(isHeldRun({ ...run, x2: 0.41 }, [run])).toBe(false);
    expect(isHeldRun(run, [])).toBe(false);
  });
});
