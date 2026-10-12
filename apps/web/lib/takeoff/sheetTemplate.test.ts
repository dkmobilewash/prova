import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_SHEETS,
  ON_MOST_SHEETS,
  TEMPLATE_GRID,
  pagesToSample,
  templateFromSheets,
  withoutTemplate,
} from "./sheetTemplate";
import type { StrokeSegment } from "./wallVectors";

const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2 });

/** The frame and title-block lines a set repeats on every sheet. */
const TEMPLATE: StrokeSegment[] = [
  seg(0.012, 0.012, 0.988, 0.012), // border, top
  seg(0.012, 0.655, 0.988, 0.655), // border, bottom
  seg(0.012, 0.012, 0.012, 0.655), // border, left
  seg(0.988, 0.012, 0.988, 0.655), // border, right
  seg(0.82, 0.5, 0.98, 0.5), // a title-block cell
  seg(0.82, 0.56, 0.98, 0.56), // another
];

describe("the set's own template", () => {
  it("FINDS the lines that are on every sheet", () => {
    const sheets = [
      [...TEMPLATE, seg(0.3, 0.3, 0.5, 0.3)],
      [...TEMPLATE, seg(0.4, 0.2, 0.4, 0.45)],
      [...TEMPLATE, seg(0.2, 0.5, 0.6, 0.5)],
      [...TEMPLATE, seg(0.5, 0.1, 0.7, 0.1)],
    ];
    const template = templateFromSheets(sheets);
    expect(template.size, "the six template lines, and nothing else").toBe(TEMPLATE.length);
  });

  it("DROPS the title block from a sheet, which #722 could not reach", () => {
    // The point of this module. #722 fixed the frame geometrically and said in
    // as many words that the title-block cells were still counted, because they
    // are short runs INSIDE the border.
    const sheets = [
      [...TEMPLATE, seg(0.3, 0.3, 0.5, 0.3)],
      [...TEMPLATE, seg(0.4, 0.2, 0.4, 0.45)],
      [...TEMPLATE, seg(0.2, 0.5, 0.6, 0.5)],
    ];
    const template = templateFromSheets(sheets);
    const cleaned = withoutTemplate(sheets[0], template);
    expect(cleaned, "only the one real line on that sheet").toEqual([seg(0.3, 0.3, 0.5, 0.3)]);
  });

  it("KEEPS a wall that is on only one sheet", () => {
    const wall = seg(0.3, 0.3, 0.5, 0.3);
    const sheets = [[...TEMPLATE, wall], [...TEMPLATE], [...TEMPLATE], [...TEMPLATE]];
    expect(withoutTemplate(sheets[0], templateFromSheets(sheets))).toEqual([wall]);
  });

  // ── THE HAZARD THIS THRESHOLD EXISTS FOR ─────────────────────────────────
  //
  // Levels 3 to 10 of a tower are the SAME plan at the same page position, so
  // their real walls recur. A rule that dropped anything appearing twice would
  // delete the walls of exactly the repetitive buildings this tool is most
  // useful on — silently, which is the failure this directory is organised
  // against.

  it("KEEPS WALLS THAT REPEAT ON IDENTICAL FLOORS, because they are not on most sheets", () => {
    const floor = [seg(0.2, 0.3, 0.8, 0.3), seg(0.5, 0.1, 0.5, 0.6)];
    const sheets = [
      [...TEMPLATE, ...floor], // level 3
      [...TEMPLATE, ...floor], // level 4 — identical
      [...TEMPLATE, seg(0.25, 0.4, 0.6, 0.4)], // a structural sheet
      [...TEMPLATE, seg(0.33, 0.2, 0.33, 0.5)], // a mechanical sheet
      [...TEMPLATE, seg(0.7, 0.2, 0.9, 0.2)], // a detail sheet
      [...TEMPLATE, seg(0.15, 0.15, 0.45, 0.15)], // another
    ];
    const cleaned = withoutTemplate(sheets[0], templateFromSheets(sheets));
    expect(cleaned, "the two repeated floor walls survive").toHaveLength(2);
    expect(cleaned).toEqual(floor);
  });

  it("does drop them if ALMOST EVERY sheet is the same floor, and that is honest", () => {
    // Stated rather than hidden: a set that is nothing but identical floors has
    // no signal distinguishing its walls from its frame, and this module cannot
    // invent one. Six identical sheets is not a set, it is one sheet printed
    // six times.
    const floor = [seg(0.2, 0.3, 0.8, 0.3)];
    const sheets = Array.from({ length: 5 }, () => [...TEMPLATE, ...floor]);
    expect(withoutTemplate(sheets[0], templateFromSheets(sheets))).toHaveLength(0);
  });

  // ── FAIL-SAFE ────────────────────────────────────────────────────────────

  it("FILTERS NOTHING when too few sheets were sampled", () => {
    // "Cannot tell" must not mean "drop it". The cost of not filtering is a
    // border in the panel, which #722 catches and a person can see; the cost of
    // the other default is a wall quietly missing from a bid.
    const sheets = [[...TEMPLATE], [...TEMPLATE]];
    expect(sheets.length).toBeLessThan(MIN_SHEETS);
    expect(templateFromSheets(sheets).size).toBe(0);
    expect(withoutTemplate(sheets[0], templateFromSheets(sheets))).toHaveLength(TEMPLATE.length);
  });

  it("ignores sheets that came back empty rather than counting them", () => {
    // A page that would not parse is not evidence that a line is absent from
    // it. Counting it would push every template line below the threshold and
    // silently disable the filter.
    const sheets = [[...TEMPLATE], [], [...TEMPLATE], [], [...TEMPLATE]];
    expect(templateFromSheets(sheets).size).toBe(TEMPLATE.length);
  });

  it("COUNTS A LINE REPEATED ENOUGH TIMES ON ONE SHEET ONCE, or that sheet templates itself", () => {
    // Mutation found the first version of this test toothless: with two copies
    // and a threshold of three, removing the dedup changed nothing. The bug it
    // guards needs the duplicates to REACH the threshold — which hatching in a
    // repeated block does easily, and then one sheet's own fill is treated as
    // the set's template and deleted from it.
    const repeated = seg(0.3, 0.3, 0.5, 0.3);
    const sheets = [
      [...TEMPLATE, repeated, { ...repeated }, { ...repeated }],
      [...TEMPLATE],
      [...TEMPLATE],
    ];
    const template = templateFromSheets(sheets);
    expect(template.size, "one sheet's repeated line became the template").toBe(TEMPLATE.length);
    expect(withoutTemplate(sheets[0], template), "its own line was deleted").toHaveLength(3);
  });

  it("counts a line drawn twice on one sheet ONCE", () => {
    // Otherwise a hatched block repeated on a single sheet looks like
    // recurrence all by itself.
    const twice = [...TEMPLATE, seg(0.3, 0.3, 0.5, 0.3), seg(0.3, 0.3, 0.5, 0.3)];
    const sheets = [twice, [...TEMPLATE], [...TEMPLATE]];
    const template = templateFromSheets(sheets);
    expect(template.has("200,200|333,200")).toBe(false);
    expect(template.size).toBe(TEMPLATE.length);
  });

  it("matches a line drawn in the opposite direction", () => {
    // The same line with its endpoints swapped is the same line. Without a
    // canonical order a template whose operators run the other way on one sheet
    // would never match itself.
    const forwards = seg(0.1, 0.1, 0.9, 0.1);
    const backwards = seg(0.9, 0.1, 0.1, 0.1);
    const sheets = [[forwards], [backwards], [forwards]];
    expect(templateFromSheets(sheets).size).toBe(1);
  });

  it("MATCHES AN IDENTICAL COORDINATE, which is the real case", () => {
    // One template rendered on many pages emits the same operators with the
    // same matrix, so a border line is at a bit-identical coordinate on every
    // sheet. That is what this has to match, and it does.
    const line = seg(0.5, 0.2, 0.5, 0.6);
    expect(templateFromSheets([[line], [{ ...line }], [{ ...line }]]).size).toBe(1);
  });

  it("DOES NOT MATCH ACROSS A GRID BOUNDARY, and the consequence is no filter rather than a wrong drop", () => {
    // Pinned because it is a real limitation and the first version of this test
    // asserted the opposite. Rounding to a grid cannot tolerate drift in
    // general: 0.5 lands in cell 333 and 0.500375 — a quarter of a grid step
    // away — lands in 334. Two values arbitrarily close can fall either side of
    // a boundary.
    //
    // It is left as it is because the failure DIRECTION is safe. A set whose
    // pages differ slightly in MediaBox could straddle a boundary, the template
    // would come back short, and the filter would stop dropping things — a
    // border in the panel, which #722 catches geometrically and a person can
    // see. The alternative, matching a neighbourhood of cells, risks pulling in
    // a genuinely different line, and nothing has measured that trade.
    //
    // If a real set ever shows its title block surviving this filter, THIS is
    // the first thing to check, and the fix is neighbourhood matching with the
    // measurement to justify it.
    const drifted = [
      [seg(0.5, 0.2, 0.5, 0.6)],
      [seg(0.500375, 0.2, 0.5, 0.6)],
      [seg(0.5, 0.2, 0.5, 0.6)],
    ];
    expect(templateFromSheets(drifted).size, "two of three is below the threshold").toBe(0);
  });

  it("does not match two lines that are genuinely apart", () => {
    const apart = [
      [seg(0.5, 0.2, 0.5, 0.6)],
      [seg(0.5 + TEMPLATE_GRID * 20, 0.2, 0.5 + TEMPLATE_GRID * 20, 0.6)],
      [seg(0.5, 0.2, 0.5, 0.6)],
    ];
    expect(templateFromSheets(apart).size).toBe(0);
  });

  it("exposes its threshold as a fraction below 1, deliberately", () => {
    // A cover sheet or a detail sheet legitimately carries a different frame.
    // Requiring every sample would find nothing the moment one odd sheet exists.
    expect(ON_MOST_SHEETS).toBeLessThan(1);
    expect(ON_MOST_SHEETS).toBeGreaterThan(0.5);
  });
});

