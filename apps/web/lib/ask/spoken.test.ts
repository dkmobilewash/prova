import { describe, expect, it } from "vitest";
import { matchScore, matchWords, normalizeSpoken } from "./spoken";

describe("normalizeSpoken", () => {
  it.each([
    ["two hundred sheets of five-eighths type X", "two hundred sheets of 5/8 type x"],
    ["five eighths type ex", "5/8 type x"],
    ["5 8ths Type-X", "5/8 type x"],
    ["three quarter inch plywood", "3/4 inch plywood"],
    ["half inch sheetrock", "1/2 inch drywall"],
    ['5/8" Type X Gypsum Board', "5/8 type x drywall"],
  ])("%s -> %s", (said, folded) => {
    expect(normalizeSpoken(said)).toBe(folded);
  });
});

describe("matching a spoken material against estimate lines", () => {
  const lines = ['5/8" Type X gypsum board', '1/2" regular gypsum board', "3-5/8 20ga steel stud", "Taping and finishing"];
  const best = (said: string) => {
    const words = matchWords(said);
    const scored = lines.map((line) => ({ line, score: matchScore(words, line) }));
    const top = Math.max(...scored.map((s) => s.score));
    return scored.filter((s) => s.score === top && top > 0).map((s) => s.line);
  };

  it("finds the Type X line from dictation, not the regular board", () => {
    expect(best("five-eighths type X")).toEqual(['5/8" Type X gypsum board']);
    expect(best("200 sheets of 5/8 type ex")).toEqual(['5/8" Type X gypsum board']);
  });

  it("finds nothing rather than something when no word matches", () => {
    expect(best("acoustical ceiling tile")).toEqual([]);
  });
});
