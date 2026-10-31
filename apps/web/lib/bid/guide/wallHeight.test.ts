import { describe, expect, it } from "vitest";
import { runGeometry } from "@/lib/wall-assemblies";
import { WALL_HEIGHT_CHOICES, parseWallHeightArg, wallHeightArg, wallHeightQuestions, type WallHeightRun, type WallHeightType } from "./wallHeight";

/**
 * The height question is asked exactly where the takeoff produces NOTHING for a
 * measured wall, and its token changes whenever the set of walls it is about
 * does — so an answer can never land on walls the person was not asked about.
 */

const w2: WallHeightType = { id: "wt_w2", code: "W2", defaultHeightFt: null, componentCount: 3 };
const w1: WallHeightType = { id: "wt_w1", code: "W1", defaultHeightFt: 9, componentCount: 3 };
const runs: WallHeightRun[] = [
  { id: "r1", wallTypeId: "wt_w2", lengthFt: 100, heightFt: null },
  { id: "r2", wallTypeId: "wt_w2", lengthFt: 50.5, heightFt: null },
  { id: "r3", wallTypeId: "wt_w2", lengthFt: 20, heightFt: 10 }, // its own height: fine
  { id: "r4", wallTypeId: "wt_w1", lengthFt: 300, heightFt: null }, // the type's default covers it
];

describe("wallHeightQuestions", () => {
  it("asks about a type with no default whose runs have no height, counting only those runs", () => {
    const [question, ...rest] = wallHeightQuestions(runs, [w1, w2]);
    expect(rest).toEqual([]);
    expect(question).toMatchObject({ wallTypeId: "wt_w2", code: "W2", runCount: 2, lengthFt: 150.5 });
    expect(question!.token).toMatch(/^[0-9a-f]{8}$/);
  });

  it("matches the arithmetic: exactly the runs runGeometry cannot price", () => {
    const unpriceable = runs.filter(
      (run) =>
        runGeometry(
          { ...run, label: run.id, openings: [] },
          { id: run.wallTypeId, code: "", sides: 2, studSpacingIn: 16, defaultHeightFt: run.wallTypeId === "wt_w1" ? 9 : null, components: [] } as never,
        ) === null,
    );
    const asked = wallHeightQuestions(runs, [w1, w2]).reduce((sum, q) => sum + q.runCount, 0);
    expect(unpriceable.map((run) => run.id)).toEqual(["r1", "r2"]);
    expect(asked).toBe(unpriceable.length);
  });

  it("asks nothing of a type with a default, with no components, or with every run sized", () => {
    expect(wallHeightQuestions(runs, [{ ...w2, defaultHeightFt: 10 }])).toEqual([]);
    expect(wallHeightQuestions(runs, [{ ...w2, componentCount: 0 }])).toEqual([]);
    expect(wallHeightQuestions(runs.filter((run) => run.heightFt !== null), [w2])).toEqual([]);
    // a zero height is no height (runHeight's own rule)
    expect(wallHeightQuestions([{ id: "z", wallTypeId: "wt_w2", lengthFt: 5, heightFt: 0 }], [{ ...w2, defaultHeightFt: 0 }])).toHaveLength(1);
  });

  it("sorts by code", () => {
    const w0 = { ...w2, id: "wt_w0", code: "A1" };
    const both = wallHeightQuestions([...runs, { id: "r9", wallTypeId: "wt_w0", lengthFt: 1, heightFt: null }], [w2, w0]);
    expect(both.map((q) => q.code)).toEqual(["A1", "W2"]);
  });

  it("the token follows the set of walls and nothing else", () => {
    const token = (r: WallHeightRun[]) => wallHeightQuestions(r, [w2])[0]?.token;
    const base = token(runs);
    expect(token([...runs].reverse())).toBe(base); // order does not matter
    expect(token(runs.map((run) => (run.id === "r1" ? { ...run, lengthFt: 999 } : run)))).toBe(base); // a re-measure is the same walls
    expect(token([...runs, { id: "r5", wallTypeId: "wt_w2", lengthFt: 10, heightFt: null }])).not.toBe(base); // a run added
    expect(token(runs.map((run) => (run.id === "r1" ? { ...run, heightFt: 9 } : run)))).not.toBe(base); // a run sized
  });
});

describe("the arg", () => {
  const question = { wallTypeId: "wt_w2", token: "0a1b2c3d" };

  it("round-trips every offered height", () => {
    for (const heightFt of WALL_HEIGHT_CHOICES) {
      expect(parseWallHeightArg(wallHeightArg(question, heightFt))).toEqual({ wallTypeId: "wt_w2", heightFt, token: "0a1b2c3d" });
    }
  });

  it("refuses a height that was not offered, and anything malformed", () => {
    for (const bad of [
      "wh:wt_w2:11:0a1b2c3d",
      "wh:wt_w2:0:0a1b2c3d",
      "wh:wt_w2:9.5:0a1b2c3d",
      "wh:wt_w2:9:zzzz",
      "wt:wt_w2:9:0a1b2c3d",
      "wh:wt w2:9:0a1b2c3d",
      "",
      undefined,
      42,
    ]) {
      expect(parseWallHeightArg(bad), String(bad)).toBeNull();
    }
  });
});
