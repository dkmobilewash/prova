import { describe, expect, it } from "vitest";
import { dimensionLabels } from "./dimensionLabels";
import { TITLE_BLOCK_RIGHT_FRACTION, TITLE_BLOCK_BOTTOM_FRACTION, type PlanPageText } from "./planPdf";

/**
 * Finding the dimensions an architect printed on a drawing.
 *
 * EVERY STRING HERE IS ONE A REAL ARCH E1 EXPORT ACTUALLY CARRIED, including the
 * two notes that must not be read as dimensions. The point of the fixture is
 * that it is not invented: a pattern tuned against made-up strings is tuned
 * against the author's idea of a drawing.
 */

const W = 3024;
const H = 2160;

function page(items: { str: string; x?: number; y?: number }[]): PlanPageText {
  return {
    pageNumber: 1,
    widthPt: W,
    heightPt: H,
    rotation: 0,
    items: items.map((i) => ({ str: i.str, x: i.x ?? 400, y: i.y ?? 400, width: 40, height: 10 })),
  };
}

describe("the dimensions it finds", () => {
  it("reads whole feet, feet and inches, and FRACTIONS of an inch", () => {
    // A first pass found 13 of 32 on the real sheet because it rejected every
    // fractional one — and those are the LONGEST dimensions, so the most useful.
    const found = dimensionLabels(
      page([
        { str: `11' - 0"` },
        { str: `8' - 10"` },
        { str: `8' - 7 3/4"` },
        { str: `15' - 3 7/16"` },
        { str: `16' - 9 3/8"` },
        { str: `4' - 0 1/4"` },
      ]),
    );
    expect(found.map((f) => f.text)).toEqual([
      `11' - 0"`,
      `8' - 10"`,
      `8' - 7 3/4"`,
      `15' - 3 7/16"`,
      `16' - 9 3/8"`,
      `4' - 0 1/4"`,
    ]);
    expect(found[0].feet).toBe(11);
    expect(found[2].feet).toBeCloseTo(8.6458, 3);
    expect(found[3].feet).toBeCloseTo(15.2865, 3);
  });

  it("positions a label at its own CENTRE, since pairing measures from there", () => {
    const found = dimensionLabels(page([{ str: `11' - 0"`, x: 200, y: 300 }]));
    expect(found[0].x).toBe(220); // 200 + width/2
    expect(found[0].y).toBe(300);
  });
});

describe("what is NOT a dimension, which a drawing has plenty of", () => {
  it("REJECTS NOTES THAT HAPPEN TO CARRY A FIGURE, from the real sheet", () => {
    // Both of these are on the real export. An unanchored pattern reads a
    // figure out of each, and a note's number is not beside a dimension line —
    // so its length means nothing and it would feed the vote noise.
    const found = dimensionLabels(
      page([
        { str: `18" CLEAR` },
        { str: `18" DEEP ADJUSTABLE SHELVING ON STANDARDS.` },
        { str: `3. PROVIDE BLOCKING, ROUGH HDWE, ETC, AS REQ'D TO MOUNT` },
        { str: `EQUIPMENT. PROVIDE ADDITIONAL SFRM BENEATH RECESS AS REQ'D.` },
      ]),
    );
    expect(found).toEqual([]);
  });

  it("REJECTS A STRING THAT MERELY STARTS WITH A DIMENSION, which an unanchored pattern takes", () => {
    // These are the dangerous ones, because an unanchored pattern finds a
    // plausible figure in each and the vote then weighs text that is not beside
    // a dimension line at all.
    //
    // `3'-0" x 7'-0"` is a DOOR SIZE out of a schedule table —
    // `scheduleTable.ts` quotes that exact string in its own header as one real
    // drawings carry. `8' - 0" A.F.F.` is a height annotation, not a measured
    // run. Neither has a dimension line under it.
    const found = dimensionLabels(
      page([
        { str: `3'-0" x 7'-0"` },
        { str: `8' - 0" A.F.F.` },
        { str: `9' - 0" CEILING HEIGHT TYP.` },
        { str: `SEE 4' - 0" DETAIL` },
      ]),
    );
    expect(found).toEqual([]);
  });

  it("rejects a bare inches figure, which on a drawing is a note or a clearance", () => {
    expect(dimensionLabels(page([{ str: `18"` }, { str: `6"` }]))).toEqual([]);
  });

  it("rejects a room name, a sheet number and a plain number", () => {
    expect(
      dimensionLabels(page([{ str: "CORRIDOR" }, { str: "A-102" }, { str: "101" }, { str: "1/8" }])),
    ).toEqual([]);
  });

  it("rejects a figure longer than any room on a sheet", () => {
    expect(dimensionLabels(page([{ str: `900' - 0"` }]))).toEqual([]);
  });

  it("rejects a figure under half a foot, too short to carry a scale", () => {
    expect(dimensionLabels(page([{ str: `0' - 2"` }]))).toEqual([]);
  });
});

describe("the title block is excluded, and not as housekeeping", () => {
  it("IGNORES A FIGURE IN THE TITLE BLOCK's own corner", () => {
    // That corner carries the scale NAME, revision dates and sheet numbers, and
    // a figure there sits beside a ruled box rather than a dimension line.
    const inTitle = { str: `11' - 0"`, x: W * TITLE_BLOCK_RIGHT_FRACTION + 10, y: H * TITLE_BLOCK_BOTTOM_FRACTION + 10 };
    expect(dimensionLabels(page([inTitle]))).toEqual([]);
  });

  it("keeps a figure in the drawing area at the same height", () => {
    // Only the CORNER is excluded — a dimension low on the sheet but left of the
    // title block is a real dimension, and excluding a whole band would lose it.
    const low = { str: `11' - 0"`, x: 200, y: H * TITLE_BLOCK_BOTTOM_FRACTION + 10 };
    expect(dimensionLabels(page([low])).map((f) => f.text)).toEqual([`11' - 0"`]);
  });

  it("keeps a figure to the right but high up", () => {
    const right = { str: `11' - 0"`, x: W * TITLE_BLOCK_RIGHT_FRACTION + 10, y: 200 };
    expect(dimensionLabels(page([right])).map((f) => f.text)).toEqual([`11' - 0"`]);
  });
});

describe("an empty page", () => {
  it("finds nothing rather than throwing", () => {
    expect(dimensionLabels(page([]))).toEqual([]);
  });
});
