/**
 * ── SCORING A CANDIDATE PAIRING WITH A TRAINED MODEL ──
 *
 * The geometry engine measures well and decides badly: nearly every error left
 * on a real sheet is a decision about whether a pair of lines is a wall. This
 * evaluates a gradient-boosted tree ensemble trained offline on bench
 * candidates, so that decision can be learned rather than written.
 *
 * ── WHY THE MODEL IS A JSON FILE AND NOT A LIBRARY ──
 *
 * Training is scikit-learn (BSD-3) on a laptop; the product carries no
 * runtime dependency at all. A tree is four integer arrays and a float array,
 * and walking one is the twenty lines below — so there is nothing to install,
 * nothing native to build for a serverless target, and no third party in the
 * path of a number a GC is sent.
 *
 * Nothing leaves the machine, at training time or at run time.
 */
import type { WallCandidate } from "./wallVectors";

/** One tree, as scikit-learn's own arrays. `left[n] === -1` marks a leaf. */
export type ModelTree = {
  left: number[];
  right: number[];
  feature: number[];
  threshold: number[];
  value: number[];
};

export type WallModel = {
  format: "gbdt-binary-v1";
  note?: string;
  /** The feature column names, in order, as the model was trained on them. */
  features: string[];
  learningRate: number;
  /** The log-odds of the base rate: where the sum starts. */
  init: number;
  trees: ModelTree[];
};

/** Walks one tree to its leaf. */
function leafOf(tree: ModelTree, features: readonly number[]): number {
  let node = 0;
  // Bounded by the tree's own size: a malformed file cannot spin here.
  for (let step = 0; step < tree.left.length; step += 1) {
    if (tree.left[node] === -1) return tree.value[node];
    node = features[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node] ?? 0;
}

/**
 * The probability this pairing is a wall, between 0 and 1.
 *
 * ── THE FEATURE ORDER IS THE CONTRACT ──
 *
 * `model.features` must equal `FEATURE_NAMES` in order. A mismatch does not
 * throw on its own — every threshold would simply be compared against the
 * wrong column and the result would be confident nonsense — so the caller
 * checks, and `wallClassifier.test.ts` pins it.
 */
export function scoreCandidate(model: WallModel, features: readonly number[]): number {
  let sum = model.init;
  for (const tree of model.trees) sum += model.learningRate * leafOf(tree, features);
  return 1 / (1 + Math.exp(-sum));
}

/**
 * A `decide` hook for `WallFinderOptions`, or null when the model does not
 * match the features this build extracts.
 *
 * Returning null rather than throwing is deliberate: a stale model file should
 * fall back to the rules, which are the shipped behaviour, rather than take a
 * sheet down.
 */
export function deciderFor(
  model: WallModel,
  featureNames: readonly string[],
): ((features: number[], wall: WallCandidate) => number) | null {
  if (model.format !== "gbdt-binary-v1") return null;
  if (model.features.length !== featureNames.length) return null;
  for (let i = 0; i < featureNames.length; i += 1) {
    if (model.features[i] !== featureNames[i]) return null;
  }
  return (features) => scoreCandidate(model, features);
}
