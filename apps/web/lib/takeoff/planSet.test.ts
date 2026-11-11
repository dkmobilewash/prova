import { describe, expect, it } from "vitest";
import type { ScalePrefill } from "@/lib/takeoff-plan-view";
import { planSetRows, scaleStepDone, sheetCategory } from "./planSet";

// Titles invented, in the shapes title blocks print.
describe("sorting a set", () => {
  it("names each kind of sheet", () => {
    expect(sheetCategory("A101", "FIRST FLOOR PLAN", "PLAN")).toBe("floor");
    expect(sheetCategory("A2", "LEVEL 2 PLAN", null)).toBe("floor");
    expect(sheetCategory("A001", "DEMOLITION PLAN AND ELEVATIONS", "PLAN")).toBe("demolition");
    expect(sheetCategory("AD101", "FIRST FLOOR", null)).toBe("demolition");
    expect(sheetCategory("A121", "REFLECTED CEILING PLAN", "PLAN")).toBe("rcp");
    expect(sheetCategory("A201", "EXTERIOR ELEVATIONS", "ELEVATION")).toBe("elevations");
    expect(sheetCategory("A501", "WALL SECTIONS", "SECTION")).toBe("details");
    expect(sheetCategory("A601", "DOOR SCHEDULE", "SCHEDULE")).toBe("schedules");
    expect(sheetCategory("G001", "COVER SHEET", "COVER")).toBe("cover");
    expect(sheetCategory("E101", "LEVEL 1 PLAN", "PLAN")).toBe("other");
    // ELEVEN03: the reader said OTHER and the title names nothing a sub prices.
    for (const [n, t] of [["A1.1", "CODE SHEET"], ["A1.3A", "UL SHEETS_L521"], ["A1.6A", "ICC ANSI SHEET 2 (2017)"], ["A1.7", "2010 ADA SHEET 1"], ["A1.8", "TAS SHEET 1"], ["A4.E", "PERSPECTIVES"]]) {
      expect(sheetCategory(n, t, "OTHER"), `${n} ${t}`).toBe("other");
    }
    // …while a plan the reader called PLAN, or a title that says plan, stays a floor plan.
    expect(sheetCategory("A3.9", "UNIT D1", "PLAN")).toBe("floor");
    expect(sheetCategory("A2.1", "FIRST FLOOR PLAN", "OTHER")).toBe("floor");
    expect(sheetCategory("A3.9", "UNIT D1", null)).toBe("floor");
    // With plan reading off (no page type): a keyless title that names no plan is not one to
    // scale (walk, 2026-11-08, E Street and Green Bay), while no title stays a floor plan.
    for (const [n, t] of [["A8.2", "GUARDRAIL ATTACHMENT"], ["A5.1", "OFFICE 7 - NORTH"], ["A2.4", "SKYLIGHT PERFORMANCE"], ["A1.0", "ARCHITECTURAL INFORMATION"]]) {
      expect(sheetCategory(n, t, null), `${n} ${t}`).toBe("other");
    }
    expect(sheetCategory("A4.1", "ENLARGED PLANS", null)).toBe("floor");
    expect(sheetCategory("A3.1", null, null)).toBe("floor");
  });

  it("a floor plan that carries elevations too is still the floor plan", () => {
    expect(sheetCategory("A102", "FLOOR PLAN & ENLARGED ELEVATIONS", "PLAN")).toBe("floor");
  });
});

const offer = (more: Partial<ScalePrefill> = {}): ScalePrefill => ({
  scaleName: '1/8" = 1\'-0"', xs: [0.1, 0.4], ys: [0.5, 0.5], declaredFeet: 40, declaredText: "40'-0\"", agreed: ["40'-0\"", "12'-0\""], considered: 5, unconfirmed: false, inheritedError: 0.001, ...more,
});

