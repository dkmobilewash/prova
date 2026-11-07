import { describe, expect, it } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { crc32, deflateSync } from "node:zlib";
import { openPlanPdf } from "./planPdf";

/** A size×size grey PNG, built by hand (no image library here). */
function grayPng(size: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = Buffer.alloc(size * (1 + size * 3), 128);
  for (let y = 0; y < size; y++) rows[y * (1 + size * 3)] = 0; // filter: none
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

// A sheet with two drawn lines and one embedded 64×64 image: the shape of a plan
// with a logo or a photo on it.
async function sheetWithImage(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawLine({ start: { x: 50, y: 50 }, end: { x: 500, y: 50 }, thickness: 2, color: rgb(0, 0, 0) });
  page.drawLine({ start: { x: 50, y: 50 }, end: { x: 50, y: 500 }, thickness: 2, color: rgb(0, 0, 0) });
  page.drawImage(await doc.embedPng(grayPng(64)), { x: 300, y: 300, width: 64, height: 64 });
  return Buffer.from(await doc.save());
}

describe("openPlanPdf without images", () => {
  it("READS THE SAME STROKES and drops the image, which only the scan check counts (ELEVEN03: 2.65 GB → 1.0 GB)", async () => {
    const bytes = await sheetWithImage();
    const withImages = await openPlanPdf(Buffer.from(bytes));
    const vector = await openPlanPdf(Buffer.from(bytes), { images: false });
    try {
      const a = await withImages.pageStrokes(1);
      const b = await vector.pageStrokes(1);
      expect(b.segments).toEqual(a.segments);
      expect(a.segments.length).toBeGreaterThan(0);
      expect(a.imageOperators).toBe(1);
      expect(b.imageOperators).toBe(0);
    } finally {
      await withImages.close();
      await vector.close();
    }
  });
});
