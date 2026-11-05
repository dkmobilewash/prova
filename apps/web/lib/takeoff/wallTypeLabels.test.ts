import { describe, expect, it } from "vitest";
import { CANT_TELL, addTraced, nextUntyped, removeTraced, setVerdict, setWallType, startReview, tracedWall, type Candidate } from "./answerKeyReview";
import { keyFromLabels } from "./heldOutScore";
import { labelFile } from "./labelRows";
import { restoreSaved } from "./restoreSaved";
import { draftFrom, restoreDraft, reviewSignature } from "./reviewDraft";

// Round 12: which TYPE each wall is, saved beside the verdict so a scorecard
// can grade the finder's type against a person's.
const cand = (id: string, y: number): Candidate => ({ id, x1: 0.1, y1: y, x2: 0.3, y2: y, lengthFeet: 20, thicknessIn: 6, from: "pair", note: "" });
const FPU = 100;

describe("a wall type belongs to an accepted or traced wall", () => {
  const base = setVerdict(setVerdict(startReview([cand("w0", 0.1), cand("w1", 0.2), cand("w2", 0.3)]), ["w0", "w2"], "wall"), ["w1"], "not-a-wall");

  it("is set on an accepted wall, never on a rejected one", () => {
    const s = setWallType(base, ["w0", "w1"], "a3");
    expect(s.types).toEqual({ w0: "A3" });
  });

  it("goes when the wall stops being accepted, or the trace is removed", () => {
    const typed = setWallType(base, ["w0"], "A3");
    expect(setVerdict(typed, ["w0"], "not-a-wall").types).toEqual({});
    const traced = addTraced(typed, tracedWall({ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }, FPU) as Candidate);
    const t = traced.traced[0]!.id;
    const both = setWallType(traced, [t], CANT_TELL);
    expect(both.types?.[t]).toBe("U");
    expect(removeTraced(both, t).types).toEqual({ w0: "A3" });
  });

  it("the next untyped wall skips the typed ones", () => {
    expect(nextUntyped(base, null)).toBe("w0");
    expect(nextUntyped(setWallType(base, ["w0"], "A"), "w0")).toBe("w2");
    expect(nextUntyped(setWallType(base, ["w0", "w2"], "A"), "w2")).toBeNull();
  });
});

describe("the label file carries it, and the key reader exposes it", () => {
  const file = labelFile({
    set: "S", sheet: "A1", page: 1, reviewedBy: "Chrome", secondsSpent: 1, feetPerUnit: FPU, reviewComplete: true, candidates: [], unreviewed: 0,
    verdicts: [
      { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.1, lengthFeet: 20, thicknessFeet: 0.5, verdict: "wall", wallType: "c8b" },
      { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.2, lengthFeet: 20, thicknessFeet: 0.5, verdict: "not-wall", wallType: "A" },
      { x1: 0.1, y1: 0.5, x2: 0.3, y2: 0.5, lengthFeet: 20, thicknessFeet: 0, verdict: "traced", wallType: "U" },
    ],
  });

  it("writes the type on accepted and traced walls only, upper-cased", () => {
    expect(file.verdicts.map((v) => v.wallType)).toEqual(["C8B", undefined, "U"]);
    expect(file.traced.map((t) => t.wallType)).toEqual(["U"]);
  });

  it("keyFromLabels hands it to the scorecard", () => {
    const { key } = keyFromLabels(file);
    expect(key.map((k) => k.wallType).sort()).toEqual(["C8B", "U"]);
  });
});

describe("a saved type comes back", () => {
  it("on the candidate it was saved on, and on a restored trace", () => {
    const fresh = startReview([cand("w0", 0.1), cand("w1", 0.2)]);
    const got = restoreSaved(
      {
        verdicts: [
          { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.1, lengthFeet: 20, thicknessFeet: 0.5, verdict: "wall", wallType: "S6A" },
          { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.2, lengthFeet: 20, thicknessFeet: 0.5, verdict: "not-wall" },
          { x1: 0.1, y1: 0.6, x2: 0.3, y2: 0.6, lengthFeet: 20, verdict: "traced", wallType: "U" },
        ],
      },
      fresh,
      FPU,
    );
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.state.types?.w0).toBe("S6A");
    expect(got.state.types?.[got.state.traced[0]!.id]).toBe("U");
  });

  it("from an unsaved draft too, and a type change is unsaved work", () => {
    const start = startReview([cand("w0", 0.1)]);
    const typed = setWallType(setVerdict(start, ["w0"], "wall"), ["w0"], "B");
    expect(reviewSignature(typed)).not.toBe(reviewSignature(setVerdict(start, ["w0"], "wall")));
    const draft = draftFrom({ state: typed, set: "S", page: 1, finderVersion: "x" })!;
    const back = restoreDraft(JSON.parse(JSON.stringify(draft)), start, FPU);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state.types).toEqual({ w0: "B" });
  });
});
