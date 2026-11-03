import { describe, expect, it } from "vitest";
import { isLegendSheet } from "./symbolScope";

describe("isLegendSheet", () => {
  it("is a legend by its own title, and a plan that carries a legend is still a plan", () => {
    expect(["ELECTRICAL LEGEND", "SYMBOLS AND ABBREVIATIONS", "KEYNOTE LEGEND", "Lighting Symbols"].map(isLegendSheet)).toEqual([true, true, true, true]);
    expect(["ELECTRICAL LIGHTING LEVEL 1 PLAN", "LEGEND AND FIRST FLOOR PLAN", "FLOOR PLAN", null, ""].map(isLegendSheet)).toEqual([false, false, false, false, false]);
  });
});
