/**
 * A BLOCK OF NOTES CANNOT BE MOST OF THE SHEET.
 *
 * `textBlockBoxes` returns boxes that are SUBTRACTED from the sheet before the
 * drawing is measured. A box that is too big therefore does not add noise — it
 * removes the building.
 *
 * THE SCAR. Central Bank A100 proposed 1,816 ft measured whole and ZERO through
 * the view path. Its caption "GENERAL NOTES (FLOOR PLANS):" was read as a text
 * block whose box ran 0.113→1.0 across and 0→0.714 down: 63% of the page.
 * Everything inside it was dropped, leaving 26 of 19,187 strokes, and 26
 * strokes make no walls. A heading that mentions floor plans removed the floor
 * plan, and the only symptom was a sheet that proposed nothing.
 *
 * The real thing still has to be excluded, which is the whole tension: Baker
 * A101's notes column is 31% across and 21% of the page, and subtracting it is
 * what stopped that column measuring as 242 ft of wall.
 *
 * The two cases are far apart — 21% against 63% — and both are pinned below, so
 * the threshold cannot be moved to admit either one without this file saying
 * so. These are SYNTHETIC boxes carrying the real measurements: the sheet that
 * produced the 63% figure is held out, and its numbers are evidence, not a
 * fixture to tune against.
 */
import { describe, expect, it } from "vitest";
import { textBlockBoxes } from "./sheetViews";

/** The shape `textBlockBoxes` reads: a view flagged as a text block, with boxes. */
function block(box: { from: number; to: number; fromY: number; toY: number }) {
  return { textBlock: true, boxes: [box] } as unknown as Parameters<typeof textBlockBoxes>[0][number];
}

/** Baker A101's notes column, as measured: 31% across, 67% down, 21% of the page. */
const NOTES_COLUMN = { from: 0.6856481481481481, to: 1, fromY: 0, toY: 0.6666666666666666 };

/** Central Bank A100's caption box, as measured: 89% across, 71% down, 63% of the page. */
const ATE_THE_SHEET = { from: 0.11315476190476191, to: 1, fromY: 0, toY: 0.7142857142857143 };

const area = (b: { from: number; to: number; fromY: number; toY: number }) => (b.to - b.from) * (b.toY - b.fromY);

describe("a text block cannot be most of the sheet", () => {
  it("keeps a real notes column, which is the reason this feature exists", () => {
    expect(area(NOTES_COLUMN)).toBeCloseTo(0.21, 2);
    expect(textBlockBoxes([block(NOTES_COLUMN)]), "the notes column stopped being excluded").toHaveLength(1);
  });

  it("refuses a box that covers most of the page, which removes the building", () => {
    expect(area(ATE_THE_SHEET)).toBeCloseTo(0.63, 2);
    expect(
      textBlockBoxes([block(ATE_THE_SHEET)]),
      "a box over most of the sheet is still being subtracted — the Central Bank A100 zero",
    ).toHaveLength(0);
  });

  it("tells the two apart with room on both sides, so neither is a near miss", () => {
    // 21% and 63%. If a future change narrows this gap the threshold is being
    // asked to do work it cannot do, and that is worth failing over rather
    // than discovering as a sheet that proposes nothing.
    expect(area(ATE_THE_SHEET) - area(NOTES_COLUMN)).toBeGreaterThan(0.3);
  });

  it("keeps every box when none is oversized, so the filter is not a blanket", () => {
    const small = { from: 0.8, to: 1, fromY: 0, toY: 0.5 };
    expect(textBlockBoxes([block(NOTES_COLUMN), block(small)])).toHaveLength(2);
  });

  it("drops only the oversized one when both are present", () => {
    const boxes = textBlockBoxes([block(ATE_THE_SHEET), block(NOTES_COLUMN)]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].from).toBeCloseTo(NOTES_COLUMN.from, 6);
  });
});
