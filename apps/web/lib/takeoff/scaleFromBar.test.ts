import { describe, expect, it } from "vitest";
import { scaleFromBar } from "./scaleFromBar";
import { rulerLadder, scaleBarLabels, type ScaleLabel } from "./scaleBar";
import type { PageTextItem } from "./wallTags";

/**
 * READING THE SHEET'S OWN RULER.
 *
 * The cases are built from the bar School-01 actually carries — `0 · 4 · 8 · 16
 * · 32` — because that is the one this repo has seen on a real drawing, found by
 * a click-through rather than by a filter.
 *
 * A note on the arithmetic, since every expectation below depends on it: an
 * ARCH D sheet is 36in wide, so `widthPt` is 2592. One page-width unit is
 * therefore 36 paper inches. At `1/8" = 1'-0"` — 8 feet of building per paper
 * inch — one page-width unit is 288 feet. A bar labelled 0 to 32 ft spans
 * 32/288 = 0.1111 units, which is 4 paper inches: the size a graphic scale
 * actually is.
 */

const ARCH_D = 2592;
/** Feet per page-width unit at 1/8" = 1'-0" on a 36in sheet. */
const AT_EIGHTH = 288;

/** A bar's labels, laid out from a scale and a y. */
function bar(values: number[], feetPerUnit: number, y = 0.8, x0 = 0.1): ScaleLabel[] {
  return values.map((value) => ({ value, x: x0 + value / feetPerUnit, y }));
}

describe("the ladder, which both the detector and the scale read", () => {
  it("returns the feet per unit a bar implies", () => {
    const ladder = rulerLadder(bar([0, 4, 8, 16, 32], AT_EIGHTH).map((l) => ({ at: l.x, value: l.value })));
    expect(ladder).not.toBeNull();
    expect(ladder?.feetPerUnit).toBeCloseTo(AT_EIGHTH, 4);
  });

  it("reads a bar whose zero is at the far end", () => {
    // Which end the zero sits at depends on how the bar was drawn.
    const pairs = bar([0, 4, 8, 16, 32], AT_EIGHTH).map((l) => ({ at: -l.x, value: l.value }));
    expect(rulerLadder(pairs)?.feetPerUnit).toBeCloseTo(AT_EIGHTH, 4);
  });

  it("REFUSES numbers that ascend from zero but are not proportional to their spacing", () => {
    // ── THIS IS WHAT THE FIT ADDS OVER THE OLD BOOLEAN ──
    // Ascending-from-zero is enough to RECOGNISE a bar; it is not enough to
    // MEASURE one. Evenly spaced 0, 4, 8, 16, 32 is not a ruler — on a real bar
    // the 8-to-16 gap is twice the 4-to-8 gap. A reading off this would be
    // wrong by more than 2x at the far end.
    const evenlySpaced = [0, 4, 8, 16, 32].map((value, i) => ({ at: i * 0.01, value }));
    expect(rulerLadder(evenlySpaced)).toBeNull();
  });

  it("refuses a series that never reaches zero", () => {
    // Room numbers along a corridor. The zero is the whole safety argument.
    const rooms = [110, 111, 112, 113].map((value, i) => ({ at: i * 0.05, value }));
    expect(rulerLadder(rooms)).toBeNull();
  });

  it("refuses two numbers, however convincing", () => {
    expect(rulerLadder([{ at: 0, value: 0 }, { at: 0.1, value: 32 }])).toBeNull();
  });
});

