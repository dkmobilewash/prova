import { describe, expect, it } from "vitest";
import { floorPlansOfTheWork, type WallsSheet } from "./walls";

// Baker's shape: a numberless cover on page 5, before A100 (overall) and A101.
const sheet = (pageNumber: number, sheetNumber: string | null, title: string | null, hasScale: boolean): WallsSheet => ({ pageNumber, sheetNumber, title, hasScale, hasWalls: false });

describe("the floor plan the workspace opens on (#996, the cover found by the new-customer walk)", () => {
  it("before any scale: A101, never the cover the forced scale would count", () => {
    expect(floorPlansOfTheWork([sheet(5, null, "COVER SHEET", false), sheet(12, "A100", "OVERALL FLOOR PLAN", false), sheet(13, "A101", "FLOOR PLAN", false)])).toEqual([13]);
    expect(floorPlansOfTheWork([sheet(5, null, null, false), sheet(12, "A100", "OVERALL FLOOR PLAN", false), sheet(13, "A101", "FLOOR PLAN", false)])).toEqual([13]);
  });
  it("once the floor plans are scaled: the one the run takes", () => {
    expect(floorPlansOfTheWork([sheet(5, null, "COVER SHEET", false), sheet(12, "A100", "OVERALL FLOOR PLAN", true), sheet(13, "A101", "FLOOR PLAN", true)])).toEqual([13]);
  });
  it("with only the overall plan scaled, still A101: a scale does not say which sheet is the work", () => {
    expect(floorPlansOfTheWork([sheet(5, null, null, false), sheet(12, "A100", "OVERALL FLOOR PLAN", true), sheet(13, "A101", "FLOOR PLAN", false)])).toEqual([13]);
  });
  it("and a scaled cover is still not where the work is", () => {
    expect(floorPlansOfTheWork([sheet(5, null, null, true), sheet(12, "A100", "OVERALL FLOOR PLAN", true), sheet(13, "A101", "FLOOR PLAN", true)])).toEqual([13]);
  });
});
