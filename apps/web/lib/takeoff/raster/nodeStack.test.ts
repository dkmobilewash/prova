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