describe("the scale a graphic bar implies", () => {
  it("reads 1/8in = 1ft-0in off an ARCH D sheet", () => {
    const read = scaleFromBar(bar([0, 4, 8, 16, 32], AT_EIGHTH), ARCH_D);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.scaleName).toBe('1/8" = 1\'-0"');
    expect(read.feetPerInch).toBeCloseTo(8, 3);
    expect(read.feetPerUnit).toBeCloseTo(AT_EIGHTH, 2);
  });

  it("HANDS BACK THE LABELS IT READ, so the viewer can draw the evidence", () => {
    // The property that makes this witness worth more than the title block: a
    // wrong reading is visible on the drawing in two seconds, which is the same
    // argument `scaleFromDimensions` makes for drawing back over the dimension.
    const read = scaleFromBar(bar([0, 4, 8, 16, 32], AT_EIGHTH), ARCH_D);
    expect(read.ok && read.labels.length).toBe(5);
  });

  it("READS A HALF-SIZE PRINT CORRECTLY, which is the reason it exists", () => {
    // ── THE CASE NO OTHER WITNESS GETS RIGHT ALONE ──
    //
    // The same drawing issued at 18in instead of 36in. Its title block still
    // says 1/8" = 1'-0" — the name was set long before anyone chose the paper —
    // so the printed scale LIES. The bar shrank with the plan, so it does not.
    //
    // `reducedPrint.ts` also gets this right, but only by comparing against the
    // rest of the set's modal width. On a ONE-SHEET upload it has nothing to
    // compare against; this has everything it needs on the sheet.
    const halfSize = 1296;
    // The bar occupies the same fraction of a page half as wide, so a page-width
    // unit now covers half the feet.
    const read = scaleFromBar(bar([0, 4, 8, 16, 32], AT_EIGHTH), halfSize);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.scaleName).toBe('1/16" = 1\'-0"');
    expect(read.feetPerInch).toBeCloseTo(16, 3);
  });

  it("REFUSES a sheet whose bars disagree, rather than picking one", () => {
    // 21 of 218 real pages carry views at more than one scale. A single number
    // for such a sheet is wrong whichever bar wins, so it asks instead.
    const two = [
      ...bar([0, 4, 8, 16, 32], AT_EIGHTH, 0.8),
      ...bar([0, 2, 4, 8, 16], AT_EIGHTH / 2, 0.4),
    ];
    const read = scaleFromBar(two, ARCH_D);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toContain("different scales");
    // And it names the way out rather than only the problem.
    expect(read.reason).toContain("clicking a known distance");
  });

  it("refuses a reading that is not a standard scale", () => {
    // A bar landing between scales means something is wrong with the reading or
    // the page. Rounding it would be inventing a scale.
    const odd = bar([0, 4, 8, 16, 32], AT_EIGHTH * 1.37);
    expect(scaleFromBar(odd, ARCH_D).ok).toBe(false);
  });

  it("says there is no bar rather than throwing, on a sheet with none", () => {
    expect(scaleFromBar([], ARCH_D)).toEqual({
      ok: false,
      reason: "No graphic scale bar was found on this sheet.",
    });
  });

  it("refuses a sheet that reports no width", () => {
    expect(scaleFromBar(bar([0, 4, 8, 16, 32], AT_EIGHTH), 0).ok).toBe(false);
  });

  it("ignores the schedule two inches below the bar", () => {
    // Separate baselines must not merge into one ruler. The quantities column of
    // a schedule is numbers in a row, and a row of them far from the bar is a
    // different row.
    const withSchedule = [
      ...bar([0, 4, 8, 16, 32], AT_EIGHTH, 0.8),
      { value: 0, x: 0.1, y: 0.2 },
      { value: 9, x: 0.2, y: 0.2 },
      { value: 40, x: 0.3, y: 0.2 },
    ];
    const read = scaleFromBar(withSchedule, ARCH_D);
    // The bar still reads, because the schedule row is not proportional and
    // drops out on its own rather than poisoning the bar's row.
    expect(read.ok && read.scaleName).toBe('1/8" = 1\'-0"');
  });

  it("works from the real label extractor, not just hand-built labels", () => {
    // END TO END through `scaleBarLabels`, so a change to `BARE_NUMBER` cannot
    // leave these cases passing on a shape production never produces.
    const items: PageTextItem[] = [0, 4, 8, 16, 32].map((value) => ({
      str: String(value),
      x: (0.1 + value / AT_EIGHTH) * ARCH_D,
      y: 0.8 * ARCH_D,
      width: 0,
      height: 0,
    }));
    const read = scaleFromBar(scaleBarLabels(items, ARCH_D), ARCH_D);
    expect(read.ok && read.scaleName).toBe('1/8" = 1\'-0"');
  });
});
