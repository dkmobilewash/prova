import { describe, expect, it } from "vitest";
import control from "./wall-model.control.json";
import model from "./wall-model.json";
import { deciderFor, scoreCandidate, type WallModel } from "./wallClassifier";
import { FEATURE_NAMES } from "./wallFeatures";

const m = model as unknown as WallModel;

describe("the trained wall classifier", () => {
  it("MATCHES SCIKIT-LEARN ON THE ROWS IT WAS TRAINED WITH", () => {
    // The parity control the trainer writes beside the model. Without it a
    // mistake in the tree walk — an off-by-one on a child index, the learning
    // rate applied twice, the logistic forgotten — would not throw. It would
    // quietly score every sheet wrongly, which is the failure this whole
    // directory exists to stop.
    expect(control.rows.length, "the control has no rows").toBeGreaterThan(0);
    for (let i = 0; i < control.rows.length; i += 1) {
      expect(scoreCandidate(m, control.rows[i]), `row ${i}`).toBeCloseTo(control.expected[i], 6);
    }
  });

  it("the model's columns are this build's features, in order", () => {
    // A mismatch compares every threshold against the wrong column and
    // produces confident nonsense rather than an error, so it is checked
    // rather than assumed.
    expect(m.features).toEqual([...FEATURE_NAMES]);
  });

  it("REFUSES A MODEL WHOSE COLUMNS DO NOT MATCH, rather than scoring anyway", () => {
    expect(deciderFor({ ...m, features: ["nonsense"] }, FEATURE_NAMES)).toBeNull();
    expect(
      deciderFor({ ...m, format: "something-else" as WallModel["format"] }, FEATURE_NAMES),
    ).toBeNull();
    expect(deciderFor(m, FEATURE_NAMES)).not.toBeNull();
  });

  it("returns a probability", () => {
    const p = scoreCandidate(m, new Array(FEATURE_NAMES.length).fill(0));
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
