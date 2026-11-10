import { describe, expect, it } from "vitest";
import { byThickness } from "./reviewQueue";

describe("an untagged group's picker: the legend's types, closest drawn thickness first", () => {
  const thick: Record<string, number | null> = { A: 4.875, B: 7.25, C: null, D: 4.875, E: 8 };
  const of = (c: string) => thick[c] ?? null;
  it("puts the closest first, keeps legend order on a tie, and a type with no thickness last", () => {
    expect(byThickness(["A", "B", "C", "D", "E"], of, 5).map((r) => r.code)).toEqual(["A", "D", "B", "E", "C"]);
    expect(byThickness(["A", "B", "C", "D", "E"], of, 7.5).map((r) => r.code)).toEqual(["B", "E", "A", "D", "C"]);
  });
  it("leaves the legend order alone when no type has a thickness", () => {
    expect(byThickness(["C", "X", "Y"], () => null, 6).map((r) => r.code)).toEqual(["C", "X", "Y"]);
  });
  it("carries each type's thickness for the label beside it", () => {
    expect(byThickness(["B"], of, 7)).toEqual([{ code: "B", thicknessIn: 7.25 }]);
  });
});
