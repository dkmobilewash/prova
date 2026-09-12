import { describe, expect, it } from "vitest";
import {
  MAX_PUNCH_ITEMS,
  punchItemKey,
  splitPunchItems,
  tooManyPunchItems,
} from "./punch-list-items";

/**
 * The splitting and matching that decide what a pasted list MEANS, with no
 * database in sight. These are the two places a list can go wrong quietly:
 * a line that turns into an item nobody typed, and two items treated as one.
 */
describe("splitPunchItems", () => {
  it("takes one item per line and counts the blanks it dropped", () => {
    expect(splitPunchItems("Grid out of level\n\nCorner bead missing\n   \n")).toEqual({
      descriptions: ["Grid out of level", "Corner bead missing"],
      blanks: 3,
    });
  });

  it("handles a paste with carriage returns", () => {
    expect(splitPunchItems("One thing\r\nAnother thing").descriptions).toEqual(["One thing", "Another thing"]);
  });

  it("strips the list punctuation a paste brings with it, and nothing else", () => {
    expect(
      splitPunchItems("- Grid out of level\n* Corner bead\n• Touch-up paint\n1. Door hardware\n2) Sealant at sill")
        .descriptions,
    ).toEqual(["Grid out of level", "Corner bead", "Touch-up paint", "Door hardware", "Sealant at sill"]);
  });

  it("leaves a count at the start of a real item alone", () => {
    // "2 doors" is the item. Only `1.` / `1)` / a bullet is punctuation.
    expect(splitPunchItems("2 doors missing hardware\n3rd floor grid low").descriptions).toEqual([
      "2 doors missing hardware",
      "3rd floor grid low",
    ]);
  });

  it("finds nothing in a string with nothing in it", () => {
    expect(splitPunchItems("").descriptions).toEqual([]);
    expect(splitPunchItems("\n\n  \n").descriptions).toEqual([]);
    expect(splitPunchItems("-\n*").descriptions).toEqual(["-", "*"]);
  });
});

describe("punchItemKey", () => {
  it("treats case and run-of-whitespace differences as the same item", () => {
    expect(punchItemKey("Ceiling  GRID out   of level ")).toBe(punchItemKey("ceiling grid out of level"));
  });

  it("treats a difference of words as a different item", () => {
    expect(punchItemKey("Grid out of level, east corridor")).not.toBe(punchItemKey("Grid out of level, west corridor"));
  });
});

describe("tooManyPunchItems", () => {
  it("names both numbers, so the refusal says what to do next", () => {
    const message = tooManyPunchItems(40);
    expect(message).toContain("40");
    expect(message).toContain(String(MAX_PUNCH_ITEMS));
  });
});
