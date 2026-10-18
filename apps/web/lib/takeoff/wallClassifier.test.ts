import { describe, expect, it } from "vitest";
import { deciderFor, scoreCandidate, type WallModel } from "./wallClassifier";
import { FEATURE_NAMES } from "./wallFeatures";

/**
 * A model small enough to check by hand.
 *
 * ── WHY THERE IS NO TRAINED MODEL IN THE REPO ──
 *
 * There was one, trained on bench candidates. It lost to the rules on every
 * number — bench phantom footage 3,497 to 7,930 ft, the zero-wall bar PASS to
 * FAIL — and the post-mortem is in `NOTES.md`. One of the two faults was that
 * a missing value was encoded as −1 on the same axis as the real ones, so the
 * feature columns changed when that was fixed and the model became
 * unloadable: `deciderFor` refuses it, which is the behaviour below.
 *
 * It was deleted rather than left beside a column list it no longer matches.
 * A model file that cannot load is not a fallback, it is a thing the next
 * person has to work out the status of.
 *
 * Two trees, one split each, on the first feature:
 *   tree 0: x0 <= 0.5 ? +2 : −2
 *   tree 1: x0 <= 0.5 ? +1 : −1
 * With init 0 and a learning rate of 0.1, x0 = 0 scores
 * sigmoid(0 + 0.1*2 + 0.1*1) = sigmoid(0.3), and x0 = 1 gives sigmoid(−0.3).
 */
const stump = (hi: number, lo: number) => ({
  left: [1, -1, -1],
  right: [2, -1, -1],
  feature: [0, -2, -2],
  threshold: [0.5, -2, -2],
  value: [0, hi, lo],
});

const model: WallModel = {
  format: "gbdt-binary-v1",
  features: [...FEATURE_NAMES],
  learningRate: 0.1,
  init: 0,
  trees: [stump(2, -2), stump(1, -1)],
};

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

describe("the wall classifier's evaluator", () => {
  it("WALKS THE TREES THE WAY SCIKIT-LEARN DOES", () => {
    // Checked against the arithmetic above rather than against itself: a slip
    // in the walk — an off-by-one on a child index, the learning rate applied
    // twice, the logistic forgotten — would not throw, it would score every
    // sheet wrongly and silently.
    const low = new Array(FEATURE_NAMES.length).fill(0);
    const high = new Array(FEATURE_NAMES.length).fill(0);
    high[0] = 1;
    expect(scoreCandidate(model, low)).toBeCloseTo(sigmoid(0.3), 12);
    expect(scoreCandidate(model, high)).toBeCloseTo(sigmoid(-0.3), 12);
  });

  it("starts from init, not from zero", () => {
    const low = new Array(FEATURE_NAMES.length).fill(0);
    expect(scoreCandidate({ ...model, init: 1 }, low)).toBeCloseTo(sigmoid(1.3), 12);
  });

  it("REFUSES A MODEL WHOSE COLUMNS DO NOT MATCH, rather than scoring anyway", () => {
    // The columns are the contract. A mismatch compares every threshold
    // against the wrong feature and produces confident nonsense; refusing
    // falls back to the rules, which are the shipped behaviour.
    expect(deciderFor({ ...model, features: ["nonsense"] }, FEATURE_NAMES)).toBeNull();
    expect(
      deciderFor({ ...model, features: [...FEATURE_NAMES].reverse() }, FEATURE_NAMES),
    ).toBeNull();
    expect(
      deciderFor({ ...model, format: "something-else" as WallModel["format"] }, FEATURE_NAMES),
    ).toBeNull();
    expect(deciderFor(model, FEATURE_NAMES)).not.toBeNull();
  });

  it("returns a probability", () => {
    const p = scoreCandidate(model, new Array(FEATURE_NAMES.length).fill(0));
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
