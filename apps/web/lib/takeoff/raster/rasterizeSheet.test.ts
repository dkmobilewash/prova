import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { designationFromCell, rasterizeSheet, stopReadingEarly } from "./rasterizeSheet";

/** An ARCH D sheet (36×24 in) with two parallel lines on it: the scale reader
 *  refuses a page too small to be a drawing, so the fixture is a real size. */
async function sheet(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([2592, 1728]);
  page.drawLine({ start: { x: 300, y: 900 }, end: { x: 1500, y: 900 }, thickness: 2 });
  page.drawLine({ start: { x: 300, y: 940 }, end: { x: 1500, y: 940 }, thickness: 2 });
  return doc.save();
}

describe("one scanned sheet, read as lines and text", () => {
  it("renders, reads lines in points, and reads the printed scale out of whatever OCR says — Tesseract stood in for", async () => {
    const read = await rasterizeSheet(await sheet(), 1, {
      dpi: 72,
      ocr: async (gray) => [{ str: `SCALE: 1/4" = 1'-0"`, x: 10, y: gray.height - 10, width: 120, height: 10, confidence: 90 }],
    });
    expect(read.dpi).toBe(72);
    expect([Math.round(read.widthPt), Math.round(read.heightPt)]).toEqual([2592, 1728]);
    // The two drawn lines, in points, y down from the top.
    const long = read.lines.filter((l) => Math.abs(l.x2 - l.x1) > 1000);
    expect(long.length).toBe(2);
    expect(long.map((l) => Math.round(l.y1)).sort((a, b) => a - b)).toEqual([1728 - 940, 1728 - 900]);
    expect(read.text[0].str).toBe(`SCALE: 1/4" = 1'-0"`);
    expect(read.printedScale).toBe(`1/4" = 1'-0"`);
    expect(read.tiltDegrees).toBe(0);
    expect(read.ms.total).toBeGreaterThan(0);
  });
  it("with nothing readable, the scale is null — the app's own set-the-scale prompt is the fallback", async () => {
    const read = await rasterizeSheet(await sheet(), 1, { dpi: 72, ocr: async () => [] });
    expect(read.printedScale).toBeNull();
    expect(read.text).toEqual([]);
  });
});

describe("the designation in a corner read", () => {
  // What sparse-mode Tesseract handed back for Evergreen p22's corner at 2x.
  const p22 = [
    { str: "EAST", confidence: 95, height: 26 },
    { str: "A241B", confidence: 85, height: 101 },
    { str: "PERMIT SET 10/09/2020", confidence: 96, height: 26 },
    { str: "qv", confidence: 18, height: 103 },
  ];
  it("is the tallest confident line that reads as one, spaces removed and upper-cased", () => {
    expect(designationFromCell(p22)).toBe("A241B");
    expect(designationFromCell([{ str: "s 11.2", confidence: 68, height: 105 }])).toBe("S11.2");
  });
  it("skips a tall line that is noise or below the confidence floor", () => {
    expect(designationFromCell([{ str: "A5", confidence: 12, height: 200 }, { str: "A501", confidence: 80, height: 100 }])).toBe("A501");
    expect(designationFromCell([{ str: "PERMIT SET", confidence: 96, height: 26 }])).toBeNull();
    expect(designationFromCell([])).toBeNull();
  });
});

describe("stopping the OCR early on a sheet", () => {
  it("takes two reads that both say skip; one misread number never throws a floor plan away", () => {
    expect(stopReadingEarly("A00", "A100", "FLOOR PLAN")).toBe(false);
    expect(stopReadingEarly(null, null, "FLOOR PLAN")).toBe(false);
    expect(stopReadingEarly(null, "A601", "DOOR SCHEDULE")).toBe(false);
    expect(stopReadingEarly("A601", "A601", "DOOR SCHEDULE")).toBe(true);
  });
});
