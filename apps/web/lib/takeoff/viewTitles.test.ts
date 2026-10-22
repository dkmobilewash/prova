import { describe, expect, it } from "vitest";
import { excludedViews, keptPlanViews, sheetDrawings, type ViewWalls } from "./sheetViews";
import { isLevelPlan, planLevel, viewClass, viewTitles } from "./viewTitles";
import type { StrokeSegment } from "./wallVectors";

/** An invented sheet, 2592pt wide: notes at 8pt, two big ruled titles, one big unruled room name. */
const W = 2592;
const H = 1728;
const notes = Array.from({ length: 40 }, (_, i) => ({ str: `NOTE ${i}`, x: 1800, y: 200 + i * 12, width: 60, height: 8 }));
const items = [
  ...notes,
  // A title split into two items on one baseline, ruled beneath.
  { str: "FIRST FLOOR", x: 300, y: 1400, width: 140, height: 14 },
  { str: "PLAN", x: 450, y: 1400, width: 50, height: 14 },
  { str: "1/8\" = 1'-0\"", x: 300, y: 1418, width: 80, height: 8 },
  // A second drawing, titled and ruled, no scale printed.
  { str: "EAST ELEVATION", x: 1300, y: 1400, width: 170, height: 14 },
  // Big lettering with no rule: a room name, not a title.
  { str: "LOBBY", x: 600, y: 700, width: 60, height: 14 },
  // The sheet's own title in the title block, big and ruled: a repeat of the drawing's.
  { str: "FIRST FLOOR PLAN", x: 2400, y: 1500, width: 120, height: 14 },
  // A bubble number beside the first title, big, ruled by the same rule.
  { str: "1", x: 270, y: 1400, width: 10, height: 14 },
];
const rule = (x1: number, x2: number, y: number): StrokeSegment => ({ x1, y1: y, x2, y2: y });
const segments: StrokeSegment[] = [
  rule(260, 520, 1412),
  rule(1290, 1480, 1412),
  rule(2390, 2530, 1512),
  // Two drawings' line work, a gutter apart, and a title-block strip at the right.
  ...Array.from({ length: 30 }, (_, i) => rule(300, 900, 300 + i * 30)),
  ...Array.from({ length: 30 }, (_, i) => rule(1300, 1900, 300 + i * 30)),
  ...Array.from({ length: 10 }, (_, i) => rule(2380, 2560, 200 + i * 120)),
];

describe("a drawing's title is big AND ruled", () => {
  it("joins split lettering, takes the rule, and drops big text with no rule and bare numbers", () => {
    const got = viewTitles({ items, segments, widthPt: W });
    expect(got.map((t) => t.text)).toEqual(["1 FIRST FLOOR PLAN", "EAST ELEVATION", "FIRST FLOOR PLAN"]);
    expect(got[0].heightPt).toBe(14);
    expect(got[0].medianPt).toBe(8);
  });

  it("finds nothing on a sheet whose titles are set at the notes' size — the ELEVEN03 case", () => {
    const flat = items.map((i) => ({ ...i, height: 8 }));
    expect(viewTitles({ items: flat, segments, widthPt: W })).toEqual([]);
  });

  it("names the kind in takeoffRank's words", () => {
    expect(viewClass("FIRST FLOOR PLAN").kind).toBe("floor-plan");
    expect(viewClass("ENLARGED TOILET PLAN").kind).toBe("enlarged-plan");
    expect(viewClass("REFLECTED CEILING PLAN").kind).toBe("rcp");
    expect(viewClass("EAST ELEVATION").kind).toBe("elevation");
    expect(viewClass("WALL SECTION").kind).toBe("section");
    expect(viewClass("DOOR SCHEDULE").kind).toBe("text-block");
    expect(viewClass("KEY PLAN").kind).toBe("key-plan");
    expect(viewClass("ROOF PLAN").kind).toBe("roof");
    expect(viewClass("SITE PLAN").kind).toBe("site");
    expect(viewClass("LIGHTING PLAN").kind).toBe("not-a-plan");
    expect(viewClass("FLOOR PLAN NOTES").kind).toBe("text-block");
    expect(viewClass("WALL LEGEND").kind).toBe("text-block");
    expect(viewClass("GLAZING").kind).toBe("unknown");
  });
});

