import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { rasterizeSheet } from "./rasterizeSheet";

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
