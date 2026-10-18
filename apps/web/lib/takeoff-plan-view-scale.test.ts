import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  scaleDeclinesFromReadings,
  errorBandText,
  evidenceOrder,
  scalePrefillsFromReadings,
  type ScaleReadingRowForView,
} from "./takeoff-plan-view";

/**
 * Turning a stored scale reading into something the calibration form can offer.
 *
 * Every test here is about REFUSING to offer a half-written row, because the
 * cost is asymmetric: a missing prefill costs the estimator the two clicks they
 * do today, and a malformed one would draw a line with one end and a figure
 * nobody chose, on a form whose button writes a scale that multiplies through
 * every quantity on the sheet.
 */

const row = (over: Partial<ScaleReadingRowForView> = {}): ScaleReadingRowForView => ({
  pageNumber: 1,
  scaleName: '1/8" = 1\'-0"',
  x1: 0.1,
  y1: 0.2,
  x2: 0.15,
  y2: 0.2,
  declaredDistanceFeet: "16.3750",
  declaredText: `16' - 4 1/2"`,
  agreedText: `16' - 4 1/2"\n11' - 0"\n6' - 0"`,
  consideredCount: 30,
  inheritedError: 0.00315,
  source: "DIMENSIONS",
  // Written by the reader on a decline and, until #672, shown to nobody.
  declineReason: null,
  ...over,
});

describe("what it offers", () => {
  it("carries the line, the figure and the evidence", () => {
    const byPage = scalePrefillsFromReadings([row()]);
    const prefill = byPage[1]!;
    expect(prefill.scaleName).toBe('1/8" = 1\'-0"');
    expect(prefill.xs).toEqual([0.1, 0.15]);
    expect(prefill.ys).toEqual([0.2, 0.2]);
    expect(prefill.declaredFeet).toBeCloseTo(16.375, 4);
    expect(prefill.declaredText).toBe(`16' - 4 1/2"`);
    expect(prefill.agreed).toEqual([`16' - 4 1/2"`, `11' - 0"`, `6' - 0"`]);
    expect(prefill.considered).toBe(30);
    expect(prefill.inheritedError).toBeCloseTo(0.00315, 5);
  });

  it("READS THE DECIMAL COLUMN WITHOUT LOSING A FRACTION OF AN INCH", () => {
    // `declaredDistanceFeet` is `Decimal(12,4)` and arrives as a string or a
    // Prisma Decimal, never a number. 16.375 is 16' 4 1/2" — a sixteenth lost
    // here is a sixteenth of error on every wall.
    expect(scalePrefillsFromReadings([row({ declaredDistanceFeet: "16.3750" })])[1]!.declaredFeet).toBe(16.375);
    expect(
      scalePrefillsFromReadings([row({ declaredDistanceFeet: { toString: () => "15.2865" } })])[1]!.declaredFeet,
    ).toBeCloseTo(15.2865, 4);
  });

  it("keys by page, keeping the newest row the query ordered first", () => {
    const byPage = scalePrefillsFromReadings([
      row({ pageNumber: 2, scaleName: '1/4" = 1\'-0"' }),
      row({ pageNumber: 2, scaleName: '1/8" = 1\'-0"' }),
    ]);
    expect(byPage[2]!.scaleName).toBe('1/4" = 1\'-0"');
  });
});

describe("what it refuses to offer", () => {
  it("offers nothing for a page that declined", () => {
    expect(scalePrefillsFromReadings([row({ scaleName: null })])).toEqual({});
  });

  it("offers nothing when an endpoint is missing — never a line with one end", () => {
    expect(scalePrefillsFromReadings([row({ x2: null })])).toEqual({});
    expect(scalePrefillsFromReadings([row({ y1: null })])).toEqual({});
  });

  it("offers nothing for a zero or negative distance", () => {
    expect(scalePrefillsFromReadings([row({ declaredDistanceFeet: "0" })])).toEqual({});
    expect(scalePrefillsFromReadings([row({ declaredDistanceFeet: "-4" })])).toEqual({});
  });

  it("offers nothing for a distance that is not a number", () => {
    expect(scalePrefillsFromReadings([row({ declaredDistanceFeet: null })])).toEqual({});
    expect(scalePrefillsFromReadings([row({ declaredDistanceFeet: "n/a" })])).toEqual({});
  });

  it("survives an empty evidence list rather than offering a blank sentence", () => {
    const prefill = scalePrefillsFromReadings([row({ agreedText: null })])[1]!;
    expect(prefill.agreed).toEqual([]);
    expect(prefill.scaleName).toBeTruthy();
  });

  it("drops blank lines out of the evidence", () => {
    const prefill = scalePrefillsFromReadings([row({ agreedText: `11' - 0"\n\n  \n6' - 0"` })])[1]!;
    expect(prefill.agreed).toEqual([`11' - 0"`, `6' - 0"`]);
  });

  it("offers nothing at all for no rows", () => {
    expect(scalePrefillsFromReadings([])).toEqual({});
  });
});

