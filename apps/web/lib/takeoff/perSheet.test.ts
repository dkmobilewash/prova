import { describe, expect, it } from "vitest";
import { onThisSheet, setOnThisSheet } from "./perSheet";

/**
 * ── THE TEST THAT WOULD HAVE CAUGHT IT ──
 *
 * A find on A120 drew its candidates on A130 and A140. The assertion that
 * matters is the second one in every case below: what page A stored must not
 * come back for page B. Everything else here is about not losing work.
 */
describe("a result belongs to one sheet", () => {
  it("gives a page its own value", () => {
    const byPage = setOnThisSheet<string[]>({}, 15, ["a120 run"]);
    expect(onThisSheet(byPage, 15)).toEqual(["a120 run"]);
  });

  it("NEVER gives one page's value to another", () => {
    const byPage = setOnThisSheet<string[]>({}, 15, ["a120 run"]);
    expect(onThisSheet(byPage, 16), "A130 was shown A120's result").toBeNull();
    expect(onThisSheet(byPage, 17), "A140 was shown A120's result").toBeNull();
    expect(onThisSheet(byPage, 1)).toBeNull();
  });

  it("keeps each sheet's work when another sheet is worked on", () => {
    // Paging away and back must not cost an hour of review.
    let byPage = setOnThisSheet<string[]>({}, 9, ["a102 review"]);
    byPage = setOnThisSheet(byPage, 15, ["a120 review"]);
    expect(onThisSheet(byPage, 9)).toEqual(["a102 review"]);
    expect(onThisSheet(byPage, 15)).toEqual(["a120 review"]);
  });

  it("clears ONE sheet, leaving the others alone", () => {
    let byPage = setOnThisSheet<string[]>({}, 9, ["a102 review"]);
    byPage = setOnThisSheet(byPage, 15, ["a120 review"]);
    byPage = setOnThisSheet<string[]>(byPage, 15, null);
    expect(onThisSheet(byPage, 15)).toBeNull();
    expect(onThisSheet(byPage, 9), "clearing A120 took A102's review too").toEqual([
      "a102 review",
    ]);
  });

  it("does not mutate the record it is given", () => {
    // The caller is React state; mutating it in place would make a render
    // decide the value had not changed.
    const before = setOnThisSheet<string[]>({}, 9, ["a102"]);
    const after = setOnThisSheet(before, 15, ["a120"]);
    expect(before).not.toBe(after);
    expect(onThisSheet(before, 15), "the original record was written to").toBeNull();
  });

  it("treats a stored null as nothing, so there is one empty answer", () => {
    const byPage = setOnThisSheet<string[]>({}, 9, null);
    expect(onThisSheet(byPage, 9)).toBeNull();
    expect(Object.keys(byPage)).toHaveLength(0);
  });
});
