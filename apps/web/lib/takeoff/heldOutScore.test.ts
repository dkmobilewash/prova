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
