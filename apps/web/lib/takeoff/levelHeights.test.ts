import { describe, expect, it } from "vitest";
import { levelHeight, levelMarks, planLevels, runLevels } from "./levelHeights";

// A section's level markers, Crosslines-shaped: the name, and its elevation on the same line.
const item = (str: string, x: number, y: number) => ({ str, x, y, height: 8 });
const section = [
  item("1st Floor", 100, 500), item("754' - 0\"", 150, 500),
  item("2nd Floor", 100, 420), item("763' - 8\"", 150, 420),
  item("3rd Floor", 100, 340), item("772' - 3\"", 150, 340),
  item("Roof Plan (P2)", 100, 260), item("780' - 10\"", 170, 260),
  item("A300", 900, 40),
];

describe("a wall takes its plan's level, and the level's floor-to-floor", () => {
  it("reads each level marker with the elevation on its own line, the roof as the level above", () => {
    expect(levelMarks("A300", section).map((m) => [m.level, Number(m.feet.toFixed(3))])).toEqual([[1, 754], [2, 763.667], [3, 772.25], [null, 780.833]]);
    // A plan caption is not a marker: no elevation beside it.
    expect(levelMarks("A100", [item("1st Floor Plan (P2)", 100, 100), item("1/8\" = 1'-0\"", 100, 110)])).toEqual([]);
  });

  it("reads the levels a plan's caption names, two plans to a sheet included", () => {
    expect(planLevels("1st Floor Plan (P2)")).toEqual([1]);
    expect(planLevels("2nd - 9th Floor Plan (P2)")).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(planLevels("SECOND FLOOR PLAN")).toEqual([2]);
    expect(planLevels("LEVEL 2-3 FLOOR PLAN")).toEqual([2, 3]);
    expect(planLevels("FIRST FLOOR REFLECTED CEILING PLAN")).toEqual([]);
    expect(planLevels("Roof Plan (P2)")).toEqual([]);
    expect(planLevels("FLOOR PLAN")).toEqual([]);
  });

  it("gives each level the rise to the next level up, the top floor to the roof, with its source", () => {
    const marks = levelMarks("A300", section);
    expect(levelHeight(marks, [1])).toEqual({ feet: 9 + 8 / 12, from: `floor to floor, 1st Floor: 1st Floor 754' - 0" to 2nd Floor 763' - 8" (A300)` });
    expect(levelHeight(marks, [3])!.feet).toBeCloseTo(8 + 7 / 12, 6);
    // 2–3 agree on 8'-7", so the plan showing both takes it; 1–2 do not, so no single figure.
    expect(levelHeight(marks, [2, 3])!.feet).toBeCloseTo(8 + 7 / 12, 6);
    expect(levelHeight(marks, [1, 2])).toBeNull();
    // A level the set never marks has no floor-to-floor.
    expect(levelHeight(marks, [5])).toBeNull();
  });

  it("gives each wall the level of the plan it is drawn in, two plans to a sheet (Crosslines A100)", () => {
    // 100 ft per page width: a 1st floor plan on the left, the typical floor on the right, 21 ft of paper between.
    const box = (x: number) => [
      { x1: x, y1: 0.1, x2: x + 0.3, y2: 0.1 }, { x1: x + 0.3, y1: 0.1, x2: x + 0.3, y2: 0.4 },
      { x1: x + 0.3, y1: 0.4, x2: x, y2: 0.4 }, { x1: x, y1: 0.4, x2: x, y2: 0.1 },
    ];
    const runs = [...box(0.05), ...box(0.56)];
    const captions = [
      { name: "1st Floor Plan (P2)", captionX: 0.05, captionY: 0.45 },
      { name: "2nd - 9th Floor Plan (P2)", captionX: 0.56, captionY: 0.45 },
      { name: "WALL TYPES", captionX: 0.9, captionY: 0.9 },
    ];
    const got = runLevels(runs, captions, 100);
    expect(got.slice(0, 4).every((l) => l.join() === "1")).toBe(true);
    expect(got.slice(4).every((l) => l.join() === "2,3,4,5,6,7,8,9")).toBe(true);
  });

  it("takes the caption under a drawing, not the one above it, when plans are stacked (Crosslines A100)", () => {
    // Roof, floors 2–9 and the 1st floor stacked down the sheet, each captioned just below.
    const strip = (y: number) => [{ x1: 0.2, y1: y, x2: 0.5, y2: y }, { x1: 0.5, y1: y, x2: 0.5, y2: y + 0.1 }];
    const captions = [
      { name: "Roof Plan (P2)", captionX: 0.19, captionY: 0.217 },
      { name: "2nd - 9th Floor Plan (P2)", captionX: 0.19, captionY: 0.448 },
      { name: "1st Floor Plan (P2)", captionX: 0.19, captionY: 0.673 },
    ];
    // The typical floor's walls sit nearer the roof caption above them than their own below.
    expect(runLevels(strip(0.31), captions, 100)[0]).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(runLevels(strip(0.51), captions, 100)[0]).toEqual([1]);
  });

  it("reads a wood-framed set's bearings, the figure printed under the label and its inches apart (Topeka A3xx)", () => {
    const wood = [
      item("T.O. 1st FLOOR SLAB", 100, 500), item("100'", 100, 488), item("- 0\"", 112, 488),
      item("T.O. 2nd BEARING", 100, 420), item("109'", 100, 408), item("- 1 1/8\"", 112, 408),
      item("T.O 3RD BEARING", 100, 340), item("120' - 1\"", 100, 328),
      item("TRUSS BEARING", 100, 260), item("131' - 0 7/8\"", 100, 248),
      item("1.0 - FIRST FLOOR", 400, 500), item("0' - 0\"", 400, 488),
      // A floor deck with no storey named says nothing about which level it is.
      item("FLOOR DECK", 600, 500), item("110'", 600, 488),
    ];
    const marks = levelMarks("A301", wood);
    expect(marks.map((m) => [m.level, Number(m.feet.toFixed(3))])).toEqual([[1, 100], [2, 109.094], [3, 120.083], [null, 131.073], [1, 0]]);
    expect(levelHeight(marks.slice(0, 4), [1])!.feet).toBeCloseTo(9 + 1.125 / 12, 2);
    expect(levelHeight(marks.slice(0, 4), [2, 3])!.feet).toBeCloseTo(10 + 11.875 / 12, 2);
  });
});
