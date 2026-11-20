import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addOpening, addTraced, setOpeningTag, startReview, tracedWall, undoLastEdit } from "./answerKeyReview";

/**
 * ── ONE UNDO PRESS TAKES BACK THE LAST THING DONE, A TAG INCLUDED (Chrome, Round 39) ──
 *
 * ⌘Z in the labelling tool only ever removed the last trace, so a tag picked for the wrong mark
 * could not be taken back: Chrome mis-tagged two openings and reloaded without saving.
 */
describe("undo in the answer-key review", () => {
  const marked = () => addOpening(addOpening(startReview([]), { x: 0.1, y: 0.1, kind: "window" }), { x: 0.2, y: 0.1, kind: "window" });
  it("takes back a tag, restoring the tag it replaced (or none)", () => {
    const once = setOpeningTag(marked(), "o2", "W1");
    const twice = setOpeningTag(once, "o2", "W2");
    const back = undoLastEdit(twice);
    expect(back.undone).toBe("tag");
    expect(back.state.openings![1]!.tag).toBe("W1");
    expect(undoLastEdit(back.state).state.openings![1]!.tag).toBeUndefined();
  });
  it("undoes in the order things were done: the tag, then the trace before it", () => {
    const traced = addTraced(marked(), tracedWall({ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.5 }, 100));
    const tagged = setOpeningTag(traced, "o1", "W1");
    const one = undoLastEdit(tagged);
    expect([one.undone, one.state.openings![0]!.tag, one.state.traced.length]).toEqual(["tag", undefined, 1]);
    const two = undoLastEdit(one.state);
    expect([two.undone, two.state.traced.length]).toEqual(["trace", 0]);
    expect(undoLastEdit(two.state).undone).toBeNull();
  });
  it("skips an edit whose mark or trace is already gone", async () => {
    const { removeOpening } = await import("./answerKeyReview");
    const s = removeOpening(setOpeningTag(marked(), "o2", "W1"), "o2");
    expect(undoLastEdit(s).undone).toBeNull();
  });
  it("the workspace's one ⌘Z handler undoes through it", () => {
    const src = readFileSync(new URL("../../components/TakeoffWorkspace.tsx", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/undoLastEdit\(review\)/);
  });
});

describe("a reopened sheet starts with nothing to undo", async () => {
  const { restoreSaved } = await import("./restoreSaved");
  it("what came off disk is the baseline: ⌘Z does not take back a restored trace or tag", () => {
    const got = restoreSaved({ set: "S", sheet: "A1", page: 1, feetPerUnit: 100, verdicts: [{ x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.5, lengthFeet: 30, verdict: "traced" }], openings: [{ x: 0.2, y: 0.2, kind: "window", tag: "W1" }] }, startReview([]), 100);
    if (!got.ok) throw new Error(got.message);
    expect(undoLastEdit(got.state).undone).toBeNull();
  });
});
