import { describe, expect, it } from "vitest";
import { demotedRuns, demotedSentence, demotedWord, demotes, modelVerdicts, type RunVerdict } from "./demotedRuns";
import { FEATURE_NAMES } from "./wallFeatures";
import type { WallModel } from "./wallClassifier";

const runs = [{ lengthFeet: 10 }, { lengthFeet: 20.4 }, { lengthFeet: 30 }, { lengthFeet: 5 }];

describe("demotedRuns", () => {
  it("lists only casework and reference, in run order, with the run's length", () => {
    const v = new Map<number, RunVerdict>([
      [2, { label: "REFERENCE", reason: "a dimension line" }],
      [0, { label: "WALL", reason: "" }],
      [1, { label: "CASEWORK", reason: "a counter" }],
      [3, { label: "UNSURE", reason: "" }],
    ]);
    expect(demotedRuns(v, runs)).toEqual([
      { at: 1, label: "CASEWORK", reason: "a counter", lengthFeet: 20.4 },
      { at: 2, label: "REFERENCE", reason: "a dimension line", lengthFeet: 30 },
    ]);
    expect(demotes("WALL")).toBe(false);
    expect(demotes("UNSURE")).toBe(false);
  });
  it("is empty before a check, and drops a verdict for a run that no longer exists", () => {
    expect(demotedRuns(null, runs)).toEqual([]);
    expect(demotedRuns(new Map([[9, { label: "CASEWORK", reason: "" }]]), runs)).toEqual([]);
  });
  it("accepting is the verdict becoming WALL: the run leaves the list", () => {
    const v = new Map<number, RunVerdict>([[1, { label: "CASEWORK", reason: "a counter" }]]);
    v.set(1, { label: "WALL", reason: "accepted" });
    expect(demotedRuns(v, runs)).toEqual([]);
  });
  it("says how many and how many feet are out of the total", () => {
    const list = demotedRuns(
      new Map<number, RunVerdict>([
        [1, { label: "CASEWORK", reason: "" }],
        [2, { label: "REFERENCE", reason: "" }],
      ]),
      runs,
    );
    expect(demotedSentence(list)).toBe("2 runs probably not walls — 50 ft, not in the total.");
    expect(demotedSentence(list.slice(0, 1))).toBe("1 run probably not a wall — 20 ft, not in the total.");
  });
});

/** One stump on lengthPercentile (column 2): short runs score 0.119 (shown floored, 0.11), long ones 0.88. */
const stump: WallModel = {
  format: "gbdt-binary-v1",
  features: [...FEATURE_NAMES],
  learningRate: 1,
  init: 0,
  trees: [{ left: [1, -1, -1], right: [2, -1, -1], feature: [2, 0, 0], threshold: [0.3, 0, 0], value: [0, -2, 2] }],
};
const feat = (lengthPercentile: number) => FEATURE_NAMES.map((_, i) => (i === 2 ? lengthPercentile : 0));

describe("modelVerdicts", () => {
  const run = (x1: number, x2: number) => ({ x1, y1: 0.5, x2, y2: 0.5, thicknessFeet: 0.5 });
  it("demotes a run whose every pairing scores below the cut, with the best score in the reason, floored", () => {
    const edge = { ...stump, init: Math.log(0.296 / 0.704), trees: [] };
    const atEdge = modelVerdicts(edge, 0.3, [run(0.1, 0.3)], [{ ...run(0.1, 0.3), features: feat(0.1) }], 100);
    expect(atEdge.get(0)?.reason, "0.296 must not print as the cut itself").toContain("(score 0.29)");
    const runs = [run(0.1, 0.3), run(0.4, 0.9)];
    const pairings = [
      { ...run(0.1, 0.3), features: feat(0.1) },
      { ...run(0.4, 0.6), features: feat(0.2) },
      { ...run(0.6, 0.9), features: feat(0.9) },
    ];
    const v = modelVerdicts(stump, 0.3, runs, pairings, 100);
    expect([...v.keys()]).toEqual([0]);
    expect(v.get(0)?.reason).toBe("the wall model doubts this one (score 0.11)");
    expect(demotes("MODEL")).toBe(true);
    expect(demotedWord("MODEL")).toBeNull();
  });
  it("leaves alone a run with no pairing of its own, and a pairing on another line", () => {
    const runs = [run(0.1, 0.3)];
    const far = { x1: 0.1, y1: 0.7, x2: 0.3, y2: 0.7, thicknessFeet: 0.5, features: feat(0.1) };
    expect(modelVerdicts(stump, 0.3, runs, [far], 100).size).toBe(0);
    expect(modelVerdicts(stump, 0.3, runs, [], 100).size).toBe(0);
  });
  it("the AI second opinion overwrites a model verdict: WALL puts the run back", () => {
    const v = modelVerdicts(stump, 0.3, [run(0.1, 0.3)], [{ ...run(0.1, 0.3), features: feat(0.1) }], 100);
    v.set(0, { label: "WALL", reason: "a wall" });
    expect(demotedRuns(v, [{ lengthFeet: 20 }])).toEqual([]);
  });
});
