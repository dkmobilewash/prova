import { describe, expect, it } from "vitest";
import type { BuyoutFinding } from "./buyout-spec-check";
import { normalise, rowSources, searchTerms, specHint, specHintSentence, specHintTally, type TextSource } from "./buyout-spec-hints";

const finding = (over: Partial<BuyoutFinding>): BuyoutFinding => ({
  ordinal: 1, kind: "PERFORMANCE", label: "l", requirement: "r", whyItCosts: "w", confidence: "HIGH",
  quote: "q", sourcePageLabel: null, sectionNumber: "09 29 00", ...over,
});
const firecode = finding({
  kind: "NAMED_PRODUCT",
  label: "Named gypsum board",
  requirement: "Use the named board",
  quote: "Gypsum board shall be USG Sheetrock Firecode X. No substitutions.",
});
const source = (text: string, label = "ABC's quote"): TextSource => ({ label, text });

describe("what is searched for", () => {
  it("takes brand words and leaves ordinary spec words behind", () => {
    expect(searchTerms(firecode)).toEqual(["USG", "Sheetrock", "Firecode"]);
  });

  it("does not take capitalised trade words for a brand", () => {
    expect(searchTerms(finding({ kind: "NAMED_PRODUCT", label: "x", requirement: "y", quote: "Finish all Gypsum Board Products by USG, or Equal." }))).toEqual(["USG"]);
  });

  it("keeps a brand that opens a sentence only when it looks like one", () => {
    expect(searchTerms(finding({ kind: "NAMED_PRODUCT", label: "x", requirement: "y", quote: "CertainTeed Silent shall be used." }))).toEqual(["CertainTeed", "Silent"]);
    expect(searchTerms(finding({ kind: "NAMED_PRODUCT", label: "x", requirement: "y", quote: "Wallboard shall be sealed." }))).toEqual([]);
  });

  it("reads ratings and standards on every kind, but brand words only on a named product", () => {
    expect(searchTerms(finding({ kind: "FIRE_RATING", quote: "2-hour assembly per UL U419 and ASTM E119." }))).toEqual(["2 hour", "ul u419", "astm e119"]);
    expect(searchTerms(finding({ kind: "ACOUSTIC", quote: "Rated STC 50 with Quietrock." }))).toEqual(["stc 50"]);
    expect(searchTerms(finding({ kind: "FINISH_LEVEL", quote: "Finish to Level 5." }))).toEqual(["level 5"]);
  });
});

describe("spelling", () => {
  it.each([
    ["2-hr", "two hour"],
    ["2 hrs", "2-hour"],
    ["NRC .70", "NRC 0.7"],
    ["ASTM C 1396", "ASTM C1396"],
    ["20 ga.", "20 gauge"],
  ])("treats %s and %s alike", (a, b) => expect(normalise(a)).toBe(normalise(b)));
});

describe("the hint", () => {
  it("is a possible match, naming the word and the place, with the text to read", () => {
    const hint = specHint(firecode, [source("5/8 Firecode board 4x12"), source("Plain board", "the item")]);
    expect(hint).toEqual({ state: "POSSIBLE", hits: [{ term: "Firecode", where: "ABC's quote", text: "5/8 Firecode board 4x12" }] });
    expect(specHintSentence(hint)).toBe("Possible match: Firecode in ABC's quote. This is a word search, so read the text yourself.");
  });

  it("does not take a different number for the same rating", () => {
    const stc = finding({ kind: "ACOUSTIC", quote: "Rated STC 50." });
    expect(specHint(stc, [source("Rated STC 45")]).state).toBe("NONE");
    expect(specHint(stc, [source("Rated STC 500")]).state).toBe("NONE");
    expect(specHint(finding({ kind: "FINISH_LEVEL", quote: "Level 5." }), [source("Level 4 finish")]).state).toBe("NONE");
  });

  it("matches whole words only", () => {
    expect(specHint(firecode, [source("Firecoded usgs panel")]).state).toBe("NONE");
  });

  it("still calls a word in a refusal a possible match, and shows the text so a person can see", () => {
    const hint = specHint(firecode, [source("Excludes Firecode, quoted as regular board")]);
    expect(hint.state).toBe("POSSIBLE");
    expect(hint).toMatchObject({ hits: [{ text: "Excludes Firecode, quoted as regular board" }] });
  });

  it("says where it looked when it finds nothing, and does not imply a failure", () => {
    const hint = specHint(firecode, [source("Regular board", "the item"), source("Regular board"), source("Regular", "XYZ's quote")]);
    expect(specHintSentence(hint)).toBe(
      "No match found for USG, Sheetrock and Firecode in the item, ABC's quote and XYZ's quote. The text may just not say, so ask.",
    );
  });

  it("never says no match found when there was nothing to look for", () => {
    const hint = specHint(finding({ kind: "PERFORMANCE", quote: "Install plumb and true." }), [source("anything")]);
    expect(hint).toEqual({ state: "NOTHING_TO_SEARCH" });
    expect(specHintSentence(hint)).not.toContain("No match found");
    expect(specHintTally([hint])).toBe("");
  });

  it("searches the item alone when no quote is on file, and says so", () => {
    const sources = rowSources({
      line: { id: "l", description: "5/8 board", unit: "SF", quantity: 1, budgetedUnitCost: null, costCategory: null, catalogEntryId: null },
      quoteTexts: [],
    });
    expect(specHintSentence(specHint(firecode, sources))).toContain("in the item.");
  });

  it("searches vendor name, description and notes of every quote", () => {
    const sources = rowSources({
      line: { id: "l", description: "board", unit: "SF", quantity: 1, budgetedUnitCost: null, costCategory: null, catalogEntryId: null },
      quoteTexts: [{ vendorName: "USG Supply", description: "Board", notes: null }, { vendorName: "ABC", description: "Board", notes: "Sheetrock brand" }],
    });
    expect(specHint(firecode, sources)).toMatchObject({
      hits: [{ term: "USG", where: "USG Supply's quote" }, { term: "Sheetrock", where: "ABC's quote" }],
    });
  });

  it("tallies for the closed row", () => {
    const hints = [specHint(firecode, [source("Firecode")]), specHint(firecode, [source("x")]), specHint(firecode, [source("y")])];
    expect(specHintTally(hints)).toBe("1 possible match, 2 no match found");
  });

  it("never uses a word of verdict", () => {
    const sentences = [
      specHintSentence(specHint(firecode, [source("Firecode")])),
      specHintSentence(specHint(firecode, [source("x")])),
      specHintSentence({ state: "NOTHING_TO_SEARCH" }),
    ].join(" ");
    expect(sentences).not.toMatch(/compl(y|ies|iant)|meets|acceptable|approved|passes|fails|safe to buy/i);
  });
});
