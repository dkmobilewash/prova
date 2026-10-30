import { describe, expect, it } from "vitest";
import { wallLegendReadFrom, WALL_LEGEND_PROMPT_VERSION } from "@prova/integrations/src/wallLegend";
import { unoFromJson } from "./planTextRead";

/**
 * The legend read's shape, without a model call: what the tool is asked for
 * (`wall-legend.2` adds the "unless noted otherwise" list) is what the app
 * reads back, and a stored read's `uno` is what `legendFromProposal` hands
 * the detection as each type's default sentence.
 */
describe("the legend read's defaults", () => {
  it("keeps each U.N.O. sentence with the code it names, verbatim, and drops the malformed", () => {
    const read = wallLegendReadFrom({
      types: [{ code: "A", lines: ["3 5/8\" MTL. STUDS", "5/8\" GYP. BD. EACH SIDE"] }, { code: "", lines: ["nothing"] }, { code: "B", lines: [] }],
      uno: [
        { code: "A", note: "UNLESS NOTED OTHERWISE ON THE FLOOR PLAN, ALL INTERIOR DRYWALL\n PARTITIONS ARE TYPE 'A' PARTITIONS." },
        { code: " B ", note: "ALL INTERIOR MASONRY PARTITIONS ARE TYPE 'B' U.N.O." },
        { code: "", note: "ALL STUDS ARE 3 5/8\" UNLESS NOTED" },
        { code: "C", note: "   " },
        "not an object",
      ],
      reason: "the partition sheet",
      confidence: "HIGH",
    });
    expect(read.types.map((t) => t.code)).toEqual(["A"]);
    expect(read.uno).toEqual([
      { code: "A", note: "UNLESS NOTED OTHERWISE ON THE FLOOR PLAN, ALL INTERIOR DRYWALL PARTITIONS ARE TYPE 'A' PARTITIONS." },
      { code: "B", note: "ALL INTERIOR MASONRY PARTITIONS ARE TYPE 'B' U.N.O." },
    ]);
    // A read with no list at all is a read with no defaults, not a failure.
    expect(wallLegendReadFrom({ types: [], reason: "", confidence: "LOW" }).uno).toEqual([]);
    expect(wallLegendReadFrom({ types: [], reason: "", confidence: "maybe" }).confidence).toBe("LOW");
  });

  it("is what a stored proposal hands the detection", () => {
    const read = wallLegendReadFrom({ types: [{ code: "A", lines: ["x"] }], uno: [{ code: "A", note: "ALL PARTITIONS TYPE A U.N.O." }], reason: "", confidence: "HIGH" });
    // `legendProposalFrom` stores the read as `textRead`, JSON round-tripped.
    expect(unoFromJson(JSON.parse(JSON.stringify(read)))).toEqual([{ code: "A", note: "ALL PARTITIONS TYPE A U.N.O." }]);
    expect(WALL_LEGEND_PROMPT_VERSION).toBe("wall-legend.2");
  });
});
