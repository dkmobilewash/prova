import { describe, expect, it } from "vitest";
import { keyFromLabels, scoreSheet, totalScore, type ScoredRun } from "./heldOutScore";

/**
 * ── THE SCORER'S OWN FAILURE MODES ──
 *
 * A scorer that cannot report a miss is worse than none: it says the finder
 * is perfect and nobody looks again. So the cases here are mostly about what
 * it must NOT forgive.
 */
const FPU = 100; // 100 ft across the page width
const run = (y: number, x1: number, x2: number): ScoredRun => ({
  x1: x1 / FPU,
  y1: y / FPU,
  x2: x2 / FPU,
  y2: y / FPU,
  lengthFeet: x2 - x1,
});

const score = (key: ScoredRun[], proposed: ScoredRun[]) =>
  scoreSheet({ set: "S", sheet: "A1", key, proposed, feetPerUnit: FPU });

describe("scoring a sheet against its key", () => {
  it("a perfect match is nothing missing, nothing extra", () => {
    const got = score([run(10, 0, 20)], [run(10, 0, 20)]);
    expect(got.missingFeet).toBeCloseTo(0);
    expect(got.extraFeet).toBeCloseTo(0);
    expect(got.netFeet).toBeCloseTo(0);
    expect(got.keyFeet).toBeCloseTo(20);
  });

  it("a wall the finder never proposed is MISSING, in feet", () => {
    const got = score([run(10, 0, 20), run(30, 0, 14)], [run(10, 0, 20)]);
    expect(got.missingFeet).toBeCloseTo(14);
    expect(got.extraFeet).toBeCloseTo(0);
    expect(got.netFeet).toBeCloseTo(-14);
  });

  it("a wall the finder invented is EXTRA", () => {
    const got = score([run(10, 0, 20)], [run(10, 0, 20), run(30, 0, 9)]);
    expect(got.extraFeet).toBeCloseTo(9);
    expect(got.missingFeet).toBeCloseTo(0);
    expect(got.netFeet).toBeCloseTo(9);
  });

  it("NET NEAR ZERO DOES NOT MEAN RIGHT, which is why all three are reported", () => {
    // Misses a 40 ft wall, invents a 40 ft one. The bid comes out right and
    // the finder is wrong twice.
    const got = score([run(10, 0, 40)], [run(60, 0, 40)]);
    expect(got.netFeet).toBeCloseTo(0);
    expect(got.missingFeet).toBeCloseTo(40);
    expect(got.extraFeet).toBeCloseTo(40);
  });

  it("counts a partly-covered wall by the part that is missing", () => {
    const got = score([run(10, 0, 20)], [run(10, 0, 12)]);
    expect(got.missingFeet).toBeCloseTo(8);
    expect(got.extraFeet).toBeCloseTo(0);
  });

  it("TWO PROPOSALS ON ONE WALL DO NOT EARN DOUBLE COVERAGE", () => {
    // The duplicate case this programme keeps meeting. Coverage is capped at
    // the key wall's own length, so a wall offered twice cannot report more
    // coverage than exists — and the second copy shows up as EXTRA, which is
    // what double-billing it would be.
    const got = score([run(10, 0, 20)], [run(10, 0, 20), run(10.5, 0, 20)]);
    expect(got.missingFeet).toBeCloseTo(0);
    expect(got.proposedFeet).toBeCloseTo(40);
    expect(got.netFeet).toBeCloseTo(20);
  });

  it("a wall a room away does not count as covering the key", () => {
    // 10 ft off is not drafting jitter. Without this the scorer forgives a
    // proposal that is nowhere near the wall it claims.
    const got = score([run(10, 0, 20)], [run(20, 0, 20)]);
    expect(got.missingFeet).toBeCloseTo(20);
    expect(got.extraFeet).toBeCloseTo(20);
  });

  it("forgives drafting jitter within the band", () => {
    const got = score([run(10, 0, 20)], [run(10.8, 0, 20)]);
    expect(got.missingFeet).toBeCloseTo(0);
    expect(got.extraFeet).toBeCloseTo(0);
  });

  it("a crossing wall does not count as covering", () => {
    // Perpendicular, through the middle: it touches the line and is not the
    // same wall. Both ends must be within the band, not just one.
    const got = score([run(10, 0, 20)], [{ x1: 0.1, y1: 0.0, x2: 0.1, y2: 0.2, lengthFeet: 20 }]);
    expect(got.missingFeet).toBeCloseTo(20);
  });

  it("ONE end on the wall is not enough — both must be", () => {
    // ── THE CASE THE PERPENDICULAR TEST CANNOT MAKE ──
    //
    // A wall leaving the key wall at an angle: one end sits exactly on it,
    // the other is 10 ft away. The perpendicular case above has BOTH ends far
    // off, so it passes whether the check takes the nearer end or the further
    // one — mutation showed `Math.max` could become `Math.min` and nothing
    // went red. This is an L-shaped junction, which is on every drawing.
    const angled: ScoredRun = { x1: 0, y1: 0.1, x2: 0.1, y2: 0.2, lengthFeet: 14 };
    const got = score([run(10, 0, 20)], [angled]);
    expect(got.missingFeet, "an angled wall was credited with covering").toBeCloseTo(20);
  });

  it("an empty proposal misses EVERYTHING, rather than scoring perfectly", () => {
    // The vacuous case: a finder that proposes nothing must score 0% found,
    // not 100% of what it found.
    const got = score([run(10, 0, 20), run(30, 0, 14)], []);
    expect(got.missingFeet).toBeCloseTo(34);
    expect(got.netFeet).toBeCloseTo(-34);
  });
});

