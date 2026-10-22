import { describe, expect, it } from "vitest";
import { legendBands, nominalThicknessIn } from "./legendBands";
import type { WallCandidate } from "./wallVectors";

const run = (inches: number, feet: number): WallCandidate => ({
  x1: 0,
  y1: 0,
  x2: feet / 100,
  y2: 0,
  thicknessFeet: inches / 12,
  lengthFeet: feet,
});

describe("nominal thickness from a legend read", () => {
  it("is the stud plus the board on both faces", () => {
    expect(nominalThicknessIn({ studWidthIn: 6, boardThicknessIn: 0.625, layersPerSide: 1 })).toBe(7.25);
    expect(nominalThicknessIn({ studWidthIn: 6, boardThicknessIn: 0.625, layersPerSide: 2 })).toBe(8.5);
    expect(nominalThicknessIn({ studWidthIn: 3.625, boardThicknessIn: null, layersPerSide: null })).toBe(3.625);
    expect(nominalThicknessIn({ studWidthIn: null, boardThicknessIn: 0.625, layersPerSide: 1 })).toBeNull();
  });
});

describe("bands by legend thickness", () => {
  // Baker's shape: S6B is 7.25, S6A 8.5, S8B 9.25; the finder measured
  // 7.375, 7.0 and 8.125, 8.75 across separate half-inch clusters.
  const types = [
    { code: "S6B", thicknessIn: 7.25 },
    { code: "S6A", thicknessIn: 8.5 },
    { code: "S8B", thicknessIn: 9.25 },
  ];

  it("merges runs within noise of one legend type into one band named for it", () => {
    const runs = [run(7.375, 100), run(7.0, 40), run(8.125, 50), run(8.75, 30), run(12.7, 20)];
    const bands = legendBands({ runs, types });
    expect(bands.map((b) => [b.source.kind === "LEGEND" ? b.source.code : b.source.kind, b.runs.length, Math.round(b.feet)])).toEqual([
      ["S6B", 2, 140],
      ["S6A", 2, 80],
      ["UNMATCHED", 1, 20],
    ]);
  });

  it("leaves a run two types could claim in an AMBIGUOUS band that names both", () => {
    const close = [
      { code: "A", thicknessIn: 4.875 },
      { code: "B", thicknessIn: 4.875 },
    ];
    const bands = legendBands({ runs: [run(4.9, 10)], types: close });
    expect(bands[0].source).toEqual({ kind: "AMBIGUOUS", codes: ["A", "B"] });
  });

  it("keeps the tags the runs carried and shows a disagreement rather than hiding it", () => {
    const a = run(7.3, 50);
    const b = run(7.4, 30);
    const bands = legendBands({ runs: [a, b], types, tagged: new Map([[a, "S6B"], [b, "S6C"]]) });
    expect(bands[0].tags).toEqual([
      { code: "S6B", feet: 50 },
      { code: "S6C", feet: 30 },
    ]);
  });

  it("ignores legend types with no thickness, and still clusters the rest", () => {
    const bands = legendBands({ runs: [run(5.0, 10), run(5.2, 10), run(9.0, 10)], types: [{ code: "X", thicknessIn: null }] });
    expect(bands.map((b) => b.runs.length)).toEqual([2, 1]);
  });
});
