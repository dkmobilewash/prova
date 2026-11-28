import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codePlanTitle } from "./heldOutSets";

/**
 * Diego's ruling (BOARD.md 2026-11-21): a code / life-safety / egress plan is
 * never the plan of the work, and its keyed walls double-price the set when
 * it repeats the architectural floor — measured on Joplin G-101 (101/120
 * walls aligned with A-101's under one shift, lengths within 0.3%).
 */
describe("codePlanTitle", () => {
  it("matches the measured duplicate and the product's LS family", () => {
    expect(codePlanTitle("FIRST FLOOR CODE FOOTPRINT PLAN")).toBe(true);
    expect(codePlanTitle("LIFE-SAFETY FLOOR PLAN")).toBe(true);
    expect(codePlanTitle("LIFE SAFETY PLAN")).toBe(true);
    expect(codePlanTitle("EGRESS PLAN - LEVEL 1")).toBe(true);
    expect(codePlanTitle("CODE ANALYSIS PLAN")).toBe(true);
  });

  it("does not match floor plans or code TABLES", () => {
    expect(codePlanTitle("FIRST FLOOR PLAN")).toBe(false);
    expect(codePlanTitle("PROPOSED GROUND FLOOR PLAN")).toBe(false);
    expect(codePlanTitle("CODE ANALYSIS")).toBe(false);
    expect(codePlanTitle("BUILDING CODE SUMMARY")).toBe(false);
    expect(codePlanTitle(null)).toBe(false);
    expect(codePlanTitle("")).toBe(false);
  });

  it("gates the eval's wall terms (wiring census, comment-stripped)", () => {
    const src = readFileSync(join(__dirname, "realplan/zzZeroTouch.eval.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(src).toMatch(/const wallTest = wallTestFromLabels\(saved\) && enlargedWhy === null && !codePlan && demoWhy === null;/);
    expect((src.match(/codePlanTitle\s*\(/g) ?? []).length, "the eval never calls codePlanTitle").toBeGreaterThanOrEqual(1);
  });
});