describe("the key for a held-out sheet", () => {
  it("is accepted PLUS traced walls", () => {
    const { key, fromTracedFeet } = keyFromLabels({
      verdicts: [
        { x1: 0, y1: 0.1, x2: 0.2, y2: 0.1, lengthFeet: 20, verdict: "wall" },
        { x1: 0, y1: 0.3, x2: 0.14, y2: 0.3, lengthFeet: 14, verdict: "traced" },
        { x1: 0, y1: 0.5, x2: 0.09, y2: 0.5, lengthFeet: 9, verdict: "not-wall" },
        { x1: 0, y1: 0.7, x2: 0.05, y2: 0.7, lengthFeet: 5, verdict: "unsure" },
      ],
    });
    expect(key).toHaveLength(2);
    expect(fromTracedFeet).toBeCloseTo(14);
  });

  it("WITHOUT THE TRACED HALF THE SCORE IS ABOUT NOTHING", () => {
    // The whole reason tracing exists. A key of accepted runs only contains
    // walls the finder already proposed, so it cannot show a miss — the
    // finder is measured against its own output.
    const labels = {
      verdicts: [
        { x1: 0, y1: 0.1, x2: 0.2, y2: 0.1, lengthFeet: 20, verdict: "wall" },
        { x1: 0, y1: 0.3, x2: 0.14, y2: 0.3, lengthFeet: 14, verdict: "traced" },
      ],
    };
    const { key } = keyFromLabels(labels);
    const proposed = [run(10, 0, 20)];
    const withTraced = scoreSheet({ set: "S", sheet: "A1", key, proposed, feetPerUnit: FPU });
    const acceptedOnly = scoreSheet({
      set: "S",
      sheet: "A1",
      key: key.filter((_, i) => i === 0),
      proposed,
      feetPerUnit: FPU,
    });
    expect(withTraced.missingFeet).toBeCloseTo(14);
    expect(acceptedOnly.missingFeet, "a key without traced walls hides the miss").toBeCloseTo(0);
  });
});

/**
 * ── HOW A REVIEWER ACTUALLY TRACES, AND WHAT THE SCORER OWES THEM ──
 *
 * These are the shapes a held-out sheet produces once somebody is tracing in
 * earnest. Each one must come out with the key footage neither DOUBLE COUNTED
 * nor DROPPED, and the two failures pull in opposite directions: a double
 * count makes the finder look worse than it is, a dropped length makes it
 * look better. The second is the dangerous one, because nobody questions it.
 */