/**
 * WHERE THE SCALE CAME FROM, which changes what the screen says rather than
 * being metadata. See `ScalePrefill.unconfirmed`.
 */
describe("confirmed against the drawing, or not", () => {
  it("a DIMENSIONS reading is confirmed — the line sits on the dimension it came from", () => {
    expect(scalePrefillsFromReadings([row({ source: "DIMENSIONS" })])[1]!.unconfirmed).toBe(false);
  });

  it("a PRINTED reading is UNCONFIRMED — nothing on the sheet checks it", () => {
    expect(scalePrefillsFromReadings([row({ source: "PRINTED" })])[1]!.unconfirmed).toBe(true);
  });

  it("TREATS AN UNKNOWN SOURCE AS UNCONFIRMED, which is the safe default", () => {
    // A row written before this column existed, or by a later build with a third
    // source, must not quietly claim to be checkable. The dangerous direction is
    // claiming confirmation nobody has.
    expect(scalePrefillsFromReadings([row({ source: "" })])[1]!.unconfirmed).toBe(true);
    expect(scalePrefillsFromReadings([row({ source: "SOMETHING_NEW" })])[1]!.unconfirmed).toBe(true);
  });

  it("still offers a PRINTED reading — it is unconfirmed, not unusable", () => {
    const prefill = scalePrefillsFromReadings([row({ source: "PRINTED", agreedText: null })])[1]!;
    expect(prefill.scaleName).toBeTruthy();
    expect(prefill.agreed).toEqual([]);
    expect(prefill.unconfirmed).toBe(true);
  });
});

/**
 * WHAT THE OFFER SAYS ABOUT ITS OWN ACCURACY.
 *
 * Both of these were defects a click-through found on production, and both are
 * the same kind: the app stating one fact two ways. Neither was a wrong
 * calculation — which is why no existing test could see them, and why the
 * decisions now live in functions rather than inline in JSX.
 */
describe("wording the measured error", () => {
  it("does NOT print a floor as though it were the measurement", () => {
    // The shipped bug: 0.01% was displayed as "Within 0.05%" because the
    // component read `band < 0.05 ? "0.05" : …`, while the note beside it
    // formatted the real figure and said 0.01%. One quantity, two answers.
    expect(errorBandText(0.0001)).not.toContain("0.05");
  });

  it("states a sub-hundredth error as an inequality rather than inventing a value", () => {
    // `toFixed(2)` of 0.004 is "0.00", which claims perfection. There is no
    // decimal expansion of "smaller than my precision", so it says so.
    expect(errorBandText(0.00004)).toBe("under 0.01%");
    expect(errorBandText(0)).toBe("under 0.01%");
  });

  it("reports a real figure exactly, at the precision it has", () => {
    expect(errorBandText(0.00315)).toBe("0.32%"); // the measured deviation on a real CAD sheet
    expect(errorBandText(0.0017)).toBe("0.17%");
    expect(errorBandText(0.0114)).toBe("1.14%");
  });

  it("never rounds an error DOWN to zero, which would overstate the precision", () => {
    // The direction that matters: a reader deciding whether to trust this must
    // never be shown a smaller error than was measured.
    for (const e of [0.00005, 0.0001, 0.0005, 0.001, 0.005]) {
      expect(errorBandText(e)).not.toBe("0.00%");
    }
  });
});

