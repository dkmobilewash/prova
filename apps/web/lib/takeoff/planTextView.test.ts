import { describe, expect, it } from "vitest";
import { doorText, feetInches, openingsFromDoors } from "./planTextView";

describe("a scheduled door on a wall group", () => {
  it("reads as mark, width × height, and width alone where the schedule printed no height", () => {
    expect(doorText({ mark: "100A", widthFt: 6, heightFt: 7 })).toBe("100A · 6'-0\" × 7'-0\"");
    expect(doorText({ mark: "101", widthFt: 3, heightFt: null })).toBe("101 · 3'-0\"");
    expect(feetInches(2.5)).toBe("2'-6\"");
  });
  it("becomes an opening only with both figures; the rest are named, never guessed at 7 ft", () => {
    const out = openingsFromDoors([
      { mark: "100A", widthFt: 6, heightFt: 7 },
      { mark: "101", widthFt: 3, heightFt: null },
      { mark: "102", widthFt: 3, heightFt: 0 },
      { mark: "103", widthFt: 3, heightFt: 7 },
    ]);
    expect(out.openings).toEqual([
      { mark: "100A", widthFt: 6, heightFt: 7 },
      { mark: "103", widthFt: 3, heightFt: 7 },
    ]);
    expect(out.withoutHeight).toEqual(["101", "102"]);
  });
});
