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
