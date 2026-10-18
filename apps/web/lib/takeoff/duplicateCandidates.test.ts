import { describe, expect, it } from "vitest";
import { SAME_WALL_FEET, duplicateOf, duplicatePairs } from "./duplicateCandidates";
import type { Candidate } from "./answerKeyReview";

/**
 * One wall offered twice, and the things that look like it.
 *
 * The two real cases from Camp Bow Wow A101 are here by their own numbers,
 * because they are what the rule was written from and what it has to get
 * right: a 57.7/57.0 ft pair ten inches apart that IS one wall, and an
 * 84/64.9 ft pair 5.2 ft apart that is NOT.
 */
const FEET_PER_UNIT = 288; // A101's scale: 1 unit of page width is 288 ft

/** `x`/`y` in feet, converted to the page-width units candidates live in. */
const run = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thicknessIn = 6,
): Candidate => ({
  id,
  x1: x1 / FEET_PER_UNIT,
  y1: y1 / FEET_PER_UNIT,
  x2: x2 / FEET_PER_UNIT,
  y2: y2 / FEET_PER_UNIT,
  lengthFeet: Math.hypot(x2 - x1, y2 - y1),
  thicknessIn,
  from: "pair",
  note: "",
});

describe("one wall offered twice", () => {
  it("CATCHES A101's WEST PAIR — 57.7 and 57.0 ft, ten inches apart", () => {
    const pairs = duplicatePairs(
      [run("a", 0, 0, 0, 57.7), run("b", 0.86, 0, 0.86, 57.0)],
      FEET_PER_UNIT,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].keep).toBe("a");
    expect(pairs[0].drop).toBe("b");
    expect(pairs[0].apartFeet).toBeCloseTo(0.86, 1);
  });

  it("LEAVES A101's EAST PAIR ALONE — 84 and 64.9 ft, 5.2 ft apart", () => {
    // Two parallel lines five feet apart are a corridor, a cavity or a wall
    // and the thing outside it. Calling them one wall would delete 65 ft of
    // real work.
    expect(
      duplicatePairs([run("a", 0, 0, 0, 84), run("b", 5.2, 19, 5.2, 84)], FEET_PER_UNIT),
    ).toHaveLength(0);
  });

  it("catches one run entirely inside another", () => {
    // A101's other pair: 4.2 ft sitting inside 34.6 ft.
    const pairs = duplicatePairs(
      [run("long", 0, 0, 0, 34.6), run("short", 0.2, 10, 0.2, 14.2)],
      FEET_PER_UNIT,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].keep).toBe("long");
    expect(pairs[0].drop).toBe("short");
  });

  it("REFUSES two walls that merely meet end to end", () => {
    // Same line, almost no overlap: that is one wall continuing, or two walls
    // in a row, and dropping either loses real footage.
    expect(
      duplicatePairs([run("a", 0, 0, 0, 40), run("b", 0, 40, 0, 80)], FEET_PER_UNIT),
    ).toHaveLength(0);
  });

  it("REFUSES two walls across a room", () => {
    expect(
      duplicatePairs([run("a", 0, 0, 0, 40), run("b", 12, 0, 12, 40)], FEET_PER_UNIT),
    ).toHaveLength(0);
  });

  it("REFUSES two walls at right angles that cross", () => {
    expect(
      duplicatePairs([run("a", 0, 20, 40, 20), run("b", 20, 0, 20, 40)], FEET_PER_UNIT),
    ).toHaveLength(0);
  });

  it("holds the band where it says it does", () => {
    const just = duplicatePairs(
      [run("a", 0, 0, 0, 40), run("b", SAME_WALL_FEET - 0.1, 0, SAME_WALL_FEET - 0.1, 40)],
      FEET_PER_UNIT,
    );
    const past = duplicatePairs(
      [run("a", 0, 0, 0, 40), run("b", SAME_WALL_FEET + 0.3, 0, SAME_WALL_FEET + 0.3, 40)],
      FEET_PER_UNIT,
    );
    expect(just).toHaveLength(1);
    expect(past).toHaveLength(0);
  });

  it("collapses three offers of one wall onto the longest, not a chain", () => {
    const pairs = duplicatePairs(
      [run("mid", 0.5, 0, 0.5, 50), run("longest", 0, 0, 0, 56), run("short", 1, 0, 1, 48)],
      FEET_PER_UNIT,
    );
    // Two pairs at most, and the longest is never dropped.
    expect(pairs.every((p) => p.drop !== "longest")).toBe(true);
    expect(pairs.length).toBeLessThanOrEqual(2);
  });

  it("tells the panel which side of a pair a candidate is on", () => {
    const pairs = duplicatePairs(
      [run("a", 0, 0, 0, 57.7), run("b", 0.86, 0, 0.86, 57)],
      FEET_PER_UNIT,
    );
    expect(duplicateOf(pairs, "a")).toMatchObject({ other: "b", keeping: true });
    expect(duplicateOf(pairs, "b")).toMatchObject({ other: "a", keeping: false });
    expect(duplicateOf(pairs, "nobody")).toBeNull();
  });

  it("finds nothing in nothing", () => {
    expect(duplicatePairs([], FEET_PER_UNIT)).toHaveLength(0);
    expect(duplicatePairs([run("only", 0, 0, 0, 10)], FEET_PER_UNIT)).toHaveLength(0);
  });
});
