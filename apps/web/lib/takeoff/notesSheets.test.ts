import { describe, expect, it } from "vitest";
import { sheetCategory } from "./planSet";
import { takeoffRank } from "./sheetSuitability";
import { wallsSkipReason } from "@/lib/plan-ingest/walls";

// New-customer run v2, M7: the title-block read calls these PLAN, and they were
// filed as floor plans and taken off by the whole-set run.
describe("a notes or legend sheet is not a floor plan", () => {
  const notes: [string, string][] = [["A301", "GENERAL NOTES"], ["A601", "WALL TAG LEGEND"], ["A201", "GENERAL NOTES"], ["A002", "ABBREVIATIONS AND SYMBOLS"]];
  it("not in the plan set's floor plans, even where the read says PLAN", () => {
    for (const [number, title] of notes) expect(sheetCategory(number, title, "PLAN"), `${number} ${title}`).toBe("other");
  });
  it("and not a sheet the whole-set run takes off", () => {
    for (const [number, title] of notes) {
      expect(takeoffRank(number, title).score).toBeLessThan(0);
      expect(wallsSkipReason({ pageNumber: 1, sheetNumber: number, title, hasScale: true, hasWalls: false })).toBe("not a floor plan");
    }
  });
  it("while a floor plan with notes on it is still a floor plan", () => {
    expect(sheetCategory("A101", "FLOOR PLAN", "PLAN")).toBe("floor");
    expect(sheetCategory("A101", "FIRST FLOOR PLAN AND NOTES", "PLAN")).toBe("floor");
    expect(takeoffRank("A101", "FLOOR PLAN NOTES").score).toBeGreaterThan(0);
  });
});
