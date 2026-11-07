import { describe, expect, it } from "vitest";
import { decisionsIn, restoreGate, type RestoreBaseline } from "./restoreGate";
import type { Candidate, Verdict } from "./answerKeyReview";

// Hutto A102 (Chrome, 2026-11-07): 450 saved decisions, and the sheet reopened
// with none of them — the restore never ran. The review state arrives in steps:
// empty first, then the finder's candidates with its own pre-rejections.
const candidate = (id: string): Candidate => ({ id, x1: 0, y1: 0, x2: 1, y2: 0, lengthFeet: 10, thicknessIn: 6, from: "pair", note: "" });
function review(count: number, preRejected: number, decidedByHand = 0) {
  const candidates = Array.from({ length: count }, (_, i) => candidate(`c${i}`));
  const verdicts: Record<string, Verdict> = {};
  candidates.forEach((c, i) => (verdicts[c.id] = i < preRejected ? "not-a-wall" : i < preRejected + decidedByHand ? "wall" : "unreviewed"));
  return { candidates, verdicts, traced: [] as Candidate[] };
}

describe("may a saved review be restored onto this sheet?", () => {
  it("YES, ON HUTTO A102'S SEQUENCE: an empty review first, then 450 candidates with 86 pre-rejections", () => {
    let baseline: RestoreBaseline = { key: "", count: 0 };
    const first = restoreGate(baseline, "set#62", review(0, 0));
    expect(first.untouched).toBe(true);
    baseline = first.baseline;
    // The candidates land. Nobody has decided anything: the restore must still run.
    const loaded = restoreGate(baseline, "set#62", review(450, 86));
    expect(loaded.untouched).toBe(true);
    baseline = loaded.baseline;
    // Same state again (another render): still untouched.
    expect(restoreGate(baseline, "set#62", review(450, 86)).untouched).toBe(true);
  });

  it("NO once a person has decided something since the candidates arrived", () => {
    let baseline: RestoreBaseline = { key: "", count: 0 };
    baseline = restoreGate(baseline, "set#62", review(450, 86)).baseline;
    expect(restoreGate(baseline, "set#62", review(450, 86, 1)).untouched).toBe(false);
  });

  it("counts real decisions, not candidates: an unreviewed candidate is not a decision", () => {
    expect(decisionsIn(review(450, 86))).toBe(86);
    expect(decisionsIn({ verdicts: { a: "unreviewed", b: "wall", c: "unsure" }, traced: [candidate("t1")] })).toBe(3);
  });

  it("another sheet starts its own baseline", () => {
    const baseline = restoreGate({ key: "", count: 0 }, "set#62", review(10, 0, 5)).baseline;
    expect(restoreGate(baseline, "set#63", review(10, 2)).untouched).toBe(true);
  });
});