describe("each sheet's scale and how sure it is", () => {
  const sheets = new Map([
    [1, { number: "G001", title: "COVER SHEET", pageType: "COVER" }],
    [2, { number: "A101", title: "FIRST FLOOR PLAN", pageType: "PLAN" }],
    [3, { number: "A102", title: "SECOND FLOOR PLAN", pageType: "PLAN" }],
    [4, { number: "A103", title: "THIRD FLOOR PLAN", pageType: "PLAN" }],
    [5, { number: "A104", title: "FOURTH FLOOR PLAN", pageType: "PLAN" }],
  ]);
  const rows = planSetRows({
    pages: [1, 2, 3, 4, 5],
    sheets,
    scaled: new Set([5]),
    prefill: { 2: offer(), 3: offer({ unconfirmed: true, agreed: [] }), 1: offer() },
    printed: { 4: '1/4" = 1\'-0"' },
    multiScale: new Set(),
    decline: { 4: "only 1 printed dimension could be read" },
  });
  const at = (page: number) => rows.find((r) => r.pageNumber === page)!;

  it("floor plans first, the cover last", () => {
    expect(rows.map((r) => r.pageNumber)[0]).toBe(2);
    expect(rows.at(-1)?.category).toBe("cover");
  });

  it("dimensions that agree are sure; the title block alone is not, and offers the printed fix", () => {
    expect(at(2)).toMatchObject({ confidence: "high", why: "Matched 2 printed dimensions", printedFix: false });
    expect(at(3)).toMatchObject({ confidence: "printed", printedFix: true });
    expect(at(4)).toMatchObject({ confidence: "none", scaleName: null, why: 'only 1 printed dimension could be read (the title block says 1/4" = 1\'-0")' });
    expect(at(5).confidence).toBe("set");
  });

  it("a reduced print is not sure, and its correction is what it says", () => {
    const [row] = planSetRows({ pages: [2], sheets, scaled: new Set(), prefill: { 2: offer({ reducedPrintCaution: "Half-size print" }) }, printed: {}, multiScale: new Set(), decline: {} });
    expect(row).toMatchObject({ confidence: "printed", why: "Half-size print", printedFix: false });
  });

  it("the Scale step is done when every FLOOR PLAN has a scale, whatever the cover says", () => {
    expect(scaleStepDone(rows)).toBe(false);
    expect(scaleStepDone(rows.map((r) => (r.category === "floor" ? { ...r, confidence: "set" as const } : r)))).toBe(true);
    expect(scaleStepDone([{ category: "other", confidence: "set" }])).toBe(true);
    expect(scaleStepDone([{ category: "other", confidence: "high" }])).toBe(false);
  });
});

describe("with nothing named, the pages whose own drawings say FLOOR PLAN are the Scale step's floor plans", () => {
  // Baker with plan reading off: no sheet named; the inventory's caption read says p12 and p13
  // are floor plans; the scale reader was sure of p14 (the ceiling plan) only.
  const none = new Map<number, { number: string | null; title: string | null; pageType: string | null }>();
  const input = { pages: [12, 13, 14], sheets: none, scaled: new Set<number>(), prefill: {}, printed: { 12: '1/8" = 1\'-0"', 13: '1/8" = 1\'-0"' }, multiScale: new Set<number>(), decline: {} };
  it("lists them as floor plans, so the step is not done until they have a scale", () => {
    const rows = planSetRows({ ...input, sure: new Set([12, 13]) });
    expect(rows.filter((r) => r.category === "floor").map((r) => r.pageNumber)).toEqual([12, 13]);
    expect(scaleStepDone(planSetRows({ ...input, scaled: new Set([14]), sure: new Set([12, 13]) }))).toBe(false);
    expect(scaleStepDone(planSetRows({ ...input, scaled: new Set([12, 13, 14]), sure: new Set([12, 13]) }))).toBe(true);
  });
  it("without the caption read nothing is a floor plan, and any one scale finished the step (the bug)", () => {
    expect(planSetRows(input).some((r) => r.category === "floor")).toBe(false);
    expect(scaleStepDone(planSetRows({ ...input, scaled: new Set([14]) }))).toBe(true);
  });
  it("never overrides a sheet its title names as something else", () => {
    const named = new Map([[14, { number: "A111", title: "REFLECTED CEILING PLAN", pageType: null }]]);
    expect(planSetRows({ ...input, sheets: named, sure: new Set([14]) }).find((r) => r.pageNumber === 14)?.category).toBe("rcp");
  });
});

describe("the plan set counts the floor plans the takeoff needs, as the stepper does", () => {
  const sheets = new Map([
    [12, { number: "A100", title: "OVERALL FLOOR PLAN", pageType: null }],
    [13, { number: "A101", title: "FLOOR PLAN", pageType: null }],
  ]);
  const base = { pages: [12, 13], sheets, prefill: {}, printed: {}, multiScale: new Set<number>(), decline: {} };
  it("a floor plan the takeoff does not need (A100 overall) never holds the step open", () => {
    const rows = planSetRows({ ...base, scaled: new Set([13]), needed: new Set([13]) });
    expect(rows.find((r) => r.pageNumber === 12)).toMatchObject({ category: "floor", needed: false });
    expect(scaleStepDone(rows)).toBe(true);
  });
  it("without the needed list every floor plan counts, as before", () => {
    expect(scaleStepDone(planSetRows({ ...base, scaled: new Set([13]) }))).toBe(false);
  });
});