describe("traced walls in the key", () => {
  const key = (verdicts: Array<[number, number, number, "wall" | "traced"]>) =>
    keyFromLabels({
      verdicts: verdicts.map(([y, x1, x2, verdict]) => ({
        x1: x1 / FPU,
        y1: y / FPU,
        x2: x2 / FPU,
        y2: y / FPU,
        lengthFeet: x2 - x1,
        verdict,
      })),
    });

  it("a trace that STOPS at a door opening adds exactly the gap", () => {
    // The finder found the wall either side of a 3 ft door; the reviewer
    // traced the opening itself. Key = 20 + 27 + 3 = 50 ft of wall.
    const { key: k, fromTracedFeet } = key([
      [10, 0, 20, "wall"],
      [10, 23, 50, "wall"],
      [10, 20, 23, "traced"],
    ]);
    expect(fromTracedFeet).toBeCloseTo(3);
    const got = scoreSheet({ set: "S", sheet: "A1", key: k, proposed: [], feetPerUnit: FPU });
    expect(got.keyFeet, "the key dropped or gained length").toBeCloseTo(50);
    expect(got.missingFeet, "an empty proposal must miss all of it").toBeCloseTo(50);
  });

  it("a trace THROUGH a door opening does not make the finder look worse", () => {
    // The other reading: the reviewer traces the wall as one line straight
    // through the opening. The key's TOTAL is then larger — the audit flags
    // that as double-counted key footage — but what the scorer must not do is
    // charge the finder for the overlap twice when it proposed both halves.
    const { key: k } = key([
      [10, 0, 20, "wall"],
      [10, 23, 50, "wall"],
      [10, 0, 50, "traced"],
    ]);
    const proposed = [run(10, 0, 20), run(10, 23, 50)];
    const got = scoreSheet({ set: "S", sheet: "A1", key: k, proposed, feetPerUnit: FPU });
    // Only the 3 ft the finder genuinely did not propose is missing — not the
    // 47 ft the overlapping trace repeats.
    expect(got.missingFeet, "the overlap was charged as a miss").toBeCloseTo(3);
    expect(got.extraFeet, "the finder was charged for walls it got right").toBeCloseTo(0);
  });

  it("a trace meeting an accepted run END TO END keeps both lengths", () => {
    // They touch at a point and share none of their length. Dropping either
    // would quietly shrink the key, which makes the finder look better.
    const { key: k } = key([
      [10, 0, 30, "wall"],
      [10, 30, 50, "traced"],
    ]);
    const got = scoreSheet({ set: "S", sheet: "A1", key: k, proposed: [], feetPerUnit: FPU });
    expect(got.keyFeet).toBeCloseTo(50);
    expect(got.missingFeet).toBeCloseTo(50);
  });

  it("a SHORT trace for the missing end of a partly accepted wall is measured", () => {
    // The commonest trace of all: the finder stopped early. The 6 ft it
    // missed must show up as missing, and the 44 ft it found must not.
    const { key: k } = key([
      [10, 0, 44, "wall"],
      [10, 44, 50, "traced"],
    ]);
    const got = scoreSheet({
      set: "S",
      sheet: "A1",
      key: k,
      proposed: [run(10, 0, 44)],
      feetPerUnit: FPU,
    });
    expect(got.missingFeet, "the short trace was dropped or double counted").toBeCloseTo(6);
    expect(got.extraFeet).toBeCloseTo(0);
    expect(got.netFeet).toBeCloseTo(-6);
  });

  it("a trace the finder DID propose is not missing", () => {
    // A reviewer may trace a wall the finder also offered — the audit flags
    // it, but the scorer must still credit the proposal rather than counting
    // the wall as missed.
    const { key: k } = key([[10, 0, 30, "traced"]]);
    const got = scoreSheet({
      set: "S",
      sheet: "A1",
      key: k,
      proposed: [run(10, 0, 30)],
      feetPerUnit: FPU,
    });
    expect(got.missingFeet).toBeCloseTo(0);
    expect(got.extraFeet).toBeCloseTo(0);
  });
});

