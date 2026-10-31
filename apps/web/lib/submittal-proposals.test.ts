import { narrowSubmittalExtraction } from "@prova/integrations/src/submittalRequirements";
import { describe, expect, it } from "vitest";
import { mergedSubmittal, newRequirements, submittalFromProposal } from "./submittal-proposals";

const row = (over: Partial<Parameters<typeof submittalFromProposal>[0]> = {}) => ({
  sectionNumber: "09 22 16",
  kind: "PRODUCT_DATA" as const,
  requirement: "Product data for each type of framing member",
  quote: "A. Product data for each type of framing member.",
  sourcePageLabel: "09 22 16-2",
  ...over,
});

describe("a draft becoming a register row", () => {
  it("names the kind and requirement, cites the section, page and quote", () => {
    expect(submittalFromProposal(row())).toEqual({
      title: "Product data: Product data for each type of framing member",
      description: 'Section 09 22 16, 09 22 16-2: "A. Product data for each type of framing member."',
      specSection: "09 22 16",
    });
  });

  it("clips a long title but keeps the whole requirement's source", () => {
    const made = submittalFromProposal(row({ requirement: "x".repeat(300) }));
    expect(made.title.length).toBeLessThanOrEqual(120);
    expect(made.description).toContain("A. Product data");
  });

  it("merges rows from one section, and refuses across sections or for a single row", () => {
    const two = [row(), row({ kind: "SHOP_DRAWINGS", requirement: "Shop drawings", quote: "B." })];
    const merged = mergedSubmittal(two);
    expect(merged?.title).toBe("Section 09 22 16: Product data, Shop drawings");
    expect(merged?.description.split("\n")).toHaveLength(2);
    expect(mergedSubmittal([row(), row({ sectionNumber: "09 29 00" })])).toBeNull();
    expect(mergedSubmittal([row()])).toBeNull();
  });
});

describe("a re-read", () => {
  it("does not ask again about what a person already decided, spacing and case aside", () => {
    const read = [{ requirement: "Product  Data", quote: "A." }, { requirement: "Samples", quote: "B." }];
    expect(newRequirements(read, [{ requirement: "product data", quote: "a." }])).toEqual([{ requirement: "Samples", quote: "B." }]);
  });
});

describe("narrowing the model's answer", () => {
  it("drops a row it cannot check, and maps an unknown kind to OTHER", () => {
    const out = narrowSubmittalExtraction({
      readingReason: "read",
      requirements: [
        { ordinal: 1, kind: "PRODUCT_DATA", requirement: "A", confidence: "HIGH", quote: "A.", sourcePageLabel: null },
        { ordinal: 2, kind: "MADE_UP", requirement: "B", confidence: "HIGH", quote: "B.", sourcePageLabel: "2" },
        { ordinal: 3, kind: "SAMPLES", requirement: "No quote", confidence: "HIGH", quote: "  ", sourcePageLabel: null },
      ],
    });
    expect(out.requirements.map((r) => [r.requirement, r.kind])).toEqual([["A", "PRODUCT_DATA"], ["B", "OTHER"]]);
  });

  it("survives a malformed answer with nothing", () => {
    expect(narrowSubmittalExtraction(null)).toEqual({ requirements: [], readingReason: "" });
    expect(narrowSubmittalExtraction({ requirements: "no" }).requirements).toEqual([]);
  });
});
