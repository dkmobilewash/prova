import { describe, expect, it } from "vitest";
import { NEAR_CAP_FEET, THICK_FLOOR_FEET, THICK_SHARE, WIDE_CAP_FEET, bandHoldsAWall, thickSheetCap } from "./sheetThickness";
import type { WallCandidate } from "./wallVectors";

const wall = (lengthFeet: number, thicknessIn: number): WallCandidate =>
  ({ x1: 0, y1: 0, x2: lengthFeet, y2: 0, thicknessFeet: thicknessIn / 12, lengthFeet }) as WallCandidate;

describe("thickSheetCap", () => {
  it("widens a sheet whose footage piles up at the cap, and leaves a stud-wall sheet alone", () => {
    // Supreme Court's shape: 42% of the footage at 12 in and over.
    expect(thickSheetCap([wall(300, 12.5), wall(120, 12), wall(580, 6)])).toBe(WIDE_CAP_FEET);
    // An ordinary sheet: a few percent of thick wall, the rest studs.
    expect(thickSheetCap([wall(60, 12.5), wall(940, 4.5)])).toBeNull();
  });
  it("needs real footage at the cap, not one thick pier", () => {
    expect(thickSheetCap([wall(THICK_FLOOR_FEET - 1, 12.5), wall(10, 4)])).toBeNull();
    expect(thickSheetCap([wall(THICK_FLOOR_FEET, 12.5), wall(10, 4)])).toBe(WIDE_CAP_FEET);
    expect(thickSheetCap([])).toBeNull();
  });
  it("counts feet, not runs", () => {
    const manyThin = Array.from({ length: 40 }, () => wall(5, 4));
    expect(thickSheetCap([...manyThin, wall(200, NEAR_CAP_FEET * 12)])).toBe(WIDE_CAP_FEET);
    const share = 200 / (200 + 40 * 5);
    expect(share).toBeGreaterThanOrEqual(THICK_SHARE);
  });
});

describe("bandHoldsAWall", () => {
  const fpu = 1; // one unit = one foot, for legible numbers
  const run = (x1: number, y1: number, x2: number, y2: number, thicknessIn: number): WallCandidate =>
    ({ x1, y1, x2, y2, thicknessFeet: thicknessIn / 12, lengthFeet: Math.hypot(x2 - x1, y2 - y1) }) as WallCandidate;
  it("refuses a fat pair spanning two thin walls, and admits a thick wall nobody paired", () => {
    const thin = [run(0, 0.25, 40, 0.25, 6), run(0, 1.75, 40, 1.75, 6)];
    const fat = run(0, 1, 40, 1, 20);
    expect(bandHoldsAWall(fat, thin, fpu)).toBe(true);
    const masonry = run(0, 10, 40, 10, 16);
    expect(bandHoldsAWall(masonry, thin, fpu)).toBe(false);
  });
  it("ignores a wall that only crosses the band, or is not parallel", () => {
    const fat = run(0, 1, 40, 1, 20);
    expect(bandHoldsAWall(fat, [run(20, -5, 20, 5, 6)], fpu)).toBe(false);
    expect(bandHoldsAWall(fat, [run(0, 0.5, 1, 0.5, 6)], fpu)).toBe(false);
  });
});
