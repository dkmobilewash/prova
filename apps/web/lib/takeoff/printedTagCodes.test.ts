import { describe, expect, it } from "vitest";
import { printedTagCodes, tagVocabulary } from "./planTextTags";
import { prefixlessVocabulary } from "./symbolTagging";

/**
 * Totem Lake Dental prints 1, 1A, 2A, 2B and 3B beside its walls. With plan reading off and a
 * W1–W3 preset they were never in the vocabulary, and the preset's short form read the sheet's
 * "1" as W1.
 */
const words = (...s: string[]) => s.map((str) => ({ str }));

describe("the sheet's own printed codes join the tag vocabulary", () => {
  it("keeps short designations printed twice or more; drops room/door numbers, sheet refs and singles", () => {
    const text = words("1", "1", "1A", "1A", "2B", "2B", "3B", "101", "101", "A2.1", "A2.1", "7", "DOOR", "DOOR");
    expect(printedTagCodes(text)).toEqual(["1", "1A", "2B"]);
  });
  it("with no legend: the printed codes are in, so the preset's short form no longer reads '1' as W1", () => {
    const vocabulary = tagVocabulary(["W1", "W2", "W3"], null, ["1", "1A", "2B"]);
    expect(vocabulary).toEqual(["W1", "W2", "W3", "1", "1A", "2B"]);
    expect(prefixlessVocabulary(vocabulary)).toBeNull();
  });
  it("with a legend read, the legend decides and printed codes stay out", () => {
    expect(tagVocabulary(["W1"], ["IW-2", "IW-4"], ["1", "2B"])).toEqual(["IW-2", "IW-4", "W1"]);
  });
});
