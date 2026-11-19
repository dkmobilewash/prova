import { describe, expect, it } from "vitest";
import { progressOf, splitsForSave, startReview, verdictsForSave, type Candidate, type SplitRecord } from "./answerKeyReview";
import { restoreSaved, type SavedSheet, type SavedVerdict } from "./restoreSaved";

/**
 * ── A SAVED SPLIT MUST REOPEN AS THE SAME SPLIT (Chrome Round 31, Mid-City A4.0-A4.3) ──
 *
 * Chrome split runs, saved, and on reopen some came back WHOLE and UNREVIEWED
 * while the file still held the halves. Reproduced against the current finder:
 * A4.1 re-applied 10 of 16 recorded splits. The candidates had NOT moved — the
 * true one was still there at exactly the recorded ends. The record was given
 * to the FIRST candidate parallel to it, near its LINE and of similar length,
 * and Mid-City repeats its units, so that was a twin 85-122 ft along the same
 * grid line. The cut fell off the twin, the split was declined, and two
 * reviewed halves became "kept but not shown".
 */
const FPU = 100;
const cand = (id: string, y: number, x1: number, x2: number, thicknessIn = 4): Candidate => ({
  id, x1: x1 / FPU, y1: y / FPU, x2: x2 / FPU, y2: y / FPU, lengthFeet: x2 - x1, thicknessIn, from: "pair", note: "",
});
const sv = (y: number, x1: number, x2: number, verdict: string, wallType?: string): SavedVerdict => ({
  x1: x1 / FPU, y1: y / FPU, x2: x2 / FPU, y2: y / FPU, lengthFeet: x2 - x1, thicknessFeet: 4 / 12, verdict, ...(wallType ? { wallType } : {}),
});
const split = (y: number, x1: number, x2: number, cut: number): SplitRecord => ({
  x1: x1 / FPU, y1: y / FPU, x2: x2 / FPU, y2: y / FPU, lengthFeet: x2 - x1, thicknessIn: 4, cutX: cut / FPU, cutY: y / FPU,
});
const file = (verdicts: SavedVerdict[], splits: SplitRecord[]): SavedSheet => ({ set: "S", sheet: "A4.1", page: 1, feetPerUnit: FPU, verdicts, splits });

/** Twelve-foot walls repeated along one grid line, as Mid-City's units are: the twin at x 0-12 is listed FIRST. */
const repeated = (shift = 0) => [cand("w0", 50, 0, 12), cand("w1", 50, 100 + shift, 112), cand("w2", 70, 0, 30)];
/** The reviewer split the wall at x 100-112 at 108 and judged each half; plus one ordinary decision. */
const saved = () =>
  file([sv(50, 100, 108, "wall", "A"), sv(50, 108, 112, "not-wall"), sv(50, 0, 12, "wall"), sv(70, 0, 30, "wall")], [split(50, 100, 112, 108)]);
const halvesOf = (state: { candidates: Candidate[]; verdicts: Record<string, string> }) =>
  state.candidates.filter((c) => c.y1 === 0.5 && c.x1 >= 1).map((c) => [Math.round(c.x1 * FPU), Math.round(c.x2 * FPU), state.verdicts[c.id]]);

describe("a split saved against one finder output reopens as the same split, reviewed", () => {
  it("cuts the wall it was made on, not a same-length twin further along the same line", () => {
    const got = restoreSaved(saved(), startReview(repeated()), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.splitsReapplied).toBe(1);
    expect(halvesOf(got.state)).toEqual([[100, 108, "wall"], [108, 112, "not-a-wall"]]);
    expect(got.unmatched).toBe(0);
    expect(progressOf(got.state).reviewed).toBe(progressOf(got.state).total);
  });

  it("survives the finder moving the candidate's ends slightly and renumbering every id", () => {
    // Starts 0.6 ft later, ends 0.7 ft sooner (1.3 ft shorter, past the old 0.5 ft tolerance), new ids.
    const moved = [cand("r7", 50, 0, 12), cand("r9", 70, 0, 30), cand("r3", 50, 100.6, 111.3)];
    const got = restoreSaved(saved(), startReview(moved), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.splitsReapplied).toBe(1);
    expect(halvesOf(got.state).map((h) => h[2])).toEqual(["wall", "not-a-wall"]);
    expect(got.unmatched).toBe(0);
    expect(got.state.types?.[got.state.candidates.find((c) => Math.round(c.x2 * FPU) === 108)!.id]).toBe("A");
  });

  it("re-applies a split of a half (a run cut twice)", () => {
    const twice = file(
      [sv(50, 100, 104, "wall"), sv(50, 104, 108, "not-wall"), sv(50, 108, 112, "wall"), sv(50, 0, 12, "wall"), sv(70, 0, 30, "wall")],
      [split(50, 100, 112, 108), split(50, 100, 108, 104)],
    );
    const got = restoreSaved(twice, startReview(repeated()), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.splitsReapplied).toBe(2);
    expect(halvesOf(got.state)).toEqual([[100, 104, "wall"], [104, 108, "not-a-wall"], [108, 112, "wall"]]);
  });
});

