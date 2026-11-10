import { describe, expect, it } from "vitest";
import { nameSheet } from "@/lib/takeoff/realplan/nameSheet";
import { withoutSetBoilerplate } from "./keylessTitles";

// Walk, 2026-11-08 (Green Bay, plan reading off): "ROGUE NO.: DRAWN: ARCHITECTURAL INFORMATION SCL ROGUE".
describe("keyless sheet titles", () => {
  it("a label ending in a colon is never part of a title", () => {
    const at = (str: string, height: number) => ({ str, x: 900, y: 700, height });
    const named = nameSheet([at("A1.0", 30), at("NO.:", 14), at("DRAWN:", 14), at("ARCHITECTURAL", 14), at("INFORMATION", 14), at("x", 6), at("y", 6), at("z", 6)], { widthPt: 1000, heightPt: 800 });
    expect(named.title).toBe("ARCHITECTURAL INFORMATION");
  });

  it("a word recurring across the set's titles comes off, unless it is a drawing's word", () => {
    const titles = [
      "EGRESS PLAN AND CODE ANALYSIS SCL",
      "ARCHITECTURAL INFORMATION SCL ROGUE",
      "CRITICAL DIMENSION PLAN SCL ROGUE",
      "STANDARD ACCESSIBILITY DETAILS SCL ROGUE",
      "MECHANICAL FLOOR PLAN JCAA",
      "DEMOLITION - FLOOR PLAN",
      "FLOOR PLAN",
      null,
      "PERMIT SET",
      "ROOF PLAN",
      "MECHANICAL SCHEDULES JCAA",
      "DETAILS JCAA",
    ];
    expect(withoutSetBoilerplate(titles)).toEqual([
      "EGRESS PLAN AND CODE ANALYSIS",
      "ARCHITECTURAL INFORMATION",
      "CRITICAL DIMENSION PLAN",
      "STANDARD ACCESSIBILITY DETAILS",
      "MECHANICAL FLOOR PLAN",
      "DEMOLITION - FLOOR PLAN",
      "FLOOR PLAN",
      null,
      "PERMIT SET",
      "ROOF PLAN",
      "MECHANICAL SCHEDULES",
      "DETAILS",
    ]);
  });

  it("leaves a small set alone, and a title of nothing but boilerplate becomes no title", () => {
    expect(withoutSetBoilerplate(["A ROGUE", "B ROGUE", "ROGUE"])).toEqual(["A ROGUE", "B ROGUE", "ROGUE"]);
    expect(withoutSetBoilerplate(["FLOOR PLAN ROGUE", "ROOF PLAN ROGUE", "ROGUE", "DETAILS ROGUE"])).toEqual(["FLOOR PLAN", "ROOF PLAN", null, "DETAILS"]);
  });
});