describe("totals across sheets", () => {
  it("sums rather than averages, so two opposite errors stay visible", () => {
    const a = score([run(10, 0, 50)], [run(10, 0, 50), run(40, 0, 50)]);
    const b = score([run(10, 0, 50), run(40, 0, 50)], [run(10, 0, 50)]);
    const got = totalScore([a, b]);
    expect(got.sheets).toBe(2);
    expect(got.missingFeet).toBeCloseTo(50);
    expect(got.extraFeet).toBeCloseTo(50);
    expect(got.netFeet).toBeCloseTo(0);
  });

  it("two sheets BOTH over sum, they do not average", () => {
    // The case above has +50 and -50, which sum AND average to zero — so it
    // cannot tell a total from a mean. Mutation found that. Two sheets over
    // by 50 and 30 is 80 ft of overbilling across the job, not 40.
    const a = score([run(10, 0, 50)], [run(10, 0, 50), run(40, 0, 50)]);
    const b = score([run(10, 0, 50)], [run(10, 0, 50), run(40, 0, 30)]);
    const got = totalScore([a, b]);
    expect(got.netFeet).toBeCloseTo(80);
    expect(got.extraFeet).toBeCloseTo(80);
  });

  it("reports zero sheets as zero, not as perfect", () => {
    const got = totalScore([]);
    expect(got.sheets).toBe(0);
    expect(got.keyFeet).toBe(0);
  });
});

describe("uncovered footage: judged junk against never judged", () => {
  // 1 unit = 1 ft here, so the numbers read directly.
  const FPU = 1;
  const run = (x1: number, x2: number) => ({ x1, y1: 0, x2, y2: 0, lengthFeet: x2 - x1 });

  it("calls a proposal the reviewer rejected CONFIRMED JUNK, not unjudged", () => {
    const got = scoreSheet({
      set: "s",
      sheet: "A1",
      key: [run(0, 100)],
      proposed: [run(0, 100), run(200, 250)],
      judged: [run(200, 250)],
      feetPerUnit: FPU,
    });
    expect(got.extraFeet).toBeCloseTo(50, 0);
    expect(got.confirmedJunkFeet, "a rejected line is the finder's fault and must be counted as junk").toBeCloseTo(50, 0);
    expect(got.unjudgedFeet).toBeCloseTo(0, 0);
  });

  it("calls a proposal nobody has looked at UNJUDGED, not junk", () => {
    const got = scoreSheet({
      set: "s",
      sheet: "A1",
      key: [run(0, 100)],
      proposed: [run(0, 100), run(200, 250)],
      judged: [],
      feetPerUnit: FPU,
    });
    expect(got.extraFeet).toBeCloseTo(50, 0);
    expect(got.confirmedJunkFeet, "nothing was judged, so nothing is confirmed junk").toBeCloseTo(0, 0);
    expect(got.unjudgedFeet, "it is a labelling debt, not a finder defect").toBeCloseTo(50, 0);
  });

  it("splits a sheet that has both, and the two still add up to extra", () => {
    const got = scoreSheet({
      set: "s",
      sheet: "A1",
      key: [run(0, 100)],
      proposed: [run(0, 100), run(200, 250), run(400, 430)],
      judged: [run(200, 250)],
      feetPerUnit: FPU,
    });
    expect(got.confirmedJunkFeet).toBeCloseTo(50, 0);
    expect(got.unjudgedFeet).toBeCloseTo(30, 0);
    expect(
      got.confirmedJunkFeet + got.unjudgedFeet,
      "the split has to account for every uncovered foot, or a number has gone missing",
    ).toBeCloseTo(got.extraFeet, 0);
  });

  it("without `judged` at all, every uncovered foot is unjudged rather than clean", () => {
    // The honest default for a caller that has no rejections to give: a zero
    // here would read as "no junk", which is the opposite of what is known.
    const got = scoreSheet({
      set: "s",
      sheet: "A1",
      key: [run(0, 100)],
      proposed: [run(0, 100), run(200, 250)],
      feetPerUnit: FPU,
    });
    expect(got.confirmedJunkFeet).toBeCloseTo(0, 0);
    expect(got.unjudgedFeet).toBeCloseTo(got.extraFeet, 0);
  });

  it("reports recall as its own number", () => {
    const got = scoreSheet({
      set: "s",
      sheet: "A1",
      key: [run(0, 100)],
      proposed: [run(0, 60)],
      feetPerUnit: FPU,
    });
    expect(got.missingFeet).toBeCloseTo(40, 0);
    expect(got.recallPercent, "60 of 100 ft covered").toBeCloseTo(60, 0);
  });

  it("never reports negative unjudged footage", () => {
    // The bound on the Math.min: a line that is somehow both accepted and
    // rejected must not make the split go negative.
    const got = scoreSheet({
      set: "s",
      sheet: "A1",
      key: [run(0, 100)],
      proposed: [run(0, 100)],
      judged: [run(0, 100)],
      feetPerUnit: FPU,
    });
    expect(got.unjudgedFeet).toBeGreaterThanOrEqual(0);
    expect(got.confirmedJunkFeet).toBeLessThanOrEqual(got.extraFeet + 0.001);
  });
});

