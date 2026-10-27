import { describe, expect, it } from "vitest";
import {
  BOARD_LAYER_CHOICES,
  boardLayerQuestions,
  boardLayersArg,
  parseBoardLayersArg,
  type BoardLayerRun,
  type BoardLayerType,
} from "./boardLayers";
import { wallHeightQuestions } from "./wallHeight";

/**
 * The board-layer question is asked only where an answer would MOVE a
 * quantity — a type with a per-layer part and no answer yet — and its token
 * changes whenever the set of walls it is about does, so an answer can never
 * land on walls the person was not asked about.
 */

const w2: BoardLayerType = { id: "wt_w2", code: "W2", sides: 2, boardLayers: null, perLayerCount: 1 };
const w1: BoardLayerType = { id: "wt_w1", code: "W1", sides: 2, boardLayers: 1, perLayerCount: 1 };
const runs: BoardLayerRun[] = [
  { id: "r1", wallTypeId: "wt_w2", lengthFt: 100 },
  { id: "r2", wallTypeId: "wt_w2", lengthFt: 50.5 },
  { id: "r3", wallTypeId: "wt_w1", lengthFt: 300 }, // W1 is answered
];

describe("boardLayerQuestions", () => {
  it("asks about an unanswered type with a per-layer part, counting every run of it here", () => {
    const [question, ...rest] = boardLayerQuestions(runs, [w1, w2]);
    expect(rest).toEqual([]);
    expect(question).toMatchObject({ wallTypeId: "wt_w2", code: "W2", sides: 2, runCount: 2, lengthFt: 150.5 });
    expect(question!.token).toMatch(/^[0-9a-f]{8}$/);
  });

  it("asks nothing of an answered type, one with no per-layer part, or one with no runs on the job", () => {
    expect(boardLayerQuestions(runs, [{ ...w2, boardLayers: 2 }])).toEqual([]);
    // No per-layer part: no answer would change any quantity — a legend-made
    // type, whose board factor already IS the layer count, is this case.
    expect(boardLayerQuestions(runs, [{ ...w2, perLayerCount: 0 }])).toEqual([]);
    expect(boardLayerQuestions(runs.filter((run) => run.wallTypeId !== "wt_w2"), [w2])).toEqual([]);
  });

  it("carries a one-sided type's sides, so the words can say so", () => {
    expect(boardLayerQuestions(runs, [{ ...w2, sides: 1 }])[0]!.sides).toBe(1);
  });

  it("sorts by code", () => {
    const a1 = { ...w2, id: "wt_a1", code: "A1" };
    const both = boardLayerQuestions([...runs, { id: "r9", wallTypeId: "wt_a1", lengthFt: 1 }], [w2, a1]);
    expect(both.map((q) => q.code)).toEqual(["A1", "W2"]);
  });

  it("the token follows the set of walls and nothing else", () => {
    const token = (r: BoardLayerRun[]) => boardLayerQuestions(r, [w2])[0]?.token;
    const base = token(runs);
    expect(token([...runs].reverse())).toBe(base); // order does not matter
    expect(token(runs.map((run) => (run.id === "r1" ? { ...run, lengthFt: 999 } : run)))).toBe(base); // a re-measure is the same walls
    expect(token([...runs, { id: "r5", wallTypeId: "wt_w2", lengthFt: 10 }])).not.toBe(base); // a run added
    expect(token(runs.filter((run) => run.id !== "r2"))).not.toBe(base); // a run removed
  });

  it("is not the height question's token for the same walls, so one answer's token cannot pass for the other's", () => {
    const heightless = runs.map((run) => ({ ...run, heightFt: null }));
    const height = wallHeightQuestions(heightless, [{ id: "wt_w2", code: "W2", defaultHeightFt: null, componentCount: 3 }])[0]!;
    const layers = boardLayerQuestions(runs, [w2])[0]!;
    expect(height.runCount).toBe(layers.runCount); // the same two walls
    expect(layers.token).not.toBe(height.token);
  });
});

describe("the arg", () => {
  const question = { wallTypeId: "wt_w2", token: "0a1b2c3d" };

  it("round-trips every offered count", () => {
    expect(BOARD_LAYER_CHOICES).toEqual([1, 2]);
    for (const layers of BOARD_LAYER_CHOICES) {
      expect(parseBoardLayersArg(boardLayersArg(question, layers))).toEqual({ wallTypeId: "wt_w2", layers, token: "0a1b2c3d" });
    }
  });

  it("refuses a count that was not offered, and anything malformed", () => {
    for (const bad of [
      "bl:wt_w2:3:0a1b2c3d", // a real answer, but one the library takes, not a tap
      "bl:wt_w2:0:0a1b2c3d",
      "bl:wt_w2:12:0a1b2c3d",
      "bl:wt_w2:1.5:0a1b2c3d",
      "bl:wt_w2:2:zzzz",
      "wh:wt_w2:2:0a1b2c3d", // the height question's arg
      "bl:wt w2:2:0a1b2c3d",
      "",
      undefined,
      2,
    ]) {
      expect(parseBoardLayersArg(bad), String(bad)).toBeNull();
    }
  });
});
