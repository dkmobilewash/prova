import { describe, expect, it } from "vitest";
import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import type { WallLegendSightRead } from "@prova/integrations/src/wallLegendSight";
import { storedCropsFromJson, storedLegendTypes, storedLegendTypesFromJson } from "./legendProposal";
import { legendProposalFrom } from "./legendProposalBuild";

const text: WallLegendRead = {
  types: [
    { code: "P1", name: "Interior partition", lines: ['3 5/8" METAL STUDS AT 16" O.C.', '5/8" TYPE X GYPSUM BOARD EACH SIDE'] },
    { code: "SF-1", name: null, lines: ["ALUMINUM STOREFRONT SYSTEM"] },
  ],
  reason: "a legend titled WALL TYPES",
  confidence: "HIGH",
};

const sightOf = (over: Partial<WallLegendSightRead["types"][number]>): WallLegendSightRead => ({
  types: [
    {
      code: "P1",
      name: null,
      studWidthIn: 3.625,
      studMaterial: "metal",
      studGauge: null,
      studSpacingIn: 24,
      boardThicknessIn: 0.625,
      layersSideA: 1,
      layersSideB: 1,
      boardIsTypeX: true,
      insulation: null,
      hourlyRating: null,
      heightNote: null,
      notes: [],
      fromDrawing: ["studSpacingIn"],
      fromSheetNote: [],
      optional: [],
      notAPartition: null,
      confidence: "HIGH",
      ...over,
    },
  ],
  reason: "read the crops",
  confidence: "HIGH",
});

describe("the stored shape of a legend read", () => {
  it("from the words alone: one stored type per legend type, components from the lines, its lines kept", () => {
    const stored = storedLegendTypes(text, null, "page 25");
    expect(stored.map((t) => [t.code, t.from])).toEqual([
      ["P1", "text"],
      ["SF-1", "text"],
    ]);
    expect(stored[0].lines).toEqual(text.types[0].lines);
    expect(stored[0].assembly.read.studSpacingIn).toBe(16);
    expect(stored[0].assembly.components.length).toBeGreaterThan(0);
  });

  it("with the drawing: the drawing wins the spacing and the disagreement is kept with both values", () => {
    const stored = storedLegendTypes(text, sightOf({}), "page 25");
    const p1 = stored.find((t) => t.code === "P1")!;
    expect(p1.assembly.read.studSpacingIn).toBe(24);
    expect(p1.disagreements).toEqual([{ field: "studSpacingIn", text: "16", sight: "24" }]);
    expect(p1.assembly.flags.some((f) => f.why.includes("the drawing shows 24"))).toBe(true);
    // The legend's own name survives the merge even though the sight read had none.
    expect(p1.name).toBe("Interior partition");
  });

  it("survives the JSON column round trip, and drops a malformed entry rather than rendering it", () => {
    const stored = storedLegendTypes(text, null, "page 25");
    const back = storedLegendTypesFromJson(JSON.parse(JSON.stringify([...stored, { code: 7 }, null, "x"])));
    expect(back.map((t) => t.code)).toEqual(["P1", "SF-1"]);
    expect(storedCropsFromJson([{ code: "P1", x: 1, y: 2, width: 3, height: 4 }, { code: "P2" }])).toHaveLength(1);
    expect(storedLegendTypesFromJson("not an array")).toEqual([]);
  });

  it("builds the proposal's columns from a text read: merged with no sight yet, the crops as given, the words' version", () => {
    const row = legendProposalFrom({
      pageNumber: 25,
      sheetTitle: "ASSEMBLY LEGEND",
      model: "m",
      read: text,
      crops: [{ code: "P1", x: 10, y: 20, width: 300, height: 200 }],
    });
    expect(row.sheetTitle).toBe("ASSEMBLY LEGEND");
    expect(row.confidence).toBe("HIGH");
    expect(row.promptVersion).toMatch(/^wall-legend\.\d+$/);
    expect((row.merged as { code: string; from: string }[]).map((t) => t.from)).toEqual(["text", "text"]);
    expect(row.crops).toEqual([{ code: "P1", x: 10, y: 20, width: 300, height: 200 }]);
    expect("sightRead" in row).toBe(false);
  });
});
