import { describe, expect, it } from "vitest";
import { isTableRows, runsMeeting, wordsBetweenFaces } from "./textRows";
import type { WallCandidate } from "./wallVectors";

// A 36 in sheet: 1 page-width unit = 2592 pt; 1/8 in = 1 ft, so 1 ft = 27 pt.
const W = 2592;
const FPU = 96;
const wall = (x1: number, y1: number, x2: number, y2: number, thIn = 9): WallCandidate =>
  ({ x1, y1, x2, y2, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU, thicknessFeet: thIn / 12 }) as WallCandidate;
const word = (str: string, xFt: number, yFt: number) => ({ str, x: (xFt * 27) - 10, y: yFt * 27 + 4, width: 20, height: 8 });

describe("two rules of a table with its rows written between them", () => {
  // a 40 ft run at y = 100 ft, 9 in thick: its faces are 4.5 in either side
  const rules = wall(10 / FPU, 100 / FPU, 50 / FPU, 100 / FPU);
  const rows = [word("HINGE", 15, 100), word("PULL", 25, 100), word("CLOSER", 35, 100), word("3'-0\"", 45, 100)];

  it("counts the words between the faces and not the dimension", () => {
    expect(wordsBetweenFaces(rules, rows, W, FPU)).toBe(3);
  });

  it("a word beside the run, not between the faces, does not count", () => {
    expect(wordsBetweenFaces(rules, [word("HALLWAY", 30, 103)], W, FPU)).toBe(0);
  });

  it("SETS THE TABLE ASIDE AND KEEPS A TAGGED WALL THAT PARTITIONS MEET", () => {
    expect(isTableRows(rules, rows, [], W, FPU)).toBe(true);
    const partitions = [wall(20 / FPU, 100 / FPU, 20 / FPU, 120 / FPU), wall(30 / FPU, 100 / FPU, 30 / FPU, 120 / FPU)];
    expect(runsMeeting(rules, partitions, FPU)).toBe(2);
    expect(isTableRows(rules, rows, partitions, W, FPU)).toBe(false);
    expect(isTableRows(rules, [word("W2", 20, 100)], [], W, FPU)).toBe(false);
  });

  it("a parallel run does not meet this one", () => {
    expect(runsMeeting(rules, [wall(10 / FPU, 110 / FPU, 50 / FPU, 110 / FPU)], FPU)).toBe(0);
  });
});