describe("a wall both traced and accepted is counted once", () => {
  // 1 unit = 1 ft, so the numbers read directly.
  const FPU = 1;
  const v = (x1: number, x2: number, verdict: string) => ({
    x1,
    y1: 0,
    x2,
    y2: 0,
    lengthFeet: x2 - x1,
    verdict,
  });

  it("folds a trace that an accepted wall already covers", () => {
    const got = keyFromLabels({ verdicts: [v(0, 100, "wall"), v(0, 100, "traced")] }, FPU);
    expect(got.key).toHaveLength(1);
    expect(got.tracesFoldedIn).toBe(1);
    expect(got.fromTracedFeet, "the trace contributes nothing it does not add").toBeCloseTo(0, 0);
    const feet = got.key.reduce((n, r) => n + (r.lengthFeet ?? 0), 0);
    expect(feet, "the wall was counted twice").toBeCloseTo(100, 0);
  });

  it("keeps a trace that NO accepted wall covers", () => {
    const got = keyFromLabels({ verdicts: [v(0, 100, "wall"), v(200, 260, "traced")] }, FPU);
    expect(got.key).toHaveLength(2);
    expect(got.tracesFoldedIn).toBe(0);
    expect(got.fromTracedFeet).toBeCloseTo(60, 0);
  });

  it("keeps a PARTLY covered trace, because the uncovered part is a real miss", () => {
    // Dropping this would hide 50 ft of wall the finder never offered.
    const got = keyFromLabels({ verdicts: [v(0, 50, "wall"), v(0, 100, "traced")] }, FPU);
    expect(got.key, "the partly covered trace was dropped").toHaveLength(2);
    expect(got.tracesFoldedIn).toBe(0);
    expect(got.fromTracedFeet, "only the uncovered part is the trace's contribution").toBeCloseTo(50, 0);
  });

  it("without feetPerUnit it keeps the OLD behaviour rather than a different one", () => {
    // A missing argument must not quietly change a score: every existing
    // caller that cannot supply the scale gets exactly what it got before.
    const got = keyFromLabels({ verdicts: [v(0, 100, "wall"), v(0, 100, "traced")] });
    expect(got.key).toHaveLength(2);
    expect(got.tracesFoldedIn).toBe(0);
    expect(got.fromTracedFeet).toBeCloseTo(100, 0);
  });

  it("the folded key is what the score is taken on", () => {
    // The point of the whole change: keyFeet must not double.
    const { key } = keyFromLabels({ verdicts: [v(0, 100, "wall"), v(0, 100, "traced")] }, FPU);
    const score = scoreSheet({ set: "s", sheet: "A1", key, proposed: key, feetPerUnit: FPU });
    expect(score.keyFeet, "keyFeet still carries the double").toBeCloseTo(100, 0);
    expect(score.recallPercent).toBeCloseTo(100, 0);
  });
});
