import { describe, expect, it } from "vitest";
import { addOpening, keyFromReview, NO_TAG, removeOpening, setOpeningTag, startReview } from "./answerKeyReview";
import { labelFile } from "./labelRows";
import { restoreSaved } from "./restoreSaved";
import { draftFrom, keepReview, restoreDraft, reviewSignature, hasUnsavedWork } from "./reviewDraft";
import { keyFromLabels, scoreOpenings } from "./heldOutScore";

// Round 13: the answer key holds a person's window marks with their tags, from
// the click to the file and back, and they score as points.
const marked = () => {
  let s = addOpening(startReview([]), { x: 0.2, y: 0.3, kind: "window" });
  s = addOpening(s, { x: 0.5, y: 0.3, kind: "window" });
  s = setOpeningTag(s, "o1", " w2 ");
  return setOpeningTag(s, "o2", NO_TAG);
};

describe("window marks in the review", () => {
  it("adds, tags (upper-cased) and removes, and never reuses an id", () => {
    let s = marked();
    expect(s.openings).toEqual([{ id: "o1", x: 0.2, y: 0.3, kind: "window", tag: "W2" }, { id: "o2", x: 0.5, y: 0.3, kind: "window", tag: "-" }]);
    s = removeOpening(s, "o1");
    s = addOpening(s, { x: 0.9, y: 0.9, kind: "window" });
    expect(s.openings!.map((o) => o.id)).toEqual(["o2", "o3"]);
    expect(setOpeningTag(s, "o3", "  ").openings![1]).toEqual({ id: "o3", x: 0.9, y: 0.9, kind: "window" });
  });

  it("goes into the saved file with the tag normalised, and the key", () => {
    const file = labelFile({ set: "S", sheet: "A1", page: 1, reviewedBy: "R", secondsSpent: 0, feetPerUnit: 100, reviewComplete: false, candidates: [], verdicts: [], unreviewed: 0, openings: [{ x: 0.2, y: 0.3, kind: "window", tag: " w2" }, { x: 1, y: 1, kind: "skylight" }] });
    expect(file.openings).toEqual([{ x: 0.2, y: 0.3, kind: "window", tag: "W2" }]);
    expect(keyFromReview(marked(), { set: "S", page: 1, number: "A1", reviewedBy: "R", reviewedAt: "t", feetPerUnit: 100 }).openings).toEqual([{ x: 0.2, y: 0.3, kind: "window", tag: "W2" }, { x: 0.5, y: 0.3, kind: "window", tag: "-" }]);
  });

  it("comes back from a saved file that holds only windows", () => {
    const back = restoreSaved({ verdicts: [], openings: [{ x: 0.2, y: 0.3, kind: "window", tag: "W2" }] }, startReview([]), 100);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state.openings).toEqual([{ id: "o1", x: 0.2, y: 0.3, kind: "window", tag: "W2" }]);
  });

  it("is kept in a draft, counts as unsaved work, changes the signature, and survives a re-read", () => {
    const s = marked();
    const draft = draftFrom({ state: s, set: "S", page: 1, finderVersion: "v" });
    expect(draft).not.toBeNull();
    const back = restoreDraft(draft!, startReview([]), 100);
    expect(back.ok && back.state.openings).toEqual(s.openings);
    expect(hasUnsavedWork(s)).toBe(true);
    expect(reviewSignature(s)).not.toBe(reviewSignature(setOpeningTag(s, "o1", "W3")));
    const reread = startReview([{ id: "w0", x1: 0, y1: 0, x2: 1, y2: 0, lengthFeet: 9, thicknessIn: 5, from: "pair", note: "" }]);
    expect(keepReview(s, reread).openings).toEqual(s.openings);
  });
});

describe("window marks as a key, scored", () => {
  it("reads them out of a label file", () => {
    expect(keyFromLabels({ verdicts: [], openings: [{ x: 0.2, y: 0.3, kind: "window", tag: "W2" }] }).openings).toEqual([{ x: 0.2, y: 0.3, kind: "window", tag: "W2" }]);
  });

  it("matches nearest within 2 ft, one to one, and grades only real tags", () => {
    const key = [{ x: 0.1, y: 0.1, kind: "window" as const, tag: "W1" }, { x: 0.2, y: 0.1, kind: "window" as const, tag: "-" }, { x: 0.5, y: 0.5, kind: "window" as const, tag: "W2" }];
    // 100 ft per unit: 2 ft is 0.02.
    const found = [{ x: 0.105, y: 0.1, kind: "window" as const, tag: "W1" }, { x: 0.108, y: 0.1, kind: "window" as const, tag: "W1" }, { x: 0.21, y: 0.1, kind: "window" as const, tag: "W9" }, { x: 0.9, y: 0.9, kind: "window" as const }];
    expect(scoreOpenings(key, found, "window", 100)).toEqual({ key: 3, found: 2, missed: 1, false: 2, tagged: 1, tagCorrect: 1 });
  });
});