describe("the sheet's drawings, by title or by caption", () => {
  it("gives each title its region, keeps the captioned view once, and drops the title block's own title", () => {
    const got = sheetDrawings({ items, segments, pageSize: { widthPt: W, heightPt: H } });
    const names = got.map((v) => v.name);
    expect(names).toContain("EAST ELEVATION");
    expect(names.some((n) => n.includes("FIRST FLOOR PLAN"))).toBe(true);
    expect(names).not.toContain("FIRST FLOOR PLAN");
    expect(names.filter((n) => n.includes("FIRST FLOOR PLAN"))).toHaveLength(1);
    const plan = got.find((v) => v.name.includes("FIRST FLOOR PLAN"))!;
    const elev = got.find((v) => v.name === "EAST ELEVATION")!;
    // The captioned plan keeps its scale; the title-only elevation has none.
    expect(plan.scaleName).toBe("1/8\" = 1'-0\"");
    expect(elev.feetPerInch).toBeNull();
    // Each owns its own side of the gutter.
    expect(plan.to).toBeLessThanOrEqual(elev.from + 1e-9);
  });

  it("returns nothing when neither route finds a drawing, so the caller measures the sheet whole", () => {
    expect(sheetDrawings({ items: notes, segments, pageSize: { widthPt: W, heightPt: H } })).toEqual([]);
  });
});

describe("every floor keeps its walls; a floor drawn twice keeps one", () => {
  const vw = (name: string, lengthFeet: number): ViewWalls =>
    ({ view: { name, scaleName: null, feetPerInch: null, captionX: 0, captionY: 0, from: 0, to: 1, fromY: 0, toY: 1 }, found: {} as ViewWalls["found"], walls: [], lengthFeet }) as ViewWalls;

  it("reads the level a title names", () => {
    expect(planLevel("1st Floor Plan (P2)")).toBe("1");
    expect(planLevel("2nd - 9th Floor Plan (P2)")).toBe("2-9");
    expect(planLevel("BLDG. FLOOR PLAN LEVEL 1")).toBe("1");
    expect(planLevel("Penthouse Floor (P2)")).toBe("PENTHOUSE");
    expect(planLevel("CRITICAL DIMENSION PLAN - MAIN LEVEL")).toBe("MAIN LEVEL");
    expect(planLevel("FLOOR PLAN - WAREHOUSE")).toBeNull();
    expect(planLevel("FLOOR PLAN - LEVEL 2 - MEZZANINE")).toBe("2 MEZZANINE");
    expect(viewClass("Penthouse Floor (P2)").kind).toBe("floor-plan");
    expect(isLevelPlan("Penthouse Floor (P2)")).toBe(true);
    expect(isLevelPlan("2ND FLOOR FRAMING PLAN")).toBe(false);
  });

  it("does not list a level-named floor plan as something to check", () => {
    const view = { name: "Penthouse Floor (P2)", scaleName: '1/8" = 1\'-0"', feetPerInch: 8, captionX: 0, captionY: 0, from: 0, to: 1, fromY: 0, toY: 1 };
    expect(excludedViews([view])).toEqual([]);
    expect(excludedViews([{ ...view, name: "WALL LEGEND", textBlock: true }])[0]?.reason).toContain("not a drawing");
  });

  it("keeps one view per level and the primary among same-level duplicates", () => {
    const got = keptPlanViews([vw("2nd - 9th Floor Plan (P2)", 900), vw("1st Floor Plan (P2)", 700), vw("Penthouse Floor (P2)", 60)]);
    expect(got.kept.map((k) => k.view.name)).toEqual(["2nd - 9th Floor Plan (P2)", "1st Floor Plan (P2)", "Penthouse Floor (P2)"]);
    const twice = keptPlanViews([vw("DIMENSION PLAN - WAREHOUSE", 50), vw("FLOOR PLAN - WAREHOUSE", 40)]);
    expect(twice.kept.map((k) => k.view.name)).toEqual(["FLOOR PLAN - WAREHOUSE"]);
    const mezz = keptPlanViews([vw("FLOOR PLAN - LEVEL 2 - MEZZANINE", 282), vw("FLOOR PLAN - LEVEL 2", 233), vw("FLOOR PLAN - LEVEL 3", 96)]);
    expect(mezz.kept).toHaveLength(3);
    const enlarged = keptPlanViews([vw("FLOOR PLAN", 400), vw("ENLARGED TOILET PLAN", 90)]);
    expect(enlarged.kept.map((k) => k.view.name)).toEqual(["FLOOR PLAN"]);
    expect(keptPlanViews([vw("RESTROOM - ENLARGED PLAN", 16)]).kept).toHaveLength(1);
  });
});
