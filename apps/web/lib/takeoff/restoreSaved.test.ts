import { describe, expect, it } from "vitest";
import { startReview, type Candidate } from "./answerKeyReview";
import {
  MIN_MATCH_SHARE,
  candidateFor,
  restoreSaved,
  type SavedSheet,
  type SavedVerdict,
} from "./restoreSaved";

/**
 * ── WHAT THIS HAS TO GET RIGHT ──
 *
 * Reopening a labelled sheet has exactly two failure modes worth fearing, and
 * they pull against each other.
 *
 * Restore too little and the reviewer re-decides two hundred candidates by
 * hand. Restore the WRONG candidate and a verdict moves to a different wall —
 * silently, on a file that is somebody's answer key — which is worse than not
 * restoring at all. That is why the match needs direction, length and a band
 * rather than nearest-anything, and why a poor match refuses outright instead
 * of restoring what it can.
 */
const FPU = 100;

const cand = (id: string, y: number, x1: number, x2: number, thicknessIn: number | null): Candidate => ({
  id,
  x1: x1 / FPU,
  y1: y / FPU,
  x2: x2 / FPU,
  y2: y / FPU,
  lengthFeet: x2 - x1,
  thicknessIn,
  from: "pair",
  note: "",
});

const sv = (
  y: number,
  x1: number,
  x2: number,
  verdict: string,
  thicknessFeet = 0,
): SavedVerdict => ({
  x1: x1 / FPU,
  y1: y / FPU,
  x2: x2 / FPU,
  y2: y / FPU,
  lengthFeet: x2 - x1,
  thicknessFeet,
  verdict,
});

const file = (verdicts: SavedVerdict[], extra: Partial<SavedSheet> = {}): SavedSheet => ({
  set: "S",
  sheet: "A1",
  page: 1,
  feetPerUnit: FPU,
  verdicts,
  ...extra,
});

describe("matching a saved decision to a candidate", () => {
  const candidates = [
    cand("w0", 10, 0, 40, 6),
    cand("w1", 20, 0, 40, 6),
    cand("w2", 30, 0, 12, 4),
  ];

  it("finds the candidate on the same wall", () => {
    const hit = candidateFor(sv(10, 0, 40, "wall"), candidates, FPU, new Set());
    expect(hit?.id).toBe("w0");
  });

  it("takes the NEAREST when two are within the band", () => {
    // Two walls 10 ft apart, a saved decision 1 ft off the first. Without
    // nearest-wins, iteration order decides which wall gets the verdict.
    const hit = candidateFor(sv(11, 0, 40, "wall"), candidates, FPU, new Set());
    expect(hit?.id).toBe("w0");
  });

  it("refuses a wall a room away", () => {
    expect(candidateFor(sv(60, 0, 40, "wall"), candidates, FPU, new Set())).toBeNull();
  });

  it("refuses a candidate at a different LENGTH on the same line", () => {
    // ── A SHORT RUN LYING ON A LONG WALL IS NOT THAT WALL ──
    //
    // Without the length test this matches: it is parallel and its ends are
    // nearly on the line. A 12 ft decision would then claim a 40 ft wall.
    expect(candidateFor(sv(10, 0, 12, "wall"), candidates, FPU, new Set())).toBeNull();
  });

  it("will not give one candidate to two saved decisions", () => {
    const taken = new Set(["w0"]);
    expect(candidateFor(sv(10, 0, 40, "wall"), candidates, FPU, taken)).toBeNull();
  });

  it("matches a FACE-traced thick wall to its centre line", () => {
    // The thickness-aware band, same reason as the scorer: a reviewer draws a
    // face, the finder proposes the centre.
    const thick = [cand("m0", 10, 0, 40, 36)];
    const hit = candidateFor(sv(11.5, 0, 40, "wall", 3), thick, FPU, new Set());
    expect(hit?.id).toBe("m0");
  });
});

