import { describe, expect, it } from "vitest";
import { demotedRuns, demotedSentence, demotes, type RunVerdict } from "./demotedRuns";

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