describe("which pages to sample", () => {
  it("spreads across the whole document rather than taking the first few", () => {
    // The identical-floors guard made concrete: the first six sheets are a
    // cover, a code sheet and the lower floors — the neighbourhood where real
    // geometry repeats.
    const pages = pagesToSample(55, 11);
    expect(pages).toContain(11);
    expect(Math.max(...pages)).toBeGreaterThan(40);
    expect(Math.min(...pages)).toBeLessThan(10);
    expect(pages.length).toBeGreaterThanOrEqual(6);
  });

  it("always includes the page being measured", () => {
    expect(pagesToSample(55, 42)).toContain(42);
    expect(pagesToSample(9, 1)).toContain(1);
  });

  it("never asks for a page outside the document", () => {
    for (const count of [1, 2, 3, 7, 55, 300]) {
      const pages = pagesToSample(count, 1);
      expect(Math.min(...pages)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...pages)).toBeLessThanOrEqual(count);
      expect(new Set(pages).size, "no page sampled twice").toBe(pages.length);
    }
  });

  it("returns nothing for a document with no pages", () => {
    expect(pagesToSample(0, 1)).toEqual([]);
  });
});

describe("the call site, because no test here can open a PDF", () => {
  // A CENSUS, and its limits stated first. `templateFromSheets` is pure and
  // every case above exercises it, but the thing that matters — that the viewer
  // SAMPLES OTHER PAGES and feeds the result in before detection — needs
  // pdf.js, a real document and a canvas. So this reads the source.
  //
  // It can see that the functions are called and in what order. It CANNOT see
  // that the sampling works on a real set, which is why #722's click-list and
  // this one both end with somebody pressing the button on Augusta.
  //
  // The expo-router entry in CLAUDE.md is why this is here at all: three fixes
  // shipped green because a census proved the code was present while a
  // framework threw it away. A census says "written", never "honoured".

  const source = () => readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");

  it("SAMPLES OTHER PAGES and filters before detection", () => {
    const text = source();
    expect(text, "the sampler is not called").toContain("pagesToSample(doc.numPages, pageNumber)");
    expect(text, "the template is never built").toContain("templateFromSheets(sampled)");
    expect(text, "the strokes are never filtered").toContain("withoutTemplate(allInUnits, template)");

    // ORDER. Filtering after detection would leave the title block in the
    // groups and only change a count.
    const filteredAt = text.indexOf("withoutTemplate(allInUnits, template)");
    const detectedAt = text.indexOf("wallsFromBothEngines(");
    expect(filteredAt, "the filter must run BEFORE the detector").toBeLessThan(detectedAt);
  });

  it("FEEDS THE FILTERED SET to the detector, not the unfiltered one", () => {
    // The mutation this catches is the quiet one: compute the template, report
    // the count, and then hand the detector `allInUnits` anyway. Every number
    // on screen would look right and nothing would be filtered.
    const text = source();
    expect(text).toContain("wallsFromBothEngines(inUnits,");
    expect(text, "the detector was handed the unfiltered strokes").not.toContain(
      "wallsFromBothEngines(allInUnits,",
    );
  });

  it("SAYS how many strokes the template accounted for", () => {
    // A filter that quietly returns a smaller number is how the next
    // unexplained figure gets created. If the count is large and the panel is
    // empty, the filter is the first thing to suspect rather than the sheet.
    const text = source();
    // NOT just that the setter is called: mutation showed `setTemplateStrokes(0)`
    // passes a looser check while reporting nothing.
    expect(text).toContain("setTemplateStrokes(templateDropped)");
    expect(text).toContain("templateDropped = allInUnits.length - kept.length");
    expect(text).toContain("appear in the same place on the rest of the set");
  });

  it("FALLS THROUGH to the geometric filters when a page will not parse", () => {
    // A set with one bad page must still measure the sheet in front of
    // somebody. The fail-safe direction is "no template filter", never "no
    // walls".
    const text = source();
    const guarded = text.slice(text.indexOf("const sampled: StrokeSegment[][] = [];"));
    expect(guarded.slice(0, 2000)).toContain("inUnits = allInUnits;");
  });
});
