import { describe, expect, it } from "vitest";
import { tagVocabulary } from "./planTextTags";

describe("tagVocabulary — the codes a symbol must hold to be a wall tag", () => {
  it("is the library's codes alone with no legend, legend first with one, each code once, blanks dropped", () => {
    expect(tagVocabulary(["S6A", "W1", "", " "], null)).toEqual(["S6A", "W1"]);
    expect(tagVocabulary(["S6A", "W1"], ["C8B", "s6a"])).toEqual(["C8B", "s6a", "W1"]);
    expect(tagVocabulary([], null)).toEqual([]);
  });
});
