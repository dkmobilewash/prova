import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SheetWorker, tidyOcrLine } from "./nodeStack";
import { rasterLines } from "./rasterLines";

describe("tidying a Tesseract line", () => {
  it("puts the foot mark back in a scale caption and leaves everything else alone", () => {
    expect(tidyOcrLine('SCALE: 1/8"= 1-0"')).toBe(`SCALE: 1/8"= 1'-0"`);
    expect(tidyOcrLine(`SCALE: 1/8" = 1'-0"`)).toBe(`SCALE: 1/8" = 1'-0"`);
    expect(tidyOcrLine("ROOM 101-A")).toBe("ROOM 101-A");
  });
});

describe("rendering a page in a sheet's own worker", () => {
  it("gives an 8-bit grey of the page at the asked dpi, with ink the line pass can read, and the worker goes away after", async () => {
    const sheet = SheetWorker.start();
    try {
      const gray = await sheet.render(new Uint8Array(readFileSync("e2e/fixtures/plan-sheet.pdf")), 1, 150);
      // 200 pt at 150 dpi.
      expect([gray.width, gray.height]).toEqual([417, 417]);
      const ink = gray.data.filter((v) => v < 200).length;
      expect(ink).toBeGreaterThan(100);
      expect(ink).toBeLessThan(gray.data.length / 2);
      expect(rasterLines(gray, { dpi: 150 }).length).toBeGreaterThan(0);
      // A vector sheet never takes the scan path.
      expect(gray.direct).toBe(false);
    } finally {
      await sheet.close();
    }
  });
});

/**
 * A PDF written by hand: one page, one 1-bit DeviceGray image, and whatever
 * content stream the test asks for. Offsets are computed so the xref is
 * right and pdf.js does not have to rebuild it.
 */
function onePagePdf(content: string, imageBits: number[], widthPx: number, heightPx: number): Uint8Array {
  const image = Buffer.from(imageBits);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPx} ${heightPx}] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceGray /BitsPerComponent 1 /Length ${image.length} >>\nstream\n${image.toString("latin1")}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

describe("a scanned page is read straight from its bits", () => {
  // 16 x 8 px, one byte per row... two bytes: the left byte all white, the
  // right byte alternating, except the last row, which is all black.
  const rows = [0xff, 0xaa, 0xff, 0xaa, 0xff, 0xaa, 0xff, 0xaa, 0xff, 0xaa, 0xff, 0xaa, 0xff, 0xaa, 0x00, 0x00];
  const over = (w: number, h: number) => `q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q`;

  it("takes the direct path for one image over the whole page, and the grey IS the bits", async () => {
    const sheet = SheetWorker.start();
    try {
      const gray = await sheet.render(onePagePdf(over(16, 8), rows, 16, 8), 1, 72);
      expect(gray.direct).toBe(true);
      expect([gray.width, gray.height]).toEqual([16, 8]);
      // Row 0: eight white, then 1,0,1,0… (bit set is white, as pdf.js paints it).
      expect([...gray.data.slice(0, 16)]).toEqual([255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 255, 0, 255, 0, 255, 0]);
      // Last row all black.
      expect([...gray.data.slice(7 * 16)]).toEqual(new Array(16).fill(0));
    } finally {
      await sheet.close();
    }
  });

  it("box-averages at half size, in the canvas's own 256ths with white pinned to 255", async () => {
    const sheet = SheetWorker.start();
    try {
      const gray = await sheet.render(onePagePdf(over(16, 8), rows, 16, 8), 1, 36);
      expect(gray.direct).toBe(true);
      expect([gray.width, gray.height]).toEqual([8, 4]);
      // Left half: 2 x 2 all white → 255. Right half: each 2 x 2 holds two
      // white and two black → 128, the canvas's value for 2 of 4.
      expect([...gray.data.slice(0, 8)]).toEqual([255, 255, 255, 255, 128, 128, 128, 128]);
      // Bottom row of output pairs a 0xff/0xaa row with the all-black row:
      // left 2 of 4 white → 128, right 1 of 4 → 64.
      expect([...gray.data.slice(3 * 8)]).toEqual([128, 128, 128, 128, 64, 64, 64, 64]);
    } finally {
      await sheet.close();
    }
  });

  it("falls back to the canvas when anything else is drawn on the page", async () => {
    const sheet = SheetWorker.start();
    try {
      // The same image, plus a black stroke down the left edge.
      const gray = await sheet.render(onePagePdf(`${over(16, 8)} 0 G 2 w 1 0 m 1 8 l S`, rows, 16, 8), 1, 72);
      expect(gray.direct).toBe(false);
      expect(gray.data[0 * 16 + 1]).toBeLessThan(128);
      // And the bits still came through where the stroke is not.
      expect(gray.data[0 * 16 + 9]).toBe(0);
      expect(gray.data[0 * 16 + 10]).toBe(255);
    } finally {
      await sheet.close();
    }
  });

  it("falls back when the image does not cover the page", async () => {
    const sheet = SheetWorker.start();
    try {
      const gray = await sheet.render(onePagePdf(over(8, 8), rows, 16, 8), 1, 72);
      expect(gray.direct).toBe(false);
    } finally {
      await sheet.close();
    }
  });
});

describe("the warm pool", () => {
  it("gives a closed thread back to the next sheet, and ends it with the pool off", async () => {
    await SheetWorker.drain();
    const first = SheetWorker.start();
    const bytes = new Uint8Array(readFileSync("e2e/fixtures/plan-sheet.pdf"));
    await first.render(bytes, 1, 72);
    await first.close();
    expect(SheetWorker.idleCount()).toBe(1);
    const second = SheetWorker.start();
    expect(second).toBe(first);
    expect(SheetWorker.idleCount()).toBe(0);
    // A warm thread still renders: its document was destroyed on release, not its modules.
    const gray = await second.render(bytes, 1, 72);
    expect(gray.width).toBeGreaterThan(0);
    process.env.RASTER_WORKER_POOL = "0";
    try {
      await second.close();
      expect(SheetWorker.idleCount()).toBe(0);
    } finally {
      delete process.env.RASTER_WORKER_POOL;
    }
  });
});
