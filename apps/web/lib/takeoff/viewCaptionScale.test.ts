import { describe, expect, it } from "vitest";
import { sheetViews, viewsWithOwnScale } from "./sheetViews";

/**
 * ── A CAPTION BLOCK IS A NAME WITH ITS SCALE INDENTED UNDER IT ──
 *
 * Measured on two real Camp Bow Wow sheets after the view finder reported SIX
 * views on A140 and gave not one of them a scale, while a scale was plainly
 * printed on the page. Every real view on both sheets put its caption at the
 * same offset from its name:
 *
 *     dx = +0.0202   dy = +0.0060      (page-width units)
 *
 * That is a drafter's block, not noise:
 *
 *     1   PLAN DETAIL AT PEMB FRAME
 *         SCALE: 1" = 1'-0"
 *
 * The scale line is indented past the bubble number — 52.4pt on a 2592pt
 * sheet. `NAME_BESIDE` allowed 52.0, so all six views of A140 and A120's
 * `RESTROOM - ENLARGED PLAN` were dropped, by two ten-thousandths.
 *
 * The fixture below is that layout at those exact offsets. It fails at the old
 * constant and passes at the new one, which is the whole point of writing it
 * down rather than widening a number and moving on.
 */

const WIDTH = 2592;

/** A caption block at the offsets measured on a real sheet. */
function captionBlock(name: string, scale: string, atX: number, atY: number) {
  return [
    { str: name, x: atX * WIDTH, y: atY * WIDTH },
    // The indent and the line below, exactly as measured.
    { str: `SCALE: ${scale}`, x: (atX + 0.0202) * WIDTH, y: (atY + 0.006) * WIDTH },
  ];
}

describe("a view's scale sits indented UNDER its name, not beneath it", () => {
  it("reads the scale at the offset real sheets actually use", () => {
    const views = sheetViews(captionBlock("PLAN DETAIL", '1" = 1\'-0"', 0.14, 0.29), WIDTH);
    expect(views, "the view name itself was not found").toHaveLength(1);
    expect(views[0].scaleName, "the caption was there and was not read").toBe('1" = 1\'-0"');
    expect(views[0].feetPerInch).toBe(1);
  });

  it("reads ALL SIX of A140's detail views, which is what reported the defect", () => {
    // The real x positions off that sheet. Six captions, six scales, and the
    // old window caught none of them.
    const items = [
      ...captionBlock("PLAN DETAIL", '1" = 1\'-0"', 0.1407, 0.2973),
      ...captionBlock("PLAN DETAIL", '1" = 1\'-0"', 0.3347, 0.2973),
      ...captionBlock("PLAN DETAIL", '1" = 1\'-0"', 0.6784, 0.2973),
      ...captionBlock("PLAN DETAIL", '1" = 1\'-0"', 0.1407, 0.5087),
      ...captionBlock("COLUMN PLAN DETAIL", '1" = 1\'-0"', 0.3347, 0.5087),
      ...captionBlock("PLAN DETAIL AT PEMB FRAME", '1" = 1\'-0"', 0.5446, 0.5087),
    ];
    const views = sheetViews(items, WIDTH);
    expect(views).toHaveLength(6);
    expect(views.filter((v) => v.feetPerInch !== null)).toHaveLength(6);
  });

  it("STILL REFUSES a scale that belongs to the view beside it", () => {
    // The failure the constant exists to prevent, and the reason it was not
    // simply made large. A140's views sit about 0.19 apart; a window of 0.04
    // is a fifth of that. Here the neighbour's caption is 0.19 away and must
    // not be stolen.
    const items = [
      { str: "PLAN DETAIL", x: 0.1407 * WIDTH, y: 0.2973 * WIDTH },
      // No caption of its own — the only scale on the sheet belongs to the
      // view one column over.
      { str: 'SCALE: 1" = 1\'-0"', x: (0.1407 + 0.19) * WIDTH, y: (0.2973 + 0.006) * WIDTH },
    ];
    // NO VIEW AT ALL, which is a stronger answer than one with a null scale
    // and is this module's own rule: a view is a name WITH a caption, and "a
    // name with nothing under it" does not exist. Either way the neighbour's
    // scale was not taken — and the first test above shows the same name DOES
    // become a scaled view when its own caption is there, so this is a
    // refusal rather than the finder simply not working.
    expect(sheetViews(items, WIDTH)).toHaveLength(0);
  });
});

describe("a captioned view can be measured with no sheet scale at all", () => {
  it("turns a caption into feet per page unit, absolutely", () => {
    // A caption is feet per PAPER INCH, so it needs no anchor: a sheet whose
    // printed dimensions disagree — which is what a multi-drawing sheet looks
    // like to `readSheetScale` — can still be measured drawing by drawing.
    const views = sheetViews(captionBlock("FLOOR PLAN", '1/8" = 1\'-0"', 0.14, 0.29), WIDTH);
    const scaled = viewsWithOwnScale(views, WIDTH);
    expect(scaled).toHaveLength(1);
    // 1/8" = 1'-0" is 8 feet per paper inch; the sheet is 2592/72 = 36 inches.
    expect(scaled[0].feetPerUnit).toBeCloseTo(36 * 8, 6);
  });

  it("DROPS a view whose caption refuses to name a scale", () => {
    // NTS and AS NOTED own their region — that is why `sheetViews` returns
    // them — but a drawing whose own caption declines to say is not one to
    // guess at. This is the `HEAD OF WALL DETAIL` case from `sheetViews`.
    const views = sheetViews(captionBlock("WALL DETAIL", "NTS", 0.14, 0.29), WIDTH);
    expect(views).toHaveLength(1);
    expect(viewsWithOwnScale(views, WIDTH)).toHaveLength(0);
  });

  it("returns nothing for a page with no width, rather than dividing by it", () => {
    const views = sheetViews(captionBlock("FLOOR PLAN", '1/8" = 1\'-0"', 0.14, 0.29), WIDTH);
    expect(viewsWithOwnScale(views, 0)).toHaveLength(0);
  });
});
