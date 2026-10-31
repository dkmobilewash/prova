import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHEET_DESIGNATION, sheetNumberFrom } from "../../plan-ingest/sheetNumber";
import { printedScalesOnPage } from "../printedScales";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { takeoffSheetVerdict } from "../takeoffSheet";
import { SheetWorker, type CellLine, type OcrItem, type PxRegion } from "./nodeStack";
import type { Gray } from "./pgm";
import { degrade, skew, type Degrade } from "./rasterDegrade";
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
/** The bottom-right corner the sheet number sits in, as fractions of the page; wider than the number's own cell so a title block laid out differently still lands in it. */
export const NUMBER_CELL = { width: 0.14, height: 0.12 } as const;
/** A sparse-mode line below this confidence is noise off the title block's rules, not a number. */
const CELL_MIN_CONFIDENCE = 30;

/** The designation in a cell's lines, tallest first, spaces removed — or null. */
export function designationFromCell(lines: readonly CellLine[]): string | null {
  for (const line of [...lines].sort((a, b) => b.height - a.height)) {
    if (line.confidence < CELL_MIN_CONFIDENCE) continue;
    const read = line.str.replace(/\s+/g, "").toUpperCase();
    if (read.length >= 2 && SHEET_DESIGNATION.test(read)) return read;
  }
  return null;
}

export type RasterizedSheet = {
  dpi: number;
  widthPt: number;
  heightPt: number;
  tiltDegrees: number;
  lines: { x1: number; y1: number; x2: number; y2: number; width: number }[];
  /** OCR's lines in points, each with the confidence OCR gave it — the scan's captions are trusted by it. */
  text: { str: string; x: number; y: number; width: number; height: number; confidence: number }[];
  printedScale: string | null;
  /** What the title block said the sheet is, when OCR read it: the cell read first, the strips' read otherwise. */
  sheetNumber: string | null;
  /** The designation the tiled title-block pass found on its own — the read the stage made before the cell re-read existed. */
  sheetNumberFromStrips: string | null;
  /** The designation read out of the bottom-right corner on its own, sparse mode at double size. Null with a stand-in OCR. */
  sheetNumberCell: string | null;
  titleBlockText: string;
  /** True when the sheet's number said it is not a floor plan and the rest of the page was not read. */
  ocrStoppedEarly: boolean;
  ms: { render: number; lines: number; ocr: number; total: number };
  /** `process.memoryUsage().rss` after each step, bytes — for the budget report. */
  rss: { afterRender: number; afterLines: number; afterOcr: number };
};

/** Whether two independent reads of the sheet's number both say it is not worth reading in full. */
export function stopReadingEarly(cell: string | null, strips: string | null, title: string | null | undefined): boolean {
  if (cell === null || strips === null) return false;
  return takeoffSheetVerdict({ sheetNumber: cell, title }).skipAutomatically && takeoffSheetVerdict({ sheetNumber: strips, title }).skipAutomatically;
}

export type RasterizeOptions = {
  dpi?: number;
  /** Where tesseract.js keeps its language file. The OS temp dir by default. */
  cachePath?: string;
  /** Stand-in for Tesseract in tests: words in pixels of the raster. */
  ocr?: (gray: { width: number; height: number; data: Uint8Array }) => Promise<OcrItem[]>;
  /**
   * Make the clean render look like a scan before anything reads it — skew,
   * speckle, blur (`rasterDegrade.ts`). For the evals only: a labelled VECTOR
   * training sheet put through the stage's own step as a scan, so the
   * scanned finder is scored against keys that exist. The product never sets
   * it; a real scan is already degraded.
   */
  degrade?: Degrade;
  /** How long one worker answer may take; the evals raise it on a loaded machine. Default `SHEET_WORKER_TIMEOUT_MS`. */
  workerTimeoutMs?: number;
  /** Read the sheet NUMBER only — the strips and the corner cell — and stop: for naming rows rastered before the cell read existed. Lines are still read (the deskew needs them). */
  numberOnly?: boolean;
};

export async function rasterizeSheet(bytes: Uint8Array, pageNumber: number, options: RasterizeOptions = {}): Promise<RasterizedSheet> {
  const dpi = options.dpi ?? RASTER_DPI;
  const t0 = Date.now();
  const sheet = SheetWorker.start(options.workerTimeoutMs === undefined ? {} : { timeoutMs: options.workerTimeoutMs });
  try {
    let gray: Gray = await sheet.render(bytes, pageNumber, dpi);
    if (options.degrade) gray = degrade(gray, options.degrade);
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
    let sheetNumberFromStrips: string | null = null;
    let sheetNumberCell: string | null = null;
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
      sheetNumberFromStrips = reading.sheetNumber;
      titleBlockText = reading.regionText;
      // ── THE NUMBER CELL, READ AGAIN ON ITS OWN ──
      // The sheet number is the biggest text on the page and the tiled pass
      // reads it worst: Evergreen p22 came back "BUILDING D A244 1 B it" for
      // A241B, p105 "S112" for S11.2. Measured on those two (NOTES-scanned.md
      // §13): single-line and block modes read the cell wrong or not at all,
      // SPARSE mode at double size reads both right, and a character
      // whitelist only zeroes the confidences (the LSTM engine ignores it).
      // So the bottom-right corner is read once more, sparse, at 2x, and the
      // tallest line that reads as a designation is the number.
      const cell = await sheet.ocrCell(gray, { x: gray.width * (1 - NUMBER_CELL.width), y: gray.height * (1 - NUMBER_CELL.height), width: gray.width * NUMBER_CELL.width, height: gray.height * NUMBER_CELL.height }, { cachePath, psm: 11, upscale: 2 });
      gray = cell.gray;
      sheetNumberCell = designationFromCell(cell.lines);
      sheetNumber = sheetNumberCell ?? sheetNumberFromStrips;
      // ── STOP EARLY ONLY WHEN TWO READS SAY SO ──
      // On a blurred, skewed scan the corner cell read Crosslines' A100 as
      // "A00" — a cover-sheet number — and the stage stopped: no captions, no
      // views, 1,445 of 3,609 ft where the clean raster found 4,024. On Joplin
      // the scan read NO number and the strips' garbage title alone said
      // "skip". A number or a title OCR'd off a scan is a guess, and a guess
      // that throws the whole sheet away needs a second witness: both the
      // corner cell and the strips must have read a designation, and the
      // verdict must say skip for each. One read, or none, reads the sheet.
      if (stopReadingEarly(sheetNumberCell, sheetNumberFromStrips, reading.regionText) || options.numberOnly) {
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
    // This stage runs only on pages the inventory called scanned, so the page
    // size is paper plus scanner margin; the gate takes an inch of it.
    const printed = scaleFromPrinted(printedScalesOnPage(text), size.widthPt, size.heightPt, { scanned: true });
    return {
      dpi,
      widthPt: size.widthPt,
      heightPt: size.heightPt,
      tiltDegrees: Math.abs(tilt) > 0.15 ? tilt : 0,
      lines: lines.map((l) => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, width: l.width })),
      text,
      printedScale: printed?.scaleName ?? null,
      sheetNumber,
      sheetNumberFromStrips,
      sheetNumberCell,
      titleBlockText,
      ocrStoppedEarly,
      ms: { render: t1 - t0, lines: t2 - t1, ocr: t3 - t2, total: Date.now() - t0 },
      rss: { afterRender: rssAfterRender, afterLines: rssAfterLines, afterOcr: process.memoryUsage().rss },
    };
  } finally {
    await sheet.close();
  }
}