describe("a saved decision lands on its own wall or on none", () => {
  it("never on a twin further along the same line (a half on Mid-City matched a wall 100 ft away)", () => {
    // Only the twin is proposed now: the 8 ft half must stay unmatched, not land on it.
    const got = restoreSaved(file([sv(50, 100, 108, "wall")], []), startReview([cand("w0", 50, 0, 12)]), FPU);
    if (!got.ok) throw new Error(got.message);
    expect(got.state.verdicts.w0).toBe("unreviewed");
    expect(got.carried).toHaveLength(1);
  });
});

describe("a reopen followed by a save never drops or changes a saved decision", () => {
  it("writes each split record once, however many times the sheet is reopened and saved", () => {
    let sheet = saved();
    for (let round = 0; round < 3; round += 1) {
      const got = restoreSaved(sheet, startReview(repeated()), FPU);
      if (!got.ok) throw new Error(got.message);
      sheet = { ...sheet, verdicts: [...verdictsForSave(got.state), ...got.carried], splits: splitsForSave(got.state, got.carriedSplits) };
    }
    expect(sheet.splits).toHaveLength(1);
  });

  it("collapses the duplicate records an earlier save already wrote", () => {
    const got = restoreSaved({ ...saved(), splits: [split(50, 100, 112, 108), split(50, 100, 112, 108)] }, startReview(repeated()), FPU);
    if (!got.ok) throw new Error(got.message);
    expect(got.splitsReapplied).toBe(1);
    expect(splitsForSave(got.state, got.carriedSplits)).toHaveLength(1);
  });

  it("keeps a split it cannot re-attach, and its decisions, verbatim through a save", () => {
    // The wall is gone: the finder now proposes a 30 ft run where the 12 ft one was.
    const gone = [cand("w0", 50, 0, 12), cand("w1", 50, 90, 120), cand("w2", 70, 0, 30)];
    const got = restoreSaved(saved(), startReview(gone), FPU);
    if (!got.ok) throw new Error(got.message);
    expect(got.splitsReapplied).toBe(0);
    expect(got.carried).toEqual([sv(50, 100, 108, "wall", "A"), sv(50, 108, 112, "not-wall")]);
    expect(splitsForSave(got.state, got.carriedSplits)).toEqual([split(50, 100, 112, 108)]);
    // Saved again with nothing touched: the file's decisions come back exactly.
    const resaved = [...verdictsForSave(got.state), ...got.carried];
    for (const v of saved().verdicts!) expect(resaved).toContainEqual(v);
  });
});

describe("decisions saved but not re-attached are not counted as unreviewed work", () => {
  it("marks the candidate they lie on as needing a look, and the counter says so", () => {
    const gone = [cand("w0", 50, 0, 12), cand("w1", 50, 90, 120), cand("w2", 70, 0, 30)];
    const got = restoreSaved(saved(), startReview(gone), FPU);
    if (!got.ok) throw new Error(got.message);
    expect(got.state.needsLook).toEqual(["w1"]);
    const p = progressOf(got.state);
    expect(p.needsLook).toBe(1);
    expect(p.total - p.reviewed - p.needsLook).toBe(0);
    expect(got.message).toContain("need a look");
  });

  it("stops counting it as needing a look once the reviewer decides it", () => {
    const gone = [cand("w0", 50, 0, 12), cand("w1", 50, 90, 120), cand("w2", 70, 0, 30)];
    const got = restoreSaved(saved(), startReview(gone), FPU);
    if (!got.ok) throw new Error(got.message);
    const decided = { ...got.state, verdicts: { ...got.state.verdicts, w1: "wall" as const } };
    expect(progressOf(decided).needsLook).toBe(0);
    expect(progressOf(decided).reviewed).toBe(3);
  });

  it("flags nothing on a sheet where everything re-attached", () => {
    const got = restoreSaved(saved(), startReview(repeated()), FPU);
    if (!got.ok) throw new Error(got.message);
    expect(got.state.needsLook ?? []).toEqual([]);
    expect(progressOf(got.state).needsLook).toBe(0);
  });
});
