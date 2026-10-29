import { tmpdir } from "node:os";
import { join } from "node:path";
import { sheetNumberFrom } from "../../plan-ingest/sheetNumber";
import { printedScalesOnPage } from "../printedScales";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { takeoffSheetVerdict } from "../takeoffSheet";
import { SheetWorker, type OcrItem, type PxRegion } from "./nodeStack";
import type { Gray } from "./pgm";
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
 * ── OCR IN TWO STEPS, BECAUSE TESSERACT WAS THE WHOLE COST ──
 *
 * Measured on 50 pages (NOTES-scanned.md §7): lines 0.7 s, Tesseract 7.7 s
 * median and 42 s on a detail sheet dense with small text. So the title
 * block and the bottom band are read FIRST — the sheet number and the scale
 * caption live there — and the sheet's own number is put to
 * `takeoffSheetVerdict`. A schedule, a detail, a cover or an elevation sheet
 * stops there: the lines are kept (cheap, and Find the walls still works if
 * somebody insists) and the rest of the page is never read. A floor plan, or
 * a sheet nobody can name, gets the rest of its tiles read too, so the
 * finder sees the same words it would have seen before.
 *
 * The render and the OCR run in a worker thread that lives for this sheet
 * only (`SheetWorker`); closing it in `finally` is what gives the sheet's
 * memory back. The lines are read on this thread. One sheet at a time,
 * nothing held between pages.
 */

/** The strips the sheet number and the scale caption live in, as fractions of the page. */
export const FIRST_LOOK = { bottom: 0.22, right: 0.22 } as const;

export const RASTER_DPI = 200;

export type RasterizedSheet = {
  dpi: number;
  widthPt: number;
  heightPt: number;
  tiltDegrees: number;
  lines: { x1: number; y1: number; x2: number; y2: number; width: number }[];
  /** OCR's lines in points, each with the confidence OCR gave it — the scan's captions are trusted by it. */
  text: { str: string; x: number; y: number; width: number; height: number; confidence: number }[];
  printedScale: string | null;
  /** What the title block said the sheet is, when OCR read it, and the words it was read from. */
  sheetNumber: string | null;
  titleBlockText: string;
  /** True when the sheet's number said it is not a floor plan and the rest of the page was not read. */
  ocrStoppedEarly: boolean;
  ms: { render: number; lines: number; ocr: number; total: number };
  /** `process.memoryUsage().rss` after each step, bytes — for the budget report. */
  rss: { afterRender: number; afterLines: number; afterOcr: number };
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
  const sheet = SheetWorker.start();
  try {
    let gray: Gray = await sheet.render(bytes, pageNumber, dpi);
    const rssAfterRender = process.memoryUsage().rss;
    const t1 = Date.now();
    let lines = rasterLines(gray, { dpi });
    const tilt = estimateSkewDegrees(lines);
    if (Math.abs(tilt) > 0.15) {
      gray = skew(gray, -tilt);
      lines = rasterLines(gray, { dpi });
    }
    const t2 = Date.now();
    const rssAfterLines = process.memoryUsage().rss;
    const ptPerPx = 72 / dpi;
    const size = pageSizeOf(gray, dpi);
    const toPoints = (list: OcrItem[]) =>
      list.map((i) => ({ str: i.str, x: i.x * ptPerPx, y: i.y * ptPerPx, width: i.width * ptPerPx, height: i.height * ptPerPx, confidence: i.confidence }));
    let items: OcrItem[];
    let sheetNumber: string | null = null;
    let titleBlockText = "";
    let ocrStoppedEarly = false;
    if (options.ocr) {
      items = await options.ocr(gray);
    } else {
      const cachePath = options.cachePath ?? join(tmpdir(), "prova-tessdata");
      const regions: PxRegion[] = [
        { x: 0, y: Math.round(gray.height * (1 - FIRST_LOOK.bottom)), width: gray.width, height: Math.round(gray.height * FIRST_LOOK.bottom) },
        { x: Math.round(gray.width * (1 - FIRST_LOOK.right)), y: 0, width: Math.round(gray.width * FIRST_LOOK.right), height: gray.height },
      ];
      // MEASURED AND LEFT: a second pass over the strips at half size, for
      // the big title-block numerals, read nothing new on Baker and cost
      // 5–7 s a sheet. Tesseract misses those numerals at any size; the
      // early stop goes by the title words it does read ("COVER SHEET").
      const first = await sheet.ocr(gray, { cachePath, dpi, regions });
      gray = first.gray;
      const reading = sheetNumberFrom({ pageNumber, widthPt: size.widthPt, heightPt: size.heightPt, rotation: 0, items: toPoints(first.items) });
      sheetNumber = reading.sheetNumber;
      titleBlockText = reading.regionText;
      const verdict = takeoffSheetVerdict({ sheetNumber: reading.sheetNumber, title: reading.regionText });
      if (verdict.skipAutomatically) {
        items = first.items;
        ocrStoppedEarly = true;
      } else {
        const rest = await sheet.ocr(gray, { cachePath, dpi, skipTiles: new Set(first.tileKeys) });
        gray = rest.gray;
        items = [...first.items, ...rest.items];
      }
    }
    const t3 = Date.now();
    const text = toPoints(items);
    const printed = scaleFromPrinted(printedScalesOnPage(text), size.widthPt, size.heightPt);
    return {
      dpi,
      widthPt: size.widthPt,
      heightPt: size.heightPt,
      tiltDegrees: Math.abs(tilt) > 0.15 ? tilt : 0,
      lines: lines.map((l) => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, width: l.width })),
      text,
      printedScale: printed?.scaleName ?? null,
      sheetNumber,
      titleBlockText,
      ocrStoppedEarly,
      ms: { render: t1 - t0, lines: t2 - t1, ocr: t3 - t2, total: Date.now() - t0 },
      rss: { afterRender: rssAfterRender, afterLines: rssAfterLines, afterOcr: process.memoryUsage().rss },
    };
  } finally {
    await sheet.close();
  }
}
