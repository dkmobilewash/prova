import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calibrationForView, feetPerUnitFrom, sheetScale, viewScalesFromJson } from "./sheetScale";

/**
 * ── THE APP AND THE REPORT MUST DECIDE A SCALE THE SAME WAY ──
 *
 * For weeks they did not. The real-plan report ran `readSheetScale` and
 * stopped; the app ran `readSheetScale` and then fell back to the PRINTED
 * scale. Four real sheets were therefore reported as "no scale" that the app
 * reads perfectly, and the measure understated the product it exists to
 * measure. Nobody was wrong in isolation — there were simply two
 * implementations of one decision, and the second one drifted.
 *
 * That is the same failure as the profiler that divided by the page width
 * twice while `findWallsOnSheet` divided again, recorded in AUDIT.md. Both
 * were found by noticing two numbers that could not both be right, weeks
 * later. This file is the attempt to have the build notice instead.
 *
 * ── WHAT THIS CAN AND CANNOT CHECK ──
 *
 * It CANNOT run the two pipelines against a real PDF: the drawings are a
 * client's and live outside the repository, and a test that skips without them
 * is a test that passes on nothing. So it checks the two things that are true
 * without a PDF:
 *
 *   1. the ORDER is in one place and both callers reach it — a census, because
 *      "both call the same function" is a fact about source;
 *   2. that function's behaviour at each step, which is what used to differ.
 *
 * A census is the weaker half and is honest about it: it proves the call is
 * written, never that the answer was used. The real-plan report's own numbers
 * are the other half, and they moved from "2 of 9 measured" to "8 of 9" when
 * this order was shared.
 */

const WEB = resolve(__dirname, "../..");

