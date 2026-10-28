import { tmpdir } from "node:os";
import { join } from "node:path";
import { printedScalesOnPage } from "../printedScales";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { grayToCanvas, ocrTiles, openPdf, renderGray, type OcrItem } from "./nodeStack";
import { skew } from "./rasterDegrade";
import { estimateSkewDegrees, pageSizeOf, rasterLines } from "./rasterLines";

/**
 * ── ONE SCANNED SHEET, READ AS LINES AND TEXT ──
 *
 * What the RASTER stage does per page, and nothing else: render at `dpi`,
 * read the lines (ink and contour fills), read the tilt off the long lines
 * and turn the page back if it is tilted, read the text with Tesseract on
 * tiles, and read the printed scale out of that text with the same reader a
 * vector sheet gets. Everything comes back in POINTS of the displayed page,
 * which is what `detectForSheet` and the viewer already speak.
 *
 * 200 dpi, because the bench measured 200 as the sweet spot — 150 loses
 * four points, 300 gains nothing and doubles the time (`NOTES-scanned.md`).
 *
 * The canvas is dropped before the lines are read and the document is
 * destroyed in `finally`: one sheet at a time, nothing held between pages.
 */

export const RASTER_DPI = 200;

export type RasterizedSheet = {
  dpi: number;
  widthPt: number;
  heightPt: number;
  tiltDegrees: number;
  lines: { x1: number; y1: number; x2: number; y2: number; width: number }[];
  text: { str: string; x: number; y: number; width: number; height: number }[];
  printedScale: string | null;
  ms: { render: number; lines: number; ocr: number; total: number };
  /** `process.memoryUsage().rss` at the end, bytes — for the budget report. */
  rssBytes: number;
};

export type RasterizeOptions = {
  dpi?: number;
  /** Where tesseract.js keeps its language file. The OS temp dir by default. */
  cachePath?: string;
  /** Stand-in for Tesseract in tests: words in pixels of the raster. */
  ocr?: (gray: { width: number; height: number; data: Uint8Array }) => Promise<OcrItem[]>;
};

export async function rasterizeSheet(bytes: Uint8Array, pageNumber: number, options: RasterizeOptions = {}): Promise<RasterizedSheet> {
  const dpi = options.dpi ?? RASTER_DPI;
  const t0 = Date.now();
  const doc = await openPdf(bytes);
  try {
    let { gray } = await renderGray(doc, pageNumber, dpi);
    const t1 = Date.now();
    let lines = rasterLines(gray, { dpi });
    const tilt = estimateSkewDegrees(lines);
    if (Math.abs(tilt) > 0.15) {
      gray = skew(gray, -tilt);
      lines = rasterLines(gray, { dpi });
    }
    const t2 = Date.now();
    let items: OcrItem[];
    if (options.ocr) {
      items = await options.ocr(gray);
    } else {
      const { canvas, context } = grayToCanvas(doc, gray);
      items = (await ocrTiles(doc, canvas, context, { cachePath: options.cachePath ?? join(tmpdir(), "prova-tessdata"), dpi })).items;
    }
    const t3 = Date.now();
    const ptPerPx = 72 / dpi;
    const text = items.map((i) => ({ str: i.str, x: i.x * ptPerPx, y: i.y * ptPerPx, width: i.width * ptPerPx, height: i.height * ptPerPx }));
    const size = pageSizeOf(gray, dpi);
    const printed = scaleFromPrinted(printedScalesOnPage(text), size.widthPt, size.heightPt);
    return {
      dpi,
      widthPt: size.widthPt,
      heightPt: size.heightPt,
      tiltDegrees: Math.abs(tilt) > 0.15 ? tilt : 0,
      lines: lines.map((l) => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, width: l.width })),
      text,
      printedScale: printed?.scaleName ?? null,
      ms: { render: t1 - t0, lines: t2 - t1, ocr: t3 - t2, total: Date.now() - t0 },
      rssBytes: process.memoryUsage().rss,
    };
  } finally {
    await doc.destroy();
  }
}
