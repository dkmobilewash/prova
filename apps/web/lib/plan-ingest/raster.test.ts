import { describe, expect, it } from "vitest";
import { storedRasterFrom } from "./raster";

describe("a stored raster read, in the finder's shape", () => {
  it("passes lines and text through and refuses a row whose JSON is not lists", () => {
    const row = { widthPt: 2592, heightPt: 1728, lines: [{ x1: 0, y1: 0, x2: 10, y2: 0, width: 1 }], text: [{ str: "A101", x: 1, y: 2, width: 3, height: 4 }], printedScale: `1/8" = 1'-0"` };
    expect(storedRasterFrom(row)).toEqual({ widthPt: 2592, heightPt: 1728, segments: row.lines, textItems: row.text, printedScale: row.printedScale });
    expect(storedRasterFrom({ ...row, lines: "junk", text: null })).toMatchObject({ segments: [], textItems: [] });
    expect(storedRasterFrom(null)).toBeNull();
  });
});
