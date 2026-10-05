import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RASTER_WIDTH_PX, countPages, rasterisePage } from "./sheet-raster";

/**
 * THIS TEST RENDERS A REAL PDF, which is the only reason it is worth having.
 *
 * The claim being made is "a plan page can be rasterised on the server", and
 * CLAUDE.md records the opposite — `page.render()` failing with "Cannot read
 * properties of null (reading 'canvas')". That record was correct and its cause
 * was a missing optional dependency, so a test that mocked pdfjs would assert
 * the very thing in doubt. It reads `e2e/fixtures/plan-sheet.pdf` off disk and
 * puts real bytes through the real library.
 */

const FIXTURE = join(__dirname, "..", "e2e", "fixtures", "plan-sheet.pdf");

/**
 * A SECOND FIXTURE, AND THE REASON IS THAT THE FIRST ONE CANNOT FAIL.
 *
 * `plan-sheet.pdf` is 200x200 and paints its own white background. Two tests
 * here were written against it and a mutation run showed BOTH were vacuous:
 * squaring the raster left "aspect preserved" green, because 1 equals 1 on a
 * square page; deleting the white fill left "paints paper white" green,
 * because the PDF had already painted it.
 *
 * `wide-sheet.pdf` is 420x300 — the 42:30 of a D-size sheet, so `y` tops out
 * at 0.714 — and draws line-work on NOTHING, so the paper underneath is the
 * renderer's to supply. It is 505 bytes of hand-written PDF, which is why it
 * can be read in the diff rather than taken on trust.
 */
const WIDE = join(__dirname, "..", "e2e", "fixtures", "wide-sheet.pdf");

function bytes(): Buffer {
  return readFileSync(FIXTURE);
}

function wide(): Buffer {
  return readFileSync(WIDE);
}

/** PNG's own magic number. A function that returned an empty buffer, or a
 * JPEG, would pass a length check and fail this. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("a plan page becomes a picture", () => {
  it("counts the pages without rendering any", async () => {
    await expect(countPages(bytes())).resolves.toBeGreaterThan(0);
  });

  it("renders page 1 to a PNG at the declared width", async () => {
    const page = await rasterisePage(bytes(), 1);
    expect(page.widthPx).toBe(RASTER_WIDTH_PX);
    expect(page.png.subarray(0, 8), "that is not a PNG").toEqual(PNG_MAGIC);
    // A blank canvas still encodes to a valid PNG, so size is the weak signal
    // that something was actually drawn. The fixture is line-work; an empty
    // 2000px canvas compresses to well under a kilobyte.
    expect(page.png.byteLength).toBeGreaterThan(2000);
  });

  it("keeps the page's own aspect, so the page-width box survives the raster", async () => {
    // `y` is stored as a fraction of the WIDTH, so a raster that silently
    // letterboxed or stretched would put every pin in the wrong place while
    // every number still looked plausible.
    const page = await rasterisePage(wide(), 1);
    expect(page.heightPt / page.widthPt, "the fixture is square and proves nothing").toBeLessThan(0.9);
    const fromPoints = page.heightPt / page.widthPt;
    const fromPixels = page.heightPx / page.widthPx;
    expect(fromPixels).toBeCloseTo(fromPoints, 2);
  });

  it("reports the page size in points, which is what the pins are stored against", async () => {
    const page = await rasterisePage(bytes(), 1);
    expect(page.widthPt).toBeGreaterThan(0);
    expect(page.heightPt).toBeGreaterThan(0);
  });

  it("refuses a page number the document does not have, naming both", async () => {
    // Rather than returning a blank image that looks like a sheet nobody drew on.
    await expect(rasterisePage(bytes(), 99)).rejects.toThrow(/page 99 was asked for/i);
    await expect(rasterisePage(bytes(), 0)).rejects.toThrow(/was asked for/i);
  });

  it("comes back on white paper, whoever painted it", async () => {
    // Kept after the fill that used to be in `rasterisePage` was deleted: a
    // mutation showed removing the fill changed nothing, because pdf.js paints
    // the canvas white itself. So this no longer guards OUR code — it guards
    // that ASSUMPTION, and goes red the day a pdf.js upgrade stops doing it
    // and the phone starts showing black-on-black line-work.
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const page = await rasterisePage(wide(), 1);
    const img = await loadImage(page.png);
    const probe = createCanvas(1, 1);
    const ctx = probe.getContext("2d");
    ctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    expect({ r, g, b, a }).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });
});
