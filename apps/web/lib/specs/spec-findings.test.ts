import { describe as group, expect, it } from "vitest";
import { SPEC_FINDING_LABEL, findingsFromJson, sortFindingsForReview, type SpecFindingView } from "./spec-findings";
import { SPEC_FINDING_KINDS } from "@prova/integrations/src/specs";

/**
 * Ordering and narrowing the findings of one spec reading.
 *
 * The narrowing half is the one that matters, and it guards a shape no type can:
 * `BidSpecReading.findings` is a `Json` column, so everything coming out of it is
 * `unknown` at the boundary. A cast would let a row written by an older prompt
 * version — or by a hand-edited database, or by a model that returned a kind
 * nobody has added yet — reach the screen and render the word "undefined" as a
 * finding's category on a bid page.
 */

const finding = (over: Partial<SpecFindingView> = {}): SpecFindingView => ({
  ordinal: 1,
  kind: "FINISH_LEVEL",
  label: "Level 5 at public areas",
  requirement: "Level 5 finish per GA-214 at all areas scheduled as public.",
  whyItCosts: "Level 5 adds a skim coat over the whole surface, which Level 4 does not include.",
  confidence: "HIGH",
  quote: "Provide Level 5 finish at all public areas.",
  sourcePageLabel: "09 21 16-7",
  ...over,
});

group("what each kind is called", () => {
  it("names every kind the extractor can return", () => {
    // A total `Record` means a missing member does not compile, so this asserts
    // the other direction: that the enum and the label map have not drifted into
    // agreeing about different sets. #526's NaN bid total came from exactly that.
    for (const kind of SPEC_FINDING_KINDS) {
      expect(SPEC_FINDING_LABEL[kind], `${kind} has no label`).toBeTruthy();
      expect(SPEC_FINDING_LABEL[kind]).not.toBe(kind);
    }
    expect(Object.keys(SPEC_FINDING_LABEL).sort()).toEqual([...SPEC_FINDING_KINDS].sort());
  });

  it("calls GENERAL something a person would read", () => {
    // The escape hatch is the one most likely to be seen, because it catches
    // everything the other eight do not. "GENERAL" on screen reads as a bug.
    expect(SPEC_FINDING_LABEL.GENERAL).toBe("Other");
  });
});

group("ordering for review", () => {
  it("puts the LEAST sure first", () => {
    // `DocumentIntakeConfidence`'s reasoning: HIGH sorts to the bottom, "which
    // is what makes over-claiming it the expensive mistake". A reader that says
    // HIGH and is wrong has buried its error at the end of the list.
    const sorted = sortFindingsForReview([
      finding({ ordinal: 1, confidence: "HIGH" }),
      finding({ ordinal: 2, confidence: "LOW" }),
      finding({ ordinal: 3, confidence: "MEDIUM" }),
    ]);
    expect(sorted.map((f) => f.confidence)).toEqual(["LOW", "MEDIUM", "HIGH"]);
  });

  it("keeps the document's own order within a band, so the order is TOTAL", () => {
    // `review.ts` does the same and for the same reason: a row that can move
    // under the cursor between renders is a row somebody acts on by accident.
    const sorted = sortFindingsForReview([
      finding({ ordinal: 9, confidence: "LOW" }),
      finding({ ordinal: 2, confidence: "LOW" }),
      finding({ ordinal: 5, confidence: "LOW" }),
    ]);
    expect(sorted.map((f) => f.ordinal)).toEqual([2, 5, 9]);
  });

  it("does not mutate what it was given", () => {
    const input = [finding({ ordinal: 1, confidence: "HIGH" }), finding({ ordinal: 2, confidence: "LOW" })];
    sortFindingsForReview(input);
    expect(input.map((f) => f.confidence)).toEqual(["HIGH", "LOW"]);
  });
});

group("narrowing the Json column", () => {
  it("reads a well-formed row through unchanged", () => {
    const [out] = findingsFromJson([finding()]);
    expect(out).toEqual(finding());
  });

  it("an unrecognised kind becomes GENERAL rather than reaching the screen", () => {
    // THE DEFECT THIS EXISTS FOR. A row written before a kind existed, or after
    // one was renamed, would otherwise index `SPEC_FINDING_LABEL` with a key it
    // does not have and print "undefined" as a category on a bid page.
    const [out] = findingsFromJson([{ ...finding(), kind: "SOMETHING_NEW" }]);
    expect(out.kind).toBe("GENERAL");
    expect(SPEC_FINDING_LABEL[out.kind]).toBe("Other");
  });

  it("an unrecognised confidence becomes LOW, never HIGH", () => {
    // The safe direction, and the only one. A row whose confidence cannot be
    // read must not be presented as one the reader was sure of.
    expect(findingsFromJson([{ ...finding(), confidence: "VERY_SURE" }])[0].confidence).toBe("LOW");
    expect(findingsFromJson([{ ...finding(), confidence: undefined }])[0].confidence).toBe("LOW");
  });

  it("DROPS a finding with no quote", () => {
    // The quote is what makes a finding checkable against the page, and this
    // feature's whole claim is that a person can verify each line. A finding
    // without one is an assertion with no evidence — `intake.prisma`: "a reason
    // nobody can check is a reason nobody can overrule."
    expect(findingsFromJson([finding({ quote: "" })])).toEqual([]);
    expect(findingsFromJson([finding({ quote: "   " })])).toEqual([]);
    expect(findingsFromJson([{ ...finding(), quote: undefined }])).toEqual([]);
    // And it drops only that one, keeping the rest.
    const kept = findingsFromJson([finding({ ordinal: 1, quote: "" }), finding({ ordinal: 2 })]);
    expect(kept.map((f) => f.ordinal)).toEqual([2]);
  });

  it("survives every shape a Json column can actually hold", () => {
    // Not defensive padding: this column is `unknown` at the boundary, and a
    // page that throws renders an error boundary over a whole bid list.
    expect(findingsFromJson(null)).toEqual([]);
    expect(findingsFromJson(undefined)).toEqual([]);
    expect(findingsFromJson({})).toEqual([]);
    expect(findingsFromJson("[]")).toEqual([]);
    expect(findingsFromJson(42)).toEqual([]);
    expect(findingsFromJson([null, 7, "x", finding({ ordinal: 4 })]).map((f) => f.ordinal)).toEqual([4]);
  });

  it("falls back to position when ordinal is missing, so the sort stays total", () => {
    const out = findingsFromJson([
      { ...finding(), ordinal: undefined },
      { ...finding(), ordinal: undefined },
    ]);
    expect(out.map((f) => f.ordinal)).toEqual([1, 2]);
  });
});