describe("ordering the evidence row", () => {
  it("puts the QUOTED dimension first, so the row cannot contradict the sentence", () => {
    // The shipped bug, from a real sheet: 24 matched dimensions, the row showed
    // the first six, and the sentence quoted `25' - 0 1/2"` — which was not
    // among them. Both true; it reads as an error.
    const agreed = [`42' - 0"`, `84' - 0"`, `20' - 0"`, `4' - 0"`, `18' - 10"`, `6' - 4"`, `25' - 0 1/2"`];
    const shown = evidenceOrder(agreed, `25' - 0 1/2"`);
    expect(shown[0]).toBe(`25' - 0 1/2"`);
    expect(shown).toContain(`25' - 0 1/2"`);
  });

  it("still shows at most six, so a 117-dimension sheet does not print a wall of text", () => {
    const agreed = Array.from({ length: 117 }, (_, i) => `${i}' - 0"`);
    expect(evidenceOrder(agreed, `116' - 0"`)).toHaveLength(6);
  });

  it("does not duplicate the quoted dimension", () => {
    const shown = evidenceOrder([`60' - 0"`, `39' - 9"`, `4' - 4"`], `60' - 0"`);
    expect(shown.filter((t) => t === `60' - 0"`)).toHaveLength(1);
  });

  it("is unchanged when the quoted dimension is already first, or absent", () => {
    expect(evidenceOrder([`60' - 0"`, `39' - 9"`], `60' - 0"`)).toEqual([`60' - 0"`, `39' - 9"`]);
    // A printed-scale prefill has a scale NAME as its declaredText and no
    // agreeing dimensions at all; the row simply keeps its order.
    expect(evidenceOrder([`a`, `b`], `1/8" = 1'-0"`)).toEqual([`a`, `b`]);
    expect(evidenceOrder([], `60' - 0"`)).toEqual([]);
  });
});

/**
 * A SAVED SCALE MUST SHOW WHERE IT CAME FROM, and this is a census because the
 * defect was never a wrong value — it was a value that reached nobody.
 *
 * Since #655 the reader writes its own account into `TakeoffScaleCalibration.note`:
 * which dimensions it matched and how closely, or that it used the printed scale
 * with nothing confirming it. That is provenance for a number multiplying every
 * quantity on the sheet.
 *
 * It was rendered only INSIDE the draft form — and a sheet whose scale is
 * already set has no draft, so saving it made it invisible. A click-through went
 * looking on two sheets that saved successfully and reported, correctly, that
 * nothing on screen said which way either scale had been set. Stored and shown
 * nowhere is the "written, documented, and never called" shape wearing a
 * database column.
 *
 * WHAT THIS CANNOT PROVE, stated because this repo has paid for the confusion:
 * that React renders it. A census proves the code is THERE, never that a
 * framework honours it — three expo-router header fixes shipped green and
 * rendered nothing. The difference here is that nothing is being handed to a
 * navigator: it is plain JSX in the component's own return, so "present" and
 * "rendered" are the same claim. The part worth guarding is that it is present
 * at all, in both places, because the two lines are independently deletable and
 * the type system cannot see a prop that is passed and then ignored.
 */
