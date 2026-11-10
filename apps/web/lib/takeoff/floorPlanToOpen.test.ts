import { describe, expect, it } from "vitest";
import { floorPlanToOpen, sureFloorPlan, type SheetReading } from "./takeoffSheet";

const sheet = (pageNumber: number, viewNames: string[], sheetNumber: string | null = null, title: string | null = null): SheetReading => ({ pageNumber, sheetNumber, title, viewNames });

describe("where the workspace opens when its sheet refuses Run takeoff", () => {
  it("a reflected ceiling plan is never a floor plan; a captioned FLOOR PLAN is", () => {
    expect(sureFloorPlan(sheet(14, ["REFLECTED CEILING PLAN"]))).toBe(false);
    expect(sureFloorPlan(sheet(13, ["FLOOR PLAN"]))).toBe(true);
    expect(sureFloorPlan(sheet(13, [], "A101", "FIRST FLOOR PLAN"))).toBe(true);
  });
  it("a sheet nothing names is offered, but it is not SURE", () => {
    expect(sureFloorPlan(sheet(3, []))).toBe(false);
    expect(sureFloorPlan(sheet(3, ["DETAIL 4"]))).toBe(false);
  });
  it("picks a sure floor plan, never the ceiling plan, and none when nothing is sure", () => {
    const set = [sheet(1, ["COVER SHEET"]), sheet(13, ["FLOOR PLAN"]), sheet(14, ["REFLECTED CEILING PLAN"]), sheet(20, ["EXTERIOR ELEVATION"])];
    expect(floorPlanToOpen(set)).toBe(13);
    expect(floorPlanToOpen([sheet(14, ["REFLECTED CEILING PLAN"]), sheet(3, [])])).toBeNull();
  });
  it("the first floor plan in page order, the sheet before it ranking no better", () => {
    const set = [sheet(2, ["REFLECTED CEILING PLAN"]), sheet(12, [], "A100", "OVERALL FLOOR PLAN"), sheet(13, [], "A101", "FLOOR PLAN - AREA A")];
    expect(floorPlanToOpen(set)).toBe(12);
  });
});
