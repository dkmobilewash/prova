import { readTextBoxes } from "@prova/integrations";
import { describe, expect, it } from "vitest";
import { fromBaseline } from "./findWallsOnSheet";
import { TILE_PT, tileBoxToSheetItem } from "./rasterText";

/**
 * ── THE ARITHMETIC BETWEEN A MODEL'S BOX AND A PAGE COORDINATE ──
 *
 * `sheetText.eval.ts` measures whether the model can read a drawing, which
 * needs a key and real calls. This is the half that must be right whatever the
 * model says: an error here moves EVERY word on the sheet by the same amount,
 * and the symptom is not a wrong coordinate anywhere — it is a scale that
 * quietly will not read, because no label lands within 30 points of its line.
 */

describe("placing a tile's text on the page", () => {
  it("offsets by the tile, which is the whole reason tiling is safe", () => {
    // The model is accurate WITHIN a window; the window's own offset is exact.
    // A box dead centre of the third tile across and second down.
    const item = tileBoxToSheetItem({ text: "24'-6 1/2\"", x: 0.5, y: 0.5, width: 0.1, height: 0.02 }, 2, 1);
    expect(item.x).toBeCloseTo(2 * TILE_PT + 0.5 * TILE_PT, 4);
    expect(item.width).toBeCloseTo(0.1 * TILE_PT, 4);
    expect(item.str).toBe("24'-6 1/2\"");
  });

  it("REPORTS THE BASELINE, not the box top", () => {
    // `SheetTextItem.y` is the baseline, the way pdfjs reports a vector page's
    // text, and `findWallsOnSheet` shifts from baseline itself. The model
    // gives a box TOP, so the baseline is the box's BOTTOM. Hand back the top
    // and every word rises by its own height — small, uniform, and invisible
    // until a dimension stops pairing with its line.
    const box = { text: "30'-0\"", x: 0.1, y: 0.25, width: 0.08, height: 0.02 };
    const item = tileBoxToSheetItem(box, 0, 0);
    expect(item.y).toBeCloseTo((0.25 + 0.02) * TILE_PT, 4);

    // And it survives the shift the consumer applies: back to the box top.
    expect(fromBaseline(item).y).toBeCloseTo(0.25 * TILE_PT, 4);
  });

  it("keeps a whole page's worth of tiles in one coordinate system", () => {
    // Same point, reached from two different tiles. The seam between tiles is
    // where an off-by-one tile would show, and it would look like a drawing
    // whose right half is shifted.
    const rightEdgeOfFirst = tileBoxToSheetItem({ text: "A", x: 1, y: 0, width: 0.01, height: 0.01 }, 0, 0);
    const leftEdgeOfSecond = tileBoxToSheetItem({ text: "A", x: 0, y: 0, width: 0.01, height: 0.01 }, 1, 0);
    expect(rightEdgeOfFirst.x).toBeCloseTo(leftEdgeOfSecond.x, 4);

    // ── AND THE SAME DOWN THE PAGE, which nothing here checked ──
    //
    // A mutation dropping the tile's Y offset left every test green: the
    // cases above vary the tile across and the baseline case sits in the top
    // row, so no assertion ever placed a word in a lower band. Every word on
    // a sheet would have collapsed into the top 600 points.
    const bottomOfFirstRow = tileBoxToSheetItem({ text: "A", x: 0, y: 1, width: 0.01, height: 0 }, 0, 0);
    const topOfSecondRow = tileBoxToSheetItem({ text: "A", x: 0, y: 0, width: 0.01, height: 0 }, 0, 1);
    expect(bottomOfFirstRow.y).toBeCloseTo(topOfSecondRow.y, 4);
    expect(topOfSecondRow.y).toBeCloseTo(TILE_PT, 4);

    const thirdRow = tileBoxToSheetItem({ text: "A", x: 0, y: 0.5, width: 0.01, height: 0.02 }, 0, 2);
    expect(thirdRow.y, "a word in the third tile row landed outside it").toBeGreaterThan(2 * TILE_PT);
  });
});

describe("what comes back from the model is checked, never trusted", () => {
  it("takes a well-formed reply", () => {
    const got = readTextBoxes({ items: [{ text: "KITCHEN", x: 0.1, y: 0.2, width: 0.1, height: 0.02 }] });
    expect(got).toHaveLength(1);
    expect(got[0].text).toBe("KITCHEN");
  });

  it("DROPS a box rather than clamping it, which is the safer failure", () => {
    // A fabricated coordinate pushed back inside the crop would sit at an edge
    // and pair with whatever line happens to be there. A missing label costs a
    // vote; a confidently misplaced one costs a wrong scale on every quantity.
    const got = readTextBoxes({
      items: [
        { text: "off the page", x: 1.4, y: 0.2, width: 0.1, height: 0.02 },
        { text: "negative", x: -0.5, y: 0.2, width: 0.1, height: 0.02 },
        { text: "inside out", x: 0.1, y: 0.2, width: -0.1, height: 0.02 },
        { text: "", x: 0.1, y: 0.2, width: 0.1, height: 0.02 },
        { text: "no numbers", x: "0.1", y: 0.2, width: 0.1, height: 0.02 },
        { text: "fine", x: 0.1, y: 0.2, width: 0.1, height: 0.02 },
      ],
    });
    expect(got.map((b) => b.text)).toEqual(["fine"]);
  });

  it("survives a reply that is not the shape asked for at all", () => {
    for (const junk of [null, undefined, 42, "text", {}, { items: null }, { items: "no" }, { items: [null, 7] }]) {
      expect(() => readTextBoxes(junk), `threw on ${JSON.stringify(junk)}`).not.toThrow();
      expect(readTextBoxes(junk)).toEqual([]);
    }
  });

  it("allows the small overshoot a box on the crop's edge really has", () => {
    // Lettering clipped by the tile boundary genuinely sits a hair outside it.
    // Refusing those would lose a word at every seam on the sheet.
    expect(readTextBoxes({ items: [{ text: "edge", x: 0.98, y: 0.1, width: 0.04, height: 0.02 }] })).toHaveLength(1);
  });
});
