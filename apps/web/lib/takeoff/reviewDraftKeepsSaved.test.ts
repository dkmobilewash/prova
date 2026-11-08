import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { candidatesInBox, setVerdict, setWallType, startReview, sweepVerdict, type Candidate, type ReviewState } from "./answerKeyReview";
import { restoreSaved } from "./restoreSaved";
import { draftFrom, restoreDraft } from "./reviewDraft";

/**
 * ── A DRAFT MUST NOT UNDO A SAVED DECISION IT NEVER MADE ──
 *
 * Found while hunting Hutto A102's 13 lost walls, and a hole of the same kind
 * though not that one: "Restore unsaved review" put a draft's EVERY verdict over
 * the restored file, including the ones the draft only held at the finder's
 * starting mark (unreviewed, or not-a-wall for the shorter of a duplicate pair).
 * On an invented sheet: a duplicate pair the saved file accepts both halves of.
 */
const FPU = 100; // feet per page-width unit
const cand = (id: string, x1: number, y1: number, x2: number, y2: number): Candidate => ({
  id, x1, y1, x2, y2, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU, thicknessIn: 5, from: "pair", note: "",
});
// One wall offered twice (0.4 in apart, the shorter fully alongside), and a wall elsewhere.
const candidates = [cand("0", 0.1, 0.1, 0.3, 0.1), cand("1", 0.12, 0.10033, 0.28, 0.10033), cand("2", 0.1, 0.3, 0.3, 0.3)];
const walls = (s: ReviewState) => Object.values(s.verdicts).filter((v) => v === "wall").length;
const asSaved = (s: ReviewState) => ({
  verdicts: s.candidates.map((c) => ({ x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, lengthFeet: c.lengthFeet, thicknessFeet: (c.thicknessIn ?? 0) / 12, verdict: s.verdicts[c.id] === "wall" ? "wall" : "not-wall" })),
});

describe("restoring a draft over a restored saved file", () => {
  it("keeps the saved 'wall' where the draft only holds the duplicate pre-mark, and still applies the draft's real decisions", () => {
    const fresh = startReview(candidates, FPU);
    expect(fresh.duplicates.map((p) => p.drop), "the fixture must be a duplicate pair").toEqual(["1"]);
    // The saved file: the reviewer overruled the rule and accepted both halves, and the other wall.
    const saved = asSaved(setVerdict(fresh, ["0", "1", "2"], "wall"));
    // An earlier session's draft: the shorter half never decided (still the pre-mark), the
    // longer accepted and typed, and wall 2 REJECTED — a real decision the draft did make.
    const earlier = setWallType(setVerdict(setVerdict(fresh, ["0"], "wall"), ["2"], "not-a-wall"), ["0"], "C6");
    const draft = draftFrom({ state: earlier, set: "S", page: 1, finderVersion: "old" })!;
    // Today: the file restores, then Restore unsaved review.
    const restored = restoreSaved(saved, fresh, FPU);
    if (!restored.ok) throw new Error(restored.message);
    expect(walls(restored.state)).toBe(3);
    const got = restoreDraft(draft, restored.state, FPU);
    if (!got.ok) throw new Error(got.why);
    expect(got.state.verdicts["1"], "the draft's pre-mark undid a saved decision").toBe("wall");
    expect(got.state.verdicts["2"], "the draft's own decision must still land").toBe("not-a-wall");
    expect(got.state.types?.["0"]).toBe("C6");
  });
});

/**
 * ── HUTTO A102, THE SEQUENCE THAT LOST THE 13 WALLS (local only) ──
 *
 * Not the draft above: the 13 are not duplicate halves in either form of the
 * rule (checked against the sheet's own strokes). They are exactly the accepted
 * walls whose midpoints fall in two rectangles that hold no other accepted wall
 * — the answer-key box, which rejected whatever it caught. Replayed on Hutto's
 * own files where they exist; Hutto is held-out and nothing of it is in the repo.
 */
const B = "/Users/diego/Claude Folder/takeoff/labels-backup";
const ORIGINAL = `${B}/hutto-A102-20261107-1518/A102.json`;
const CHROME = `${B}/hutto-A102-chrome-20261108-1321.json`;
describe.skipIf(!existsSync(ORIGINAL) || !existsSync(CHROME))("Hutto A102, the exact sequence (local only)", () => {
  it("restore 239 → two box drags over accepted walls → save: still 239, and the old sweep would have written Chrome's 226", () => {
    const original = JSON.parse(readFileSync(ORIGINAL, "utf8"));
    const chrome = JSON.parse(readFileSync(CHROME, "utf8"));
    const fpu = original.feetPerUnit as number;
    const list: Candidate[] = original.verdicts.map((v: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number }, i: number) => ({ id: String(i), x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, lengthFeet: v.lengthFeet, thicknessIn: v.thicknessFeet * 12, from: "pair" as const, note: "" }));
    const restored = restoreSaved(original, startReview(list, fpu), fpu);
    if (!restored.ok) throw new Error(restored.message);
    expect(walls(restored.state)).toBe(239);
    // The two rectangles that catch exactly the 13 (their midpoints) and no other accepted wall.
    const boxes = [{ x1: 0.3395, y1: 0.1455, x2: 0.4400, y2: 0.2625 }, { x1: 0.3400, y1: 0.0890, x2: 0.3412, y2: 0.0905 }];
    let now = restored.state;
    let old = restored.state;
    for (const box of boxes) {
      const ids = candidatesInBox(now, box);
      now = sweepVerdict(now, ids, "not-a-wall").state;
      old = setVerdict(old, candidatesInBox(old, box), "not-a-wall");
    }
    expect(walls(now), "a sweep reversed accepted walls").toBe(239);
    // The control: the old gesture, on the same boxes, reproduces Chrome's file verdict for verdict.
    expect(walls(old)).toBe(226);
    const flipped = list.filter((c) => old.verdicts[c.id] !== now.verdicts[c.id]).map((c) => c.id);
    const chromeFlipped = list.filter((_, i) => original.verdicts[i].verdict !== chrome.verdicts[i].verdict).map((c) => c.id);
    expect(flipped).toEqual(chromeFlipped);
  });
});
