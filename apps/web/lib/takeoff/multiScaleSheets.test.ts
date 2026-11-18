import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { viewToCalibrate } from "../../scripts/view-scale-choice.mjs";

// Diego (2026-11-18): a sheet whose drawings print DIFFERENT scales gets no automatic
// calibration; the person picks with one press. Mid-City A4.0 (p63): the roof plan (1/16")
// out-areas the Building "A" floor plan (3/32"), so the biggest view measured every wall 1.5x.
const view = (name: string, scaleName: string, feetPerInch: number, from: number, to: number, fromY: number, toY: number) => ({ name, scaleName, feetPerInch, from, to, fromY, toY });
const ROOF = view("ROOF PLAN", '1/16" = 1\'-0"', 16, 0.05, 0.75, 0.05, 0.7);
const FLOOR = view('BUILDING "A" FLOOR PLAN', '3/32" = 1\'-0"', 32 / 3, 0.5, 0.95, 0.2, 0.68);

describe("which view a review script may calibrate from", () => {
  it("none, when the views print different scales (Mid-City p63, Mack p9)", () => {
    const got = viewToCalibrate([ROOF, FLOOR]);
    expect(got.view).toBeNull();
    expect(got.scales).toEqual(['1/16" = 1\'-0"', '3/32" = 1\'-0"']);
    const mack = [view("NEW WORK OVERVIEW", '1/8" = 1\'-0"', 8, 0.05, 0.7, 0.05, 0.6), view("VCT PATTERN", '1/4" = 1\'-0"', 4, 0.05, 0.95, 0.62, 0.68)];
    expect(viewToCalibrate(mack).view).toBeNull();
  });
  it("the biggest by area, when every view prints the same scale — two spellings of 1/8\" are one", () => {
    const a = view("PLAN A", '1/8" = 1\'-0"', 8, 0, 0.4, 0, 0.6);
    const b = view("PLAN B", "1/8\"=1'-0\"", 8, 0.5, 1, 0, 0.2);
    expect(viewToCalibrate([b, a]).view).toBe(a);
  });
  it("none for no views", () => expect(viewToCalibrate([]).view).toBeNull());
});

describe("both review scripts follow the rule rather than their own sort", () => {
  for (const script of ["set-review-scales.mjs", "sheets-for-set.mjs"]) {
    it(script, () => {
      const code = readFileSync(`${process.cwd()}/scripts/${script}`, "utf8");
      expect(code).toContain('import { viewToCalibrate } from "./view-scale-choice.mjs";');
      expect(code).toMatch(/viewToCalibrate\((usable|views)\)/);
      // No second copy of the biggest-view sort, which is how #1183 fixed one script and missed the other.
      expect(code).not.toMatch(/sort\(\(a, b\) => area\(b\) - area\(a\)\)/);
    });
  }
});