describe("restoring a saved sheet", () => {
  const fresh = () => startReview([cand("w0", 10, 0, 40, 6), cand("w1", 20, 0, 40, 6), cand("w2", 30, 0, 12, 4)]);

  it("brings back decisions AND traces", () => {
    const got = restoreSaved(
      file([
        sv(10, 0, 40, "wall"),
        sv(20, 0, 40, "not-wall"),
        sv(30, 0, 12, "unsure"),
        sv(50, 0, 25, "traced"),
      ]),
      fresh(),
      FPU,
    );
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.decisions).toBe(3);
    expect(got.traces).toBe(1);
    expect(got.state.verdicts.w0).toBe("wall");
    expect(got.state.verdicts.w1).toBe("not-a-wall");
    expect(got.state.verdicts.w2).toBe("unsure");
    expect(got.state.traced).toHaveLength(1);
    expect(got.state.traced[0].lengthFeet).toBeCloseTo(25);
  });

  it("restores a sheet whose only saved work is traces", () => {
    // The case Chrome is about to hit: come back and add traces to a sheet
    // that was fully decided, so the decisions are all that need matching.
    const got = restoreSaved(file([sv(10, 0, 40, "wall"), sv(50, 0, 25, "traced")]), fresh(), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.traces).toBe(1);
  });

  it("REFUSES rather than restore half a review", () => {
    // Three of four decisions land nowhere: 25% matched, far under the floor.
    const got = restoreSaved(
      file([sv(10, 0, 40, "wall"), sv(60, 0, 40, "wall"), sv(70, 0, 40, "wall"), sv(80, 0, 40, "wall")], {
        finderVersion: "deadbeefcafe0000",
      }),
      fresh(),
      FPU,
    );
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.message).toContain("1 of 4");
    // The message has to name the build, or nobody can tell which it was.
    expect(got.message).toContain("deadbeefcafe");
    expect(got.message).toContain("Nothing was restored");
  });

  it("says so when the file holds nothing", () => {
    const got = restoreSaved(file([]), fresh(), FPU);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.message).toContain("no decisions");
  });

  it("restores when a few decisions are stale but most fit", () => {
    // A finder that moved slightly must not block a restore; the floor is a
    // share, and the message says how many were dropped.
    // ── TWENTY DIFFERENT WALLS, NOT ONE WALL TWENTY TIMES ──
    //
    // The first version of this pushed twenty IDENTICAL decisions and gave
    // nineteen candidates 0.2 ft apart. They all competed for the same few
    // in-band candidates, eight matched, and the restore refused — which was
    // the code being right and the fixture being nonsense. Each decision now
    // sits on its own wall, 10 ft apart, and the last one has no candidate.
    const many: SavedVerdict[] = [];
    for (let i = 0; i < 20; i += 1) many.push(sv(10 + i * 10, 0, 40, "wall"));
    const candidates: Candidate[] = [];
    for (let i = 0; i < 19; i += 1) candidates.push(cand(`c${i}`, 10 + i * 10, 0, 40, 6));
    const got = restoreSaved(file(many), startReview(candidates), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.decisions).toBe(19);
    expect(got.unmatched).toBe(1);
    expect(got.message).toContain("1 no longer matching");
  });

  it("holds the floor where it is set", () => {
    // Pinned so that loosening it is a visible decision rather than a drift.
    expect(MIN_MATCH_SHARE).toBe(0.9);
  });
});


describe("re-applying the splits the reviewer made", () => {
  // One 40 ft candidate the reviewer cut at 15 ft, judging each half.
  const whole = () => startReview([cand("w0", 10, 0, 40, 6)]);
  const splitFile = () =>
    file([sv(10, 0, 15, "wall"), sv(10, 15, 40, "not-wall")], { reviewedBy: "chrome" });

  it("brings BOTH halves back, which is the bug Chrome hit", () => {
    // ── WHY THIS COULD NOT WORK BEFORE ──
    //
    // Neither half is a candidate the finder proposes: the split happened
    // during the review. So both verdicts matched nothing and were reported
    // as stale — NG Green Bay A3.1 lost 3 that way, Baker EOC A101 lost 2,
    // on sheets where the reviewer had done EXTRA work precisely because the
    // finder's run was wrong.
    const got = restoreSaved(splitFile(), whole(), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.splitsReapplied).toBe(1);
    expect(got.decisions).toBe(2);
    expect(got.unmatched).toBe(0);
    // And the halves carry the verdicts the reviewer gave them, not one
    // verdict spread over both.
    const verdicts = Object.values(got.state.verdicts);
    expect(verdicts).toContain("wall");
    expect(verdicts).toContain("not-a-wall");
  });

  it("says so in the message", () => {
    const got = restoreSaved(splitFile(), whole(), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.message).toContain("1 split re-applied");
  });

  it("does NOT split a candidate one saved decision covers whole", () => {
    // The ordinary case must not be touched: a 40 ft decision on a 40 ft
    // candidate is a match, not two pieces.
    const got = restoreSaved(file([sv(10, 0, 40, "wall")]), whole(), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.splitsReapplied).toBe(0);
    expect(got.decisions).toBe(1);
  });

  it("does NOT split for two pieces covering only part of it", () => {
    // Two short decisions at one end are not a split of the whole run; they
    // are something else, and splitting there would invent a boundary.
    const got = restoreSaved(file([sv(10, 0, 5, "wall"), sv(10, 5, 11, "wall")]), whole(), FPU);
    // Either outcome is correct here and both are worth allowing: the pieces
    // may simply fail to match (a refusal), or they may match without any
    // split being invented. What must NOT happen is a split at a boundary the
    // reviewer never drew, so the assertion is on the split count.
    if (got.ok) {
      expect(got.splitsReapplied).toBe(0);
    } else {
      expect(got.message).toContain("Nothing was restored");
    }
  });

  it("hands back the reviewer's name, so Save is not dead on arrival", () => {
    const got = restoreSaved(splitFile(), whole(), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.reviewedBy).toBe("chrome");
  });

  it("reports no name rather than an empty one", () => {
    const got = restoreSaved(file([sv(10, 0, 40, "wall")]), whole(), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.reviewedBy).toBeNull();
  });
});
