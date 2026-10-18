import { describe, expect, it } from "vitest";
import { KEY_RULES, answerKeyFromJson, scoreAgainstKey, type AnswerKey } from "./answerKey";

/**
 * ── THE FIRST ERROR BAR THIS REPO HAS HAD ON A REAL DRAWING ──
 *
 * Every accuracy number here comes from a plan the repo drew itself. That is
 * the right way to build a bench and it cannot say what the detector does on a
 * sheet somebody issued: "2,099 ft on A102" has been true, unchecked and
 * unfalsifiable for weeks.
 *
 * A key is one person's reviewed answer for one sheet. These tests are about
 * the two things that can go wrong with grading against one — reading a key
 * that is not a key, and matching walls in a way that flatters the detector.
 */

const KEY: AnswerKey = {
  sheet: { set: "Camp Bow Wow", page: 9, number: "A102" },
  reviewedBy: "diego",
  reviewedAt: "2026-10-17T12:00:00.000Z",
  feetPerUnit: 288,
  walls: [
    { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.1, lengthFeet: 28.8, thicknessIn: 6, from: "pair" },
    { x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.2, lengthFeet: 28.8, thicknessIn: 6, from: "single" },
  ],
};

describe("grading a sheet against a reviewed key", () => {
  it("reports footage, the signed error, and what was missed", () => {
    // Found the first wall, missed the second.
    const score = scoreAgainstKey(
      [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.1, lengthFeet: 28.8 }],
      KEY,
    );
    expect(score.keyFeet).toBeCloseTo(57.6, 3);
    expect(score.foundFeet).toBeCloseTo(28.8, 3);
    expect(score.errorPercent).toBeCloseTo(-50, 3);
    expect(score.missed).toHaveLength(1);
    expect(score.missed[0].from).toBe("single");
    expect(score.extra).toHaveLength(0);
  });

  it("SIGNS THE ERROR, so over-reporting reads differently from under", () => {
    // A detector 50% over and one 50% under are not the same problem: one
    // bills a client for walls that are not there, the other misses them.
    const over = scoreAgainstKey(
      [
        { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.1, lengthFeet: 28.8 },
        { x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.2, lengthFeet: 28.8 },
        { x1: 0.1, y1: 0.4, x2: 0.3, y2: 0.4, lengthFeet: 57.6 },
      ],
      KEY,
    );
    expect(over.errorPercent).toBeGreaterThan(0);
    expect(over.extra).toHaveLength(1);
    expect(over.extraFeet).toBeCloseTo(57.6, 3);
  });

  it("MATCHES BY PLACE, so splitting one wall into three is not three errors", () => {
    // A detector that reports a wall in pieces is right about the footage and
    // wrong about the count. Counting it as two extras and one missed would
    // make a correct answer look like a disaster.
    const score = scoreAgainstKey(
      [
        { x1: 0.1, y1: 0.1, x2: 0.133, y2: 0.1, lengthFeet: 9.6 },
        { x1: 0.133, y1: 0.1, x2: 0.167, y2: 0.1, lengthFeet: 9.6 },
        { x1: 0.167, y1: 0.1, x2: 0.2, y2: 0.1, lengthFeet: 9.6 },
      ],
      KEY,
    );
    expect(score.extra).toHaveLength(0);
    expect(score.missed.map((w) => w.from)).toEqual(["single"]);
  });

  it("does not match a wall that is merely NEAR another one", () => {
    // Two walls either side of a 6ft corridor are different walls. A tolerance
    // loose enough to join them would score a detector that found one of them
    // as having found both.
    const score = scoreAgainstKey(
      [{ x1: 0.1, y1: 0.12, x2: 0.2, y2: 0.12, lengthFeet: 28.8 }],
      KEY,
    );
    expect(score.missed).toHaveLength(2);
    expect(score.extra).toHaveLength(1);
  });

  it("counts how the DRAWING showed each wall, which only a key can say", () => {
    // The question the single-line measurement could not answer: 7,694 ft of
    // unpaired long lines on one sheet, and no way to know how much of it was
    // wall. A key says, per wall.
    const score = scoreAgainstKey([], KEY);
    expect(score.keyFromPairs).toBe(1);
    expect(score.keyFromSingles).toBe(1);
    expect(score.keyFeetFromSingles).toBeCloseTo(28.8, 3);
  });
});

describe("reading a key file", () => {
  it("round-trips one it wrote", () => {
    expect(answerKeyFromJson(JSON.parse(JSON.stringify(KEY)))).toEqual(KEY);
  });

  it("REFUSES A HALF-KEY rather than grading against part of one", () => {
    // The posture `viewScalesFromJson` takes, for a sharper reason: a key
    // missing walls would silently grade a run against the wrong total and
    // nothing downstream could tell. Every one of these is a shape a
    // hand-edited file could take.
    const broken: unknown[] = [
      null,
      {},
      { ...KEY, walls: "not an array" },
      { ...KEY, feetPerUnit: 0 },
      { ...KEY, reviewedBy: 42 },
      { ...KEY, sheet: { set: "x", page: "nine", number: "A102" } },
      { ...KEY, walls: [{ x1: 0, y1: 0, x2: 1, y2: 1, lengthFeet: 10, from: "guess" }] },
      { ...KEY, walls: [{ x1: 0, y1: 0, x2: 1, y2: 1, from: "pair" }] },
    ];
    for (const one of broken) {
      expect(answerKeyFromJson(one), `accepted ${JSON.stringify(one)?.slice(0, 60)}`).toBeNull();
    }
  });

  it("allows a wall whose thickness the reviewer did not judge", () => {
    // Thickness is the slowest thing to review and the least load-bearing for
    // footage. Making it required would be making the key slower to produce
    // for no gain in the number it exists to check.
    const key = answerKeyFromJson({
      ...KEY,
      walls: [{ x1: 0, y1: 0, x2: 0.1, y2: 0, lengthFeet: 28.8, thicknessIn: null, from: "pair" }],
    });
    expect(key?.walls[0].thicknessIn).toBeNull();
  });
});

describe("what a reviewer is told counts", () => {
  it("states the rules the key is made under, in the reviewer's own terms", () => {
    // A key made under one definition and graded under another is worse than
    // no key. These are the words shown IN the review mode, so the definition
    // and the screen cannot drift.
    const all = KEY_RULES.join(" ");
    expect(all).toMatch(/CENTRELINE/i);
    expect(all).toMatch(/GROSS/i);
    expect(all).toMatch(/door|window/i);
    expect(all).toMatch(/furniture/i);
    expect(KEY_RULES.length).toBeGreaterThanOrEqual(4);
  });
});
