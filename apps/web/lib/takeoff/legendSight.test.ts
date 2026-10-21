import { describe, expect, it } from "vitest";
import { parseSightRead } from "@prova/integrations/src/wallLegendSight";
import { assemblyFromSight, fullyRead, legendCropRects } from "./legendSight";

const base = {
  code: "S6B",
  name: null,
  studWidthIn: 6,
  studMaterial: "metal" as const,
  studGauge: 25,
  studSpacingIn: 24,
  boardThicknessIn: 0.625,
  layersSideA: 1,
  layersSideB: 1,
  boardIsTypeX: true,
  insulation: null,
  hourlyRating: 0,
  heightNote: "SEE NOTE A",
  notes: ["NON-RATED INTERIOR WALL", "2x STEEL FRAMING, SEE STRUCTURAL"],
  fromDrawing: ["studWidthIn"],
  confidence: "MEDIUM" as const,
};

describe("an assembly from a sight read", () => {
  it("goes through the same parser as the text read and comes out fully read", () => {
    const got = assemblyFromSight(base, "p25");
    expect(got.components.map((c) => c.description)).toEqual([
      "6in metal stud, 25 ga at 24in o.c.",
      "6in track, top and bottom",
      "5/8in type X gypsum board",
    ]);
    expect(got.read).toMatchObject({ studWidthIn: 6, studSpacingIn: 24, studGauge: 25, boardThicknessIn: 0.625, layersPerSide: 1, boardIsTypeX: true, hourlyRating: 0 });
    expect(fullyRead(got)).toBe(true);
    // The stud came off the picture: said so, for the person checking.
    expect(got.flags.map((f) => f.why)).toEqual([expect.stringContaining("read off the drawing")]);
  });

  it("writes two layers, a one-sided wall, and insulation the way a legend prints them", () => {
    const two = assemblyFromSight({ ...base, layersSideA: 2, layersSideB: 2, fromDrawing: [], insulation: "R-13 BATT" }, "p");
    expect(two.components.map((c) => c.description)).toContain("5/8in type X gypsum board, 2 layers per side");
    expect(two.components.map((c) => c.description)).toContain("cavity insulation, R-13");
    expect(two.read.layersPerSide).toBe(2);
    const one = assemblyFromSight({ ...base, layersSideA: 1, layersSideB: 0, fromDrawing: [] }, "p");
    expect(one.flags.map((f) => f.why)).toEqual([expect.stringContaining("one side only")]);
  });

  it("is not fully read without a stud, and gives a concrete wall board only", () => {
    const none = assemblyFromSight({ ...base, studWidthIn: null, studMaterial: null, fromDrawing: [] }, "p");
    expect(fullyRead(none)).toBe(false);
    const icf = assemblyFromSight({ ...base, studWidthIn: 8, studMaterial: "concrete", fromDrawing: [] }, "p");
    expect(icf.components.map((c) => c.description)).toEqual(["5/8in type X gypsum board"]);
    expect(icf.flags.map((f) => f.why)).toEqual([expect.stringContaining("the wall is concrete")]);
    // The width the model saw survives for the thickness band.
    expect(icf.read.studWidthIn).toBe(8);
  });
});

describe("the model's answer, parsed", () => {
  it("keeps the fields it understands and drops a type with no code", () => {
    const got = parseSightRead({
      types: [
        { code: " A ", studWidthIn: 3.625, layersSideA: 1, layersSideB: 1, notes: ["x"], fromDrawing: [], confidence: "HIGH", studMaterial: "steel" },
        { notes: [] },
      ],
      reason: "r",
      confidence: "MEDIUM",
    });
    expect(got.types).toHaveLength(1);
    expect(got.types[0]).toMatchObject({ code: "A", studWidthIn: 3.625, studMaterial: null, boardThicknessIn: null, confidence: "HIGH" });
    expect(got.confidence).toBe("MEDIUM");
  });
});

describe("where each type's crop is", () => {
  it("takes the printing with the most text beneath it, and boxes it around the code", () => {
    const text = [
      { str: "S6B", x: 100, y: 100, width: 20, height: 8 }, // the key, nothing under it
      { str: "S6B", x: 500, y: 300, width: 20, height: 8 }, // the detail
      { str: "1 LAYER GYP.", x: 480, y: 340, width: 60, height: 8 },
      { str: "SEE STRUCTURAL", x: 480, y: 360, width: 60, height: 8 },
    ];
    const got = legendCropRects({ text, codes: ["S6B", "ZZ"], widthPt: 2592, heightPt: 1728 });
    expect(got).toHaveLength(1);
    expect(got[0].code).toBe("S6B");
    expect(got[0].x).toBeCloseTo(510 - 1.0 * 72, 3);
    expect(got[0].y).toBeCloseTo(292 - 0.6 * 72, 3);
    expect(got[0].width).toBeCloseTo(5 * 72, 3);
  });
});