describe("the provenance of a saved scale", () => {
  const viewer = readFileSync(new URL("../components/TakeoffPlanViewer.tsx", import.meta.url), "utf8");
  // Comments stripped: both files below discuss `existingNote` in prose, and a
  // raw-text census would count a sentence about it as a use of it.
  const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("is handed to the calibration form from the sheet's own calibration", () => {
    expect(code).toMatch(/existingNote=\{calibration\?\.note \?\? ""\}/);
  });

  it("is RENDERED, not merely accepted as a prop", () => {
    // The failure being guarded: `existingNote` destructured, typed, and never
    // put on screen — which is exactly what the previous version did with the
    // note itself.
    const destructured = /\n\s*existingNote,/.test(code);
    const rendered = /\{existingNote && \(/.test(code);
    expect(destructured).toBe(true);
    expect(rendered).toBe(true);
  });

  it("travels on the type, so a page that forgets it cannot compile", () => {
    const view = readFileSync(new URL("./takeoff-plan-view.ts", import.meta.url), "utf8");
    const type = view.slice(view.indexOf("export type PlanViewerCalibration"));
    expect(type.slice(0, type.indexOf("};"))).toMatch(/note: string \| null;/);
  });

  it("parsed the files it is reasoning about", () => {
    // The size assertion this family of census needs: a regex matching nothing
    // passes every expectation above it, since nothing is ever missing from an
    // empty string.
    expect(code.length).toBeGreaterThan(10_000);
    expect(code).toContain("function CalibrationForm");
  });
});

/**
 * SAYING WHY A SHEET HAS NO SCALE.
 *
 * The reader has recorded a reason for every decline since #655 and it was
 * written to the database and shown to NOBODY — the estimator got an empty form
 * and no explanation, which reads as a broken feature. Same shape as the
 * provenance bug: stored, and reaching no one.
 *
 * It matters most on the sets that provoked it. Two whole bid packages measured
 * here have their lettering saved as line work — 373,377 strokes and ZERO text
 * items on one sheet — so every sheet in both declines and the app looks broken
 * across a whole project. It is not: the dimensions are still printed, a person
 * reads them fine, and setting the scale by hand makes the wall finder work (150
 * walls on one of those sheets, measured).
 */
describe("why a sheet has no scale", () => {
  it("carries the reason the reader recorded", () => {
    const reasons = scaleDeclinesFromReadings([
      row({ pageNumber: 3, scaleName: null, declineReason: "its lettering was saved as line work" }),
    ]);
    expect(reasons[3]).toBe("its lettering was saved as line work");
  });

  it("says nothing for a sheet that simply has not been read", () => {
    // Silence is right for "not read yet" and wrong for "could not be read".
    // They are different states and must not look the same.
    expect(scaleDeclinesFromReadings([])).toEqual({});
    expect(scaleDeclinesFromReadings([row({ pageNumber: 1, declineReason: null })])).toEqual({});
  });

  it("ignores an empty or whitespace reason rather than showing a blank box", () => {
    expect(scaleDeclinesFromReadings([row({ pageNumber: 1, declineReason: "   " })])).toEqual({});
  });

  it("keeps the NEWEST reading's reason, as the prefill does", () => {
    // Rows arrive newest-first. A sheet re-read after a fix must not show the
    // old reason beside the new answer.
    const reasons = scaleDeclinesFromReadings([
      row({ pageNumber: 2, declineReason: "the new reason" }),
      row({ pageNumber: 2, declineReason: "the old reason" }),
    ]);
    expect(reasons[2]).toBe("the new reason");
  });

  it("is independent of whether a prefill was produced", () => {
    // The two derivations read the same rows and answer different questions.
    // A row can carry both — a scale AND a note about something it could not
    // do — and the component decides which to show.
    const rows = [row({ pageNumber: 1, declineReason: "something worth saying" })];
    expect(Object.keys(scalePrefillsFromReadings(rows))).toHaveLength(1);
    expect(scaleDeclinesFromReadings(rows)[1]).toBe("something worth saying");
  });
});

/**
 * ── THE REDUCED PRINT, AND THE PAGE THAT PROVED IT ──
 *
 * A half-size print carries the FULL-SIZE scale name in its title block. On the
 * 60-page answer key three pages are half-size prints of an ARCH D original,
 * and they split exactly along whether the dimension path happened to work:
 *
 *   p11: 18in, 20 labels, dimensions 16.00 ft/in -> uses 16.00, measured, key 66%
 *   p17: 18in, 32 labels, dimensions 16.00 ft/in -> uses 16.00, measured, key 66%
 *   p50: 18in,  0 labels, dimensions DECLINED    -> used 8.00 FROM THE NAME,
 *                                                   key 32% — worst of 60 pages
 *
 * So p50 measured every length at half, and its own sister pages prove what the
 * scale should have been. These are p50's numbers.
 */

/** The set is ARCH D; the reduced pages are ARCH B, which is exactly half. */
const SET_WIDTHS = { 1: 2592, 2: 2592, 3: 2592, 50: 1296 };
/** 1/8" = 1'-0" across an 18in sheet is 144ft — what the title block implies. */
const P50_PRINTED_FEET = 144;

const printedRow = (over: Partial<ScaleReadingRowForView> = {}): ScaleReadingRowForView =>
  row({
    pageNumber: 50,
    source: "PRINTED",
    declaredDistanceFeet: String(P50_PRINTED_FEET),
    agreedText: null,
    consideredCount: 0,
    inheritedError: null,
    ...over,
  });

describe("a sheet that is a reduced print", () => {
  it("CORRECTS THE SCALE TO WHAT ITS SISTER PAGES MEASURE", () => {
    // The assertion the whole feature is for: p11 and p17 measure 1/16" = 1'-0"
    // off their own dimensions, and this reaches the same answer on a page with
    // no dimensions at all, from the set's sheet sizes.
    const prefill = scalePrefillsFromReadings([printedRow()], SET_WIDTHS)[50]!;
    expect(prefill.scaleName).toBe('1/16" = 1\'-0"');
    expect(prefill.declaredFeet).toBe(P50_PRINTED_FEET * 2);
    expect(prefill.reducedPrintCaution).toMatch(/half-size print/i);
  });

  it("SAYS SO ON THE ROW, naming both widths and the consequence", () => {
    const prefill = scalePrefillsFromReadings([printedRow()], SET_WIDTHS)[50]!;
    expect(prefill.reducedPrintCaution).toContain("18in");
    expect(prefill.reducedPrintCaution).toContain("36in");
    expect(prefill.reducedPrintCaution).toMatch(/half/i);
  });

  it("LEAVES THE LINE ALONE — only the distance it represents changes", () => {
    // The printed row's line IS the sheet's own width. Reducing the paper does
    // not move it; it changes how much building it spans.
    const prefill = scalePrefillsFromReadings([printedRow()], SET_WIDTHS)[50]!;
    expect(prefill.xs).toEqual([0.1, 0.15]);
    expect(prefill.ys).toEqual([0.2, 0.2]);
  });

  it("NEVER TOUCHES A MEASURED SCALE, which is the safety argument", () => {
    // p11 and p17 are the same 18in paper and their dimension votes are right.
    // A dimension is measured off the drawing, so a reduction cannot fool it —
    // reduce the sheet and both the line and its stated length come down
    // together. Correcting one would break a page that works today.
    const measured = scalePrefillsFromReadings(
      [row({ pageNumber: 50, source: "DIMENSIONS" })],
      SET_WIDTHS,
    )[50]!;
    expect(measured.scaleName).toBe('1/8" = 1\'-0"');
    expect(measured.declaredFeet).toBe(16.375);
    expect(measured.reducedPrintCaution).toBeUndefined();
  });

  it("leaves a full-size sheet's printed scale exactly as it was", () => {
    const prefill = scalePrefillsFromReadings(
      [printedRow({ pageNumber: 1, declaredDistanceFeet: "288" })],
      SET_WIDTHS,
    )[1]!;
    expect(prefill.scaleName).toBe('1/8" = 1\'-0"');
    expect(prefill.declaredFeet).toBe(288);
    expect(prefill.reducedPrintCaution).toBeUndefined();
  });

  it("CHANGES NOTHING WHEN NO WIDTHS ARE SUPPLIED, so the old callers are safe", () => {
    const prefill = scalePrefillsFromReadings([printedRow()])[50]!;
    expect(prefill.scaleName).toBe('1/8" = 1\'-0"');
    expect(prefill.declaredFeet).toBe(P50_PRINTED_FEET);
    expect(prefill.reducedPrintCaution).toBeUndefined();
  });

  it("OFFERS NOTHING when the correction lands on no standard scale", () => {
    // 1/32" = 1'-0" is the coarsest architectural scale, so a half-size print
    // of it leaves the list. A wrong scale is worse than none, and the form
    // then behaves exactly as it does with no reading at all.
    const offTheList = scalePrefillsFromReadings(
      [printedRow({ declaredDistanceFeet: String(18 * 32) })],
      SET_WIDTHS,
    );
    expect(offTheList[50]).toBeUndefined();
  });

  it("is unmoved by a set with one oversized sheet in it", () => {
    // The modal width, not the maximum: one big sheet must not make every other
    // page read as a reduction of it.
    const prefill = scalePrefillsFromReadings(
      [printedRow({ pageNumber: 1, declaredDistanceFeet: "288" })],
      { 1: 2592, 2: 2592, 3: 2592, 4: 3456 },
    )[1]!;
    expect(prefill.reducedPrintCaution).toBeUndefined();
  });
});
