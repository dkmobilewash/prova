import { describe, expect, it } from "vitest";
import { actionsToExact, heightAnswersPerJob, type ActionsInput } from "./actionsToExact";

/**
 * Build gate 3 of prereg-scoreboard-v3.md: a PERFECT draft scores zero, and every
 * term B / E / J / L / R / M / H is pinned by a case that moves it alone — so
 * dropping any term from the sum turns a test red.
 */

const KEY2: ActionsInput["key"] = [
  { missed: false, type: "A1", knownFeet: 10 },
  { missed: false, type: "A1", knownFeet: 10 },
];
const realRun = (keyIndex: number, heightFeet = 10) => ({ lengthFeet: 10, held: false, junk: false, heightFeet, keyIndex });
const junkRun = () => ({ lengthFeet: 10, held: false, junk: true, heightFeet: 10, keyIndex: -1 });
const base = (over: Partial<ActionsInput>): ActionsInput => ({
  runs: [realRun(0), realRun(1)],
  key: KEY2,
  boxOptions: [],
  likeClasses: () => [],
  ...over,
});

describe("actions to exact", () => {
  it("scores a PERFECT draft at zero", () => {
    const r = actionsToExact(base({}));
    expect(r).toMatchObject({ actions: 0, B: 0, E: 0, J: 0, L: 0, R: 0, M: 0, H: 0 });
  });

  it("J: one posted junk run costs one remove", () => {
    const r = actionsToExact(base({ runs: [realRun(0), realRun(1), junkRun()] }));
    expect(r).toMatchObject({ actions: 1, J: 1 });
  });

  it("R: one HELD real run costs one restore", () => {
    const r = actionsToExact(base({ runs: [realRun(0), { ...realRun(1), held: true }] }));
    expect(r).toMatchObject({ actions: 1, R: 1 });
  });

  it("M: one key wall nothing covers costs one add", () => {
    const r = actionsToExact(base({ runs: [realRun(0)], key: [KEY2[0]!, { ...KEY2[1]!, missed: true }] }));
    expect(r).toMatchObject({ actions: 1, M: 1 });
  });

  it("H: a key-known type off by more than 0.25 ft costs ONE answer for the whole type", () => {
    const r = actionsToExact(base({ runs: [realRun(0, 9), realRun(1, 9)] }));
    expect(r).toMatchObject({ actions: 1, H: 1 });
  });

  it("H: a height the key does not know is never graded", () => {
    const r = actionsToExact(base({ runs: [realRun(0, 9)], key: [{ missed: false, type: "A1", knownFeet: null }] }));
    expect(r.H).toBe(0);
  });

  it("B + L: a box is taken only when it beats removing junk by hand, and a real wall it cuts is one restore", () => {
    const runs = [realRun(0), realRun(1), junkRun(), junkRun(), junkRun(), junkRun()];
    // the box keeps both reals but one only 40% inside: 1 box + 1 restore beats 4 removes
    const inside = new Map<number, number>([[0, 10], [1, 4]]);
    const r = actionsToExact(base({ runs, boxOptions: [{ boxes: 1, insideFeet: inside }] }));
    expect(r).toMatchObject({ B: 1, J: 0, L: 1, actions: 2 });
  });

  it("B: a box that saves nothing is not taken", () => {
    const runs = [realRun(0), realRun(1), junkRun()];
    const inside = new Map<number, number>([[0, 10], [1, 10]]);
    const r = actionsToExact(base({ runs, boxOptions: [{ boxes: 1, insideFeet: inside }] }));
    expect(r).toMatchObject({ B: 0, J: 1, actions: 1 });
  });

  it("E + L: a like-click is taken when it nets a saving, and the real wall it sweeps is charged as a loss", () => {
    const runs = [realRun(0), realRun(1), junkRun(), junkRun(), junkRun()];
    const r = actionsToExact(base({ runs, likeClasses: () => [[1, 2, 3, 4]] }));
    // 3 junk gone for 1 click + 1 real restore = 2, beating 3 removes
    expect(r).toMatchObject({ E: 1, J: 0, L: 1, actions: 2 });
  });

  it("E: a like-click that sweeps as much real as junk is never taken", () => {
    const runs = [realRun(0), realRun(1), junkRun(), junkRun()];
    const r = actionsToExact(base({ runs, likeClasses: () => [[0, 1, 2, 3]] }));
    expect(r).toMatchObject({ E: 0, J: 2, actions: 2 });
  });
});

/**
 * W2 heights (coordination/type-height-once.md, REVIEWED by the original 2026-11-28; Diego's job-level measure): the
 * height answers a JOB needs. One entry per (type × level item) that needs an answer, with its key height; OFF is one per
 * distinct item; ON merges a non-structure, positively schedule-free type into 1 + its items whose key height differs
 * from the best single answer by more than 0.25 ft. Anything not positively schedule-free, or to-structure, counts as OFF.
 */
describe("height answers per job (OFF vs ON)", () => {
  const it9 = (level: string, keyFeet = 9, over: Partial<{ structure: boolean; scheduleFree: boolean; type: string }> = {}) => ({ type: "A", level, keyFeet, structure: false, scheduleFree: true, ...over });
  it("OFF counts distinct (type × level) — two sheets of one level are one item", () => {
    expect(heightAnswersPerJob([it9("2"), it9("2"), it9("5")])).toMatchObject({ off: 2 });
  });
  it("ON counts a schedule-free, non-structure type once when its levels agree", () => {
    expect(heightAnswersPerJob([it9("2"), it9("5"), it9("8")])).toEqual({ off: 3, on: 1 });
  });
  it("ON = 1 + the levels whose key height differs from the answer by more than 0.25 ft (9 ft and 10 ft gives 2)", () => {
    expect(heightAnswersPerJob([it9("2", 9), it9("5", 10)])).toEqual({ off: 2, on: 2 });
    expect(heightAnswersPerJob([it9("2", 9), it9("5", 9.2), it9("8", 10)])).toEqual({ off: 3, on: 2 });
  });
  it("the answer is the key height that minimises the count, ties to the lower — so 9, 9, 10 answers 9 and counts 2", () => {
    expect(heightAnswersPerJob([it9("2", 10), it9("5", 9), it9("8", 9)])).toEqual({ off: 3, on: 2 });
  });
  it("a type NOT positively schedule-free counts as OFF (unknown is defaulted)", () => {
    expect(heightAnswersPerJob([it9("2", 9, { scheduleFree: false }), it9("5", 9, { scheduleFree: false })])).toEqual({ off: 2, on: 2 });
  });
  it("a to-structure type counts as OFF", () => {
    expect(heightAnswersPerJob([it9("2", 9, { structure: true }), it9("5", 9, { structure: true })])).toEqual({ off: 2, on: 2 });
  });
  it("types are counted separately", () => {
    expect(heightAnswersPerJob([it9("2"), it9("5"), it9("2", 9, { type: "B" }), it9("5", 9, { type: "B" })])).toEqual({ off: 4, on: 2 });
  });
  it("nothing needing an answer is zero both ways", () => {
    expect(heightAnswersPerJob([])).toEqual({ off: 0, on: 0 });
  });
});
