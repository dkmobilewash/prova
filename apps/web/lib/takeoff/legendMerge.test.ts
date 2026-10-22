import { describe, expect, it } from "vitest";
import { mergeLegendReads, sameCode } from "./legendMerge";

const text = {
  types: [
    // The only spacing in the words is the bracing's; the stud's 16in is on the drawing.
    { code: "D", name: null, lines: ['5/8" GYPSUM BOARD EACH SIDE', '3 5/8" MTL. STUD', 'BRACING AT 48" O.C.', "SOUND ATTENUATION BATTS"] },
    { code: "Z", name: null, lines: ['6" METAL STUDS AT 24" O.C.', '5/8" GYP. BD. EACH SIDE'] },
  ],
  reason: "",
  confidence: "MEDIUM" as const,
};
const sightD = {
  code: "D", name: null, studWidthIn: 3.625, studMaterial: "metal" as const, studGauge: null, studSpacingIn: 16, boardThicknessIn: 0.625, layersSideA: 1, layersSideB: 1,
  boardIsTypeX: false, insulation: "SOUND ATTENUATION BATTS", hourlyRating: 0, heightNote: null, notes: [], fromDrawing: ["layersSideA", "layersSideB"], fromSheetNote: [], optional: [], notAPartition: null, confidence: "HIGH" as const,
};

describe("merging the text read with the sight read", () => {
  it("lets the drawing win a disagreement, flags it with both values, and fills from the words what the drawing left null", () => {
    // The text parser took the bracing's 48in as the stud spacing; the drawing says 16.
    const got = mergeLegendReads({ text, sight: { types: [{ ...sightD, studGauge: null }], reason: "", confidence: "HIGH" }, where: "p16" });
    const d = got.find((m) => m.code === "D")!;
    expect(d.assembly.read.studSpacingIn).toBe(16);
    expect(d.disagreements).toEqual([{ field: "studSpacingIn", text: "48", sight: "16" }]);
    expect(d.assembly.flags.map((f) => f.why)).toContainEqual(expect.stringContaining("the words say studSpacingIn 48 and the drawing shows 16"));
    // Z has no sight read: the text read stands alone.
    const z = got.find((m) => m.code === "Z")!;
    expect(z.from).toBe("text");
    expect(z.assembly.read.studWidthIn).toBe(6);
  });

  it("fills a null sight field from the text and says the result came from both", () => {
    const got = mergeLegendReads({ text, sight: { types: [{ ...sightD, insulation: null }], reason: "", confidence: "HIGH" }, where: "p" });
    const d = got.find((m) => m.code === "D")!;
    expect(d.assembly.read.insulation).toContain("BATT");
    expect(d.from).toBe("both");
  });

  it("treats a labelled, suffixed or bare code as the same code", () => {
    expect(sameCode("WALL TYPE 1", "1")).toBe(true);
    expect(sameCode("2 – FURRING", "2")).toBe(true);
    expect(sameCode("IW-2", "IW-1")).toBe(false);
  });
});
