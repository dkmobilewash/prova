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

/**
 * A source file with its comments gone.
 *
 * At module scope and used by every census below, because this repo's house
 * style is to explain a defect where it was fixed — so the comment beside a
 * message routinely QUOTES the string a census forbids. CLAUDE.md records that
 * being paid for twice in one file in one afternoon.
 */
function code(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

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
    //
    // ── IT HAS NOW HAPPENED, AND THIS PARAGRAPH IS WHY IT IS NOT YET FIXED ──
    //
    // 2026-10-13: a West Herr floor plan on production reported 12,641 lines
    // left out and still showed about 32 runs on the title block and the logo.
    // That is exactly the sentence above coming true, and it names TWO
    // candidates rather than one: the grid straddled (this case), or the
    // threshold missed by a sheet — the furniture recurring on four of seven
    // sampled sheets because a consultant's sheets carry their own frame.
    //
    // Both fit the one number on screen, and they want opposite fixes. So
    // `realplan/sheetTemplate.eval.ts` prints the recurrence histogram for a
    // real set, which separates them in one run: a mass at ONE sheet that
    // collapses when the grid is loosened is this case, a mass just under the
    // line is the other. Neither constant is moved until that has been run on
    // the sheet it failed on — and neither bench set can produce the margin,
    // measured, so the suite cannot answer it.
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

  it("NEEDS FIVE OF SIX, which is not what this file's comment said for weeks", () => {
    // ── A FRACTION IS NOT A SHEET COUNT, AND THE GAP WAS A WHOLE SHEET ──
    //
    // `ON_MOST_SHEETS` was documented as "0.7 of six samples is four". It is
    // not: `6 * 0.7` is 4.199999999999999 in floating point, so `Math.ceil`
    // returns FIVE. The filter has always been one sheet stricter than its own
    // documentation, and strictness is the direction that leaves furniture on
    // the drawing.
    //
    // Pinned as a SHEET COUNT rather than restated as prose, because prose is
    // what drifted. A deliberate change to `ON_MOST_SHEETS` now has to come
    // here and write down what the new threshold actually is.
    expect(Math.ceil(6 * ON_MOST_SHEETS), "six samples").toBe(5);
    expect(Math.ceil(7 * ON_MOST_SHEETS), "seven samples — the usual run").toBe(5);

    // And the behaviour that count IS. Four of six sheets carry the line; it
    // survives. Nothing here is a judgement about whether five is the right
    // number — see the eval, which is how a real set would settle it.
    const onFourOfSix = [0, 1, 2, 3].map(() => [seg(0.82, 0.5, 0.98, 0.5)]);
    const odd = [[seg(0.3, 0.3, 0.5, 0.3)], [seg(0.4, 0.4, 0.6, 0.4)]];
    expect(templateFromSheets([...onFourOfSix, ...odd]).size, "four of six is below the line").toBe(0);

    const onFiveOfSix = [0, 1, 2, 3, 4].map(() => [seg(0.82, 0.5, 0.98, 0.5)]);
    expect(templateFromSheets([...onFiveOfSix, ...odd.slice(0, 1)]).size, "five of six clears it").toBe(1);
  });

  it("names the eval that would settle the threshold, because no case here can", () => {
    // ── WHY THIS IS A CENSUS AND NOT A MEASUREMENT ──
    //
    // Every case in this file builds its sheets by hand, so each one measures
    // the rule and none of them measures a drawing. Both bench sets were run
    // through the real filter on 2026-10-13 and neither can reach the
    // threshold's margin: their page furniture recurs on EVERY sampled sheet
    // (mesa-ridge 26 segments on 6 of 6, desert-willow 18 on 7 of 7), because
    // our generator draws a bare frame and no title block.
    //
    // So the instrument for the real question lives outside the suite, and this
    // asserts it still exists rather than letting the pointer rot.
    const evaluation = code("lib/takeoff/realplan/sheetTemplate.eval.ts");
    expect(evaluation.length, "the real-set histogram eval is gone").toBeGreaterThan(1_000);
    expect(evaluation, "it no longer reads the recurrence through the real function").toContain(
      "templateFromSheets(sampled, {",
    );
    expect(evaluation, "it no longer varies the grid, so a near-miss is invisible").toContain("GRIDS");
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

  const source = () => readFileSync(resolve(process.cwd(), "lib/takeoff/findWallsOnSheet.ts"), "utf8");

  it("SAMPLES OTHER PAGES and filters before detection", () => {
    const text = source();
    // THE SAMPLING AND THE FILTERING ARE NOW IN TWO PLACES, and the split is
    // the point: only a caller can open another page, so the viewer reads the
    // sheets and the pipeline decides what to drop. Each half is asserted
    // against the file that contains it.
    const caller = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    expect(caller, "the sampler is not called").toContain("pagesToSample(doc.numPages, pageNumber)");
    // A PATTERN RATHER THAN THE EXACT CALL, and the change is deliberate.
    // This read `templateFromSheets(input.sampledSheets)` as a literal and went
    // red the first time the samples were legitimately transformed on the way
    // in — the layer filter is applied to them so the template compares like
    // with like. The FACT worth pinning is that the template is built from the
    // caller's own samples and not from something re-derived here; the
    // spelling is not. Same lesson as the migration census that a single line
    // break disarmed: do not let formatting be load-bearing.
    expect(text, "the template is never built from the caller's samples").toMatch(
      /templateFromSheets\(\s*input\.sampledSheets/,
    );
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
    // THE ARITHMETIC IS THE PIPELINE'S; SAYING IT IS THE VIEWER'S. This used
    // to be one assertion over one file because both lived in the component.
    expect(text).toContain("templateDropped = allInUnits.length - kept.length");
    expect(
      readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8"),
      "the count is computed and never shown",
    ).toContain("setTemplateStrokes(found.templateDropped)");
    // THE SENTENCE IS THE VIEWER'S, the arithmetic above is the pipeline's.
    expect(
      readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8"),
    ).toContain("in the same place on other sheets of the set");
  });

  it("DOES NOT NAME WHAT IT REMOVED, because it does not know", () => {
    // ── THE DEFECT, FROM A REAL SHEET ──
    //
    // The sentence used to end "— the border, the title block and the logo — so
    // they were left out". On a West Herr floor plan clicked on production
    // 2026-10-13 it said that of 12,641 lines while roughly 32 runs sat on the
    // title block and the logo in the overlay underneath it.
    //
    // The filter establishes ONE fact: these lines are at the same page
    // position on other sheets. Which furniture that turned out to be, and
    // whether any was missed, it never checks — so naming three kinds told an
    // estimator all three were handled. Same shape as the no-walls sentence in
    // the same file, which asserted "a scanned or image-only sheet" as the
    // cause of an empty panel on a drawing that was plainly not a scan.
    //
    // COMMENTS STRIPPED, and that is load-bearing rather than tidy: the comment
    // beside this message quotes the exact phrase being forbidden, in order to
    // record why. A raw-text census here fails on the explanation of its own
    // rule — twice paid for on `OpeningDeductionForm.tsx`, see CLAUDE.md.
    const text = code("components/TakeoffPlanViewer.tsx");

    // Size first: a census that reads an empty string forbids nothing.
    expect(text.length, "the viewer's code read as empty — this census is guarding nothing").toBeGreaterThan(
      10_000,
    );
    expect(text, "the message is naming furniture the filter never verified it caught").not.toContain(
      "the title block and the logo",
    );
    // And it must still say the limit out loud, which is the half that makes
    // the number useful: a reviewer who is told some furniture survives looks
    // at the overlay, and that is how this was found in the first place.
    expect(text).toContain("can still show up below");
  });

  it("FALLS THROUGH to the geometric filters, but ONE bad page no longer costs the template", () => {
    // The fail-safe DIRECTION is unchanged and still the point: "no template
    // filter", never "no walls". A set with a bad page must still measure the
    // sheet in front of somebody.
    //
    // WHAT CHANGED IS THE TRIGGER, and this assertion used to pin the old one.
    // The viewer caught once around the whole page-sampling loop, so a single
    // unreadable sampled page abandoned the template for the entire set — and
    // the template is what removes the title block's own lines down the right
    // edge. That is why Baker A100 offered 87 candidates in one tab and 104 in
    // the next: same sheet, same code, one page that read on one attempt and
    // not the other.
    //
    // Now each page is read on its own, a failure is COUNTED rather than
    // fatal, and the template is given up only when fewer than two pages read.
    const text = source();
    expect(text).toContain("let inUnits = allInUnits;");
    expect(text).toContain("if (input.sampledSheets !== null)");

    const viewer = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    expect(viewer, "a failed page must be counted, not fatal to the template").toContain("sampleFailed += 1;");
    expect(
      viewer,
      "the template is abandoned only when fewer than two pages read, not when any one fails",
    ).toContain("sampledSheets = sampled.length > 1 ? sampled : null;");
    // The catch sits around ONE page's read, inside the sampling loop. A catch
    // around the loop is the old behaviour wearing the new shape, and the only
    // difference visible in source is where this counter lives.
    expect(
      viewer,
      "the failure must be caught per page, inside the sampling loop",
    ).toMatch(/catch \(error\) \{\s*sampleFailed \+= 1;/);
  });
});