function source(path: string): string {
  return readFileSync(resolve(WEB, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

describe("one place decides what scale a sheet is at", () => {
  it("THE APP CALLS IT — ingest, where the reading is written", () => {
    const ingest = source("lib/plan-ingest/pageInventory.ts");
    expect(ingest).toContain("sheetScale(");
    expect(ingest, "ingest stopped storing the per-view answer").toContain("viewScales");
  });

  it("THE REPORT CALLS IT, rather than carrying its own order", () => {
    const report = source("lib/takeoff/realplan/realSheets.eval.ts");
    expect(report).toMatch(/\bsheetScale\(|viewsWithOwnScale\(/);
  });

  it("the workspace reads the stored answer back", () => {
    const load = source("lib/takeoff/workspaceLoad.ts");
    expect(load).toContain("viewScalesFromJson");
    expect(load).toContain("viewScalesByPage");
  });

  it("and the viewer offers it, or the column is written and never used", () => {
    // The "written, documented, and never called" shape from CLAUDE.md, which
    // this repo has shipped three times. A stored column with no screen is
    // exactly that.
    const viewer = source("components/TakeoffPlanViewer.tsx");
    expect(viewer).toContain("ViewScaleOffer");
    expect(viewer).toContain("calibrationForView");
  });
});

describe("the order itself, which is what used to differ", () => {
  const base = {
    textItems: [],
    segments: [],
    pageSize: { widthPt: 2592, heightPt: 1728 },
  };

  it("a dimension beats everything, because it can be checked on the drawing", () => {
    const answer = sheetScale({
      ...base,
      fromDimensions: { ok: true, scaleName: '1/8" = 1\'-0"', feetPerInch: 8 },
      fromPrinted: { scaleName: '1/4" = 1\'-0"', feetPerInch: 4 },
    });
    expect(answer.kind).toBe("DIMENSIONS");
    expect(answer.kind === "DIMENSIONS" && answer.feetPerInch).toBe(8);
  });

  it("A PRINTED SCALE IS THE FALLBACK — the step the report was missing", () => {
    // This is the exact gap: four ELEVEN03 sheets each print ONE scale, the
    // app read it, and the report said "no scale" and measured nothing.
    const answer = sheetScale({
      ...base,
      fromDimensions: { ok: false, reason: "only 1 printed dimension agreed" },
      fromPrinted: { scaleName: '3/32" = 1\'-0"', feetPerInch: 10.666_666 },
    });
    expect(answer.kind).toBe("PRINTED");
  });

  it("falls to NOTHING, carrying the dimensions' own reason", () => {
    const answer = sheetScale({
      ...base,
      fromDimensions: { ok: false, reason: "this sheet is a scan" },
      fromPrinted: null,
    });
    expect(answer.kind).toBe("NONE");
    expect(answer.kind === "NONE" && answer.reason).toContain("scan");
  });

  it("does not invent views on a sheet with nothing drawn on it", () => {
    // `viewsInRegions` gives a caption a region even where there is no
    // geometry, so a legend or a note block would otherwise become a "drawing"
    // with a scale and be measured.
    const answer = sheetScale({
      ...base,
      fromDimensions: { ok: false, reason: "nothing readable" },
      fromPrinted: null,
    });
    expect(answer.kind).toBe("NONE");
  });
});

describe("feet per page unit is converted in one place", () => {
  it("turns a caption into the unit every measurement downstream wants", () => {
    // 1/8" = 1'-0" is 8 feet per paper inch; a 2592pt sheet is 36 inches.
    expect(feetPerUnitFrom(8, 2592)).toBeCloseTo(288, 6);
  });

  it("exists so nobody writes the ratio the wrong way round again", () => {
    // Getting `widthPt / 72` inverted gives a number 5,184 times out on this
    // sheet and throws nothing — which is the shape of the profiler bug in
    // AUDIT.md, measured for three weeks before anybody noticed.
    expect(feetPerUnitFrom(8, 2592)).not.toBeCloseTo((72 / 2592) * 8, 6);
  });
});

describe("the stored blob is read back as data, never trusted", () => {
  it("round-trips what the app writes", () => {
    const views = [
      { name: "FLOOR PLAN", scaleName: '1/8" = 1\'-0"', feetPerInch: 8, from: 0, to: 0.5, fromY: 0, toY: 0.6 },
    ];
    expect(viewScalesFromJson({ views })).toEqual(views);
  });

  it("REFUSES A VIEW WITH NO REGION rather than measuring the whole sheet", () => {
    // The failure this guard exists for: a view missing its bounds would be
    // measured across the entire page at a DETAIL's scale, which is the
    // "hundreds of feet that are not a building" case `sheetViews` was written
    // for. Refusing the whole blob is right — a half-understood record from
    // another build is worse than none.
    expect(
      viewScalesFromJson({ views: [{ name: "X", scaleName: "y", feetPerInch: 8, from: 0 }] }),
    ).toEqual([]);
  });

  it("refuses a nonsense scale, a wrong shape, and null", () => {
    expect(
      viewScalesFromJson({
        views: [{ name: "X", scaleName: "y", feetPerInch: 0, from: 0, to: 1, fromY: 0, toY: 1 }],
      }),
    ).toEqual([]);
    expect(viewScalesFromJson({ views: "not an array" })).toEqual([]);
    expect(viewScalesFromJson(null)).toEqual([]);
    expect(viewScalesFromJson({})).toEqual([]);
  });
});

describe("the line proposed for one view", () => {
  const view = {
    name: "ENLARGED RESTROOM PLAN",
    scaleName: '1/2" = 1\'-0"',
    feetPerInch: 2,
    from: 0.1,
    to: 0.5,
    fromY: 0.2,
    toY: 0.8,
  };

  it("spans the drawing's own region and says what that is in feet", () => {
    // The caption gives a RATIO, so the line has to come from somewhere. The
    // widest thing the ratio is certainly true about is the view's own region,
    // and a long line is a less error-prone one — the same argument
    // `scaleFromPrinted` makes for using the sheet's own width.
    const line = calibrationForView(view, 2592);
    // 5% inset each end of a 0.4-wide region.
    expect(line.x1).toBeCloseTo(0.12, 6);
    expect(line.x2).toBeCloseTo(0.48, 6);
    // Across the middle of the view's height, so it sits ON the drawing rather
    // than along an edge where a reviewer might miss it.
    expect(line.y1).toBeCloseTo(0.5, 6);
    expect(line.y2).toBeCloseTo(line.y1, 6);
    expect(line.declaredDistanceFeet).toBeCloseTo(0.36 * feetPerUnitFrom(2, 2592), 6);
  });

  it("INVENTS NO DIMENSION, which is what keeps this honest", () => {
    // Both numbers are facts about the file: the region comes from the sheet's
    // own gutters, and the feet are what the printed caption says that region
    // spans. Nothing is read off a dimension that is not there — the rule #623
    // set and `scaleFromPrinted` kept.
    const line = calibrationForView(view, 2592);
    expect(line.declaredDistanceFeet / (line.x2 - line.x1)).toBeCloseTo(
      feetPerUnitFrom(view.feetPerInch, 2592),
      6,
    );
  });

  it("scales with the sheet, not with a number baked in", () => {
    const big = calibrationForView(view, 2592);
    const small = calibrationForView(view, 1296);
    expect(big.declaredDistanceFeet).toBeCloseTo(small.declaredDistanceFeet * 2, 6);
    // …and the line itself is in page-WIDTH units, so it does not move.
    expect(big.x1).toBeCloseTo(small.x1, 6);
  });
});
