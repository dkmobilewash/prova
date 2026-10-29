import { describe, expect, it } from "vitest";
import { isTableRows, isUnderline, runsMeeting, wordsBetweenFaces } from "./textRows";
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

describe("a line ruled under a word, as long as the word", () => {
  // a 30 ft heading at y = 100 ft, from x = 10 ft to 40 ft; 8 pt tall
  const heading = { str: "GENERAL PLAN NOTES", x: 10 * 27, y: 100 * 27 + 4, width: 30 * 27, height: 8 };

  it("SETS THE HEADING'S UNDERLINE ASIDE", () => {
    expect(isUnderline(wall(9.8 / FPU, 100 / FPU, 40.3 / FPU, 100 / FPU, 3), [heading], W, FPU)).toBe(true);
  });

  it("keeps the same rule when the word is somewhere else", () => {
    const elsewhere = { ...heading, x: 60 * 27 };
    expect(isUnderline(wall(9.8 / FPU, 100 / FPU, 40.3 / FPU, 100 / FPU, 3), [elsewhere], W, FPU)).toBe(false);
  });

  it("keeps a corridor wall that a room name happens to sit on", () => {
    const room = { str: "VESTIBULE", x: 20 * 27, y: 100 * 27 + 4, width: 8 * 27, height: 8 };
    expect(isUnderline(wall(0, 100 / FPU, 60 / FPU, 100 / FPU), [room], W, FPU)).toBe(false);
  });

  it("asks nothing of a vertical run", () => {
    expect(isUnderline(wall(10 / FPU, 90 / FPU, 10 / FPU, 110 / FPU), [heading], W, FPU)).toBe(false);
  });
});

describe("a vertical dimension string, written along the line", () => {
  it("IS COUNTED AS A WORD BETWEEN THE FACES BY ITS MIDDLE, NOT ITS START", () => {
    // a 20 ft vertical run at x = 50 ft, from y = 100 to 120, 6 in thick; the figure's run starts 1.3 ft
    // beside the line and runs UP the page for 1.5 ft, as pdf.js reports it (angle −π/2)
    const vertical = wall(50 / FPU, 120 / FPU, 50 / FPU, 100 / FPU, 6);
    const figure = { str: "21' - 0\"", x: (50 + 0.1) * 27, y: 111 * 27, width: 1.5 * 27, height: 8, angle: -Math.PI / 2 };
    expect(wordsBetweenFaces(vertical, [figure], W, FPU)).toBe(0); // a dimension is never a "word between"
    const label = { str: "CORRIDOR", x: (50 + 0.1) * 27, y: 111 * 27, width: 1.5 * 27, height: 8, angle: -Math.PI / 2 };
    expect(wordsBetweenFaces(vertical, [label], W, FPU)).toBe(1);
    const asIfHorizontal = { ...label, angle: undefined };
    expect(wordsBetweenFaces(vertical, [asIfHorizontal], W, FPU)).toBe(0);
  });
});
