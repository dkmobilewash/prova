import type { Gray } from "./pgm";

/**
 * ── THE RENDER AND THE OCR A LINUX SERVER CAN RUN ──
 *
 * `scanTool.swift` is the research arm: PDFKit and Vision, a Mac only. This
 * is the same two steps with what the app already ships — `pdfjs-dist` with
 * its Node canvas (`@napi-rs/canvas`, prebuilt for linux-x64/arm64 and
 * darwin) for the render, and `tesseract.js` (WASM, already a dependency,
 * used by `fixtures/tesseract.eval.ts`) for the text. No native build, no
 * Apple framework, nothing to install on Vercel beyond what is there.
 *
 * Both are imported dynamically: they are only wanted when a scan arrives.
 */

export type OcrItem = { str: string; x: number; y: number; width: number; height: number; confidence: number };

type PdfDoc = { getPage(n: number): Promise<PdfPage>; canvasFactory: CanvasFactory; destroy(): Promise<void> };
type PdfPage = {
  getViewport(o: { scale: number; offsetX?: number; offsetY?: number }): { width: number; height: number };
  render(o: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
  /** Drops the page's cached operator list and decoded images. */
  cleanup?(): void;
};
type CanvasFactory = { create(w: number, h: number): { canvas: NodeCanvas; context: NodeContext } };
type NodeCanvas = { width: number; height: number; toBuffer(mime: "image/png"): Buffer };
type NodeContext = {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  putImageData(img: { data: Uint8ClampedArray }, x: number, y: number): void;
};

/** Opens the bytes with pdf.js. The bytes are SPENT by this: pdf.js transfers
 *  the buffer to its worker, so a caller that opens the same file twice hands
 *  over a copy the second time. */
export async function openPdf(bytes: Uint8Array): Promise<PdfDoc> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return (await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise) as unknown as PdfDoc;
}

/**
 * One page as 8-bit grey at `dpi`, rotation applied the way the viewer shows it.
 *
 * RENDERED IN BANDS. A whole ARCH D sheet at 200 dpi is a 7,200 × 4,800 RGBA
 * canvas — 138 MB — and that canvas was the biggest single thing a sheet
 * cost (NOTES-scanned.md §7). pdf.js can render any window of the page by
 * offsetting the viewport, so the page is drawn into a band `bandPx` rows
 * tall, converted to grey, and the band reused; the only full-page buffer
 * is the grey itself, one byte per pixel. The operator list runs once per
 * band, which costs a few hundred milliseconds on a plan sheet.
 */
export async function renderGray(doc: PdfDoc, pageNumber: number, dpi: number, bandPx = 600): Promise<{ gray: Gray }> {
  const page = await doc.getPage(pageNumber);
  const full = page.getViewport({ scale: dpi / 72 });
  const width = Math.round(full.width);
  const height = Math.round(full.height);
  const data = new Uint8Array(width * height);
  const bandHeight = Math.min(bandPx, height);
  const { canvas, context } = doc.canvasFactory.create(width, bandHeight);
  for (let top = 0; top < height; top += bandHeight) {
    const rows = Math.min(bandHeight, height - top);
    context.fillStyle = "white";
    context.fillRect(0, 0, width, bandHeight);
    const viewport = page.getViewport({ scale: dpi / 72, offsetY: -top });
    await page.render({ canvasContext: context, viewport }).promise;
    const rgba = context.getImageData(0, 0, width, rows).data;
    for (let i = 0; i < width * rows; i += 1) data[top * width + i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  }
  void canvas;
  // The page's operator list and its decoded images are pdf.js's cache for
  // drawing it again; nothing here will, so they go now rather than with the
  // document.
  page.cleanup?.();
  return { gray: { width, height, data } };
}

/**
 * Tesseract's habits on a scale caption, measured on Baker A101 at 150 and
 * 200 dpi: `1'-0"` loses its foot mark and comes back `1-0"`. The app's scale
 * reader wants the mark, so it is put back where a feet-inches figure
 * follows an equals sign. Nothing else is touched.
 */
export function tidyOcrLine(str: string): string {
  return str.replace(/(=\s*\d+)-(\d+\s*")/g, "$1'-$2");
}

export type OcrOptions = {
  /** Where tesseract.js keeps `eng.traineddata` (downloaded once). */
  cachePath: string;
  /** Tile edge in pixels at 150 dpi; scaled with the dpi so a tile covers the same paper. 1200 by default. */
  tilePxAt150?: number;
  dpi: number;
  /** Drop lines Tesseract is less sure of than this (0–100). 40 by default. */
  minConfidence?: number;
};

/**
 * Tesseract over tiles of the rendered page, LINES not words: a scale
 * caption is one line — `SCALE: 1/8" = 1'-0"` — and the app's scale reader
 * wants it whole. Positions in pixels, y down from the top, like the Swift
 * tool's, so the bench treats both the same.
 *
 * Measured on Baker A101: at 150 dpi, native tiles of 1200 px read the
 * caption; 2× upscaled tiles did not and took twice as long.
 */
/** A window of the page, in pixels; `ocrTiles` reads only the tiles that touch one. */
export type PxRegion = { x: number; y: number; width: number; height: number };

/**
 * Tiles are cut STRAIGHT FROM THE GREY into a tile-sized canvas — never a
 * full-page RGBA canvas (138 MB at 200 dpi) for Tesseract to crop from.
 * With `regions`, only the tiles that touch a region are read: the title
 * block and the bottom band hold the sheet number and the scale caption,
 * and a sheet whose number says schedule or detail needs no more than that.
 */
/** One Tesseract worker, to be shared by every OCR pass on a sheet and terminated once. */
export async function ocrWorker(cachePath: string): Promise<OcrWorker> {
  const { createWorker } = await import("tesseract.js");
  return (await createWorker("eng", 1, { cachePath, logger: () => {} })) as unknown as OcrWorker;
}
export type OcrWorker = {
  recognize(image: Buffer, o: object, out: { blocks: true }): Promise<{ data: unknown }>;
  terminate(): Promise<unknown>;
};

export async function ocrTiles(
  doc: PdfDoc,
  gray: Gray,
  options: OcrOptions & {
    regions?: readonly PxRegion[];
    skipTiles?: ReadonlySet<string>;
    worker?: OcrWorker;
  },
): Promise<{ items: OcrItem[]; tiles: number; ms: number; tileKeys: string[] }> {
  // A worker handed in is the caller's to terminate; one made here is not.
  const own = options.worker === undefined;
  const worker = options.worker ?? (await ocrWorker(options.cachePath));
  const shrink = 1;
  const tile = Math.round(((options.tilePxAt150 ?? 1200) * options.dpi) / 150);
  const overlap = Math.round(tile / 12);
  const minConfidence = options.minConfidence ?? 40;
  const items: OcrItem[] = [];
  const seen = new Set<string>();
  const tileKeys: string[] = [];
  const t0 = Date.now();
  let tiles = 0;
  const touches = (x0: number, y0: number, tw: number, th: number) =>
    options.regions === undefined || options.regions.some((r) => x0 < r.x + r.width && x0 + tw > r.x && y0 < r.y + r.height && y0 + th > r.y);
  // ONE tile canvas for every full tile, written into in place: a fresh
  // 10 MB canvas per tile was most of a sheet's garbage. Edge tiles get a
  // canvas of their own size, because the PNG is of the whole canvas.
  const side = Math.ceil(tile / shrink);
  const shared = doc.canvasFactory.create(side, side);
  const sharedImage = shared.context.getImageData(0, 0, side, side);
  try {
    for (let y0 = 0; y0 < gray.height; y0 += tile - overlap) {
      const th = Math.min(tile, gray.height - y0);
      for (let x0 = 0; x0 < gray.width; x0 += tile - overlap) {
        const tw = Math.min(tile, gray.width - x0);
        const key = `${x0}:${y0}`;
        if (!touches(x0, y0, tw, th) || options.skipTiles?.has(key)) {
          if (x0 + tw >= gray.width) break;
          continue;
        }
        tileKeys.push(key);
        const ow = Math.ceil(tw / shrink);
        const oh = Math.ceil(th / shrink);
        const full = ow === side && oh === side;
        const piece = full ? shared : doc.canvasFactory.create(ow, oh);
        const image = full ? sharedImage : piece.context.getImageData(0, 0, ow, oh);
        for (let y = 0; y < oh; y += 1) {
          for (let x = 0; x < ow; x += 1) {
            // The block's mean when shrinking, the pixel itself otherwise.
            let sum = 0;
            let n = 0;
            for (let dy = 0; dy < shrink; dy += 1) {
              const yy = y0 + y * shrink + dy;
              if (yy >= y0 + th) break;
              for (let dx = 0; dx < shrink; dx += 1) {
                const xx = x0 + x * shrink + dx;
                if (xx >= x0 + tw) break;
                sum += gray.data[yy * gray.width + xx];
                n += 1;
              }
            }
            const v = n === 0 ? 255 : sum / n;
            const o = (y * ow + x) * 4;
            image.data[o] = image.data[o + 1] = image.data[o + 2] = v;
            image.data[o + 3] = 255;
          }
        }
        piece.context.putImageData(image, 0, 0);
        const { data } = await worker.recognize(piece.canvas.toBuffer("image/png"), {}, { blocks: true });
        tiles += 1;
        type Line = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
        const blocks = (data as unknown as { blocks?: { paragraphs: { lines: Line[] }[] }[] }).blocks ?? [];
        for (const block of blocks) {
          for (const paragraph of block.paragraphs) {
            for (const line of paragraph.lines) {
              if (line.confidence < minConfidence) continue;
              const str = tidyOcrLine(line.text.trim());
              if (str === "") continue;
              const x = x0 + line.bbox.x0 * shrink;
              const y = y0 + line.bbox.y1 * shrink;
              // The same line read in two tiles' overlap is kept once.
              const key = `${Math.round(x / 6)}:${Math.round(y / 6)}:${str}`;
              if (seen.has(key)) continue;
              seen.add(key);
              items.push({ str, x, y, width: (line.bbox.x1 - line.bbox.x0) * shrink, height: (line.bbox.y1 - line.bbox.y0) * shrink, confidence: line.confidence });
            }
          }
        }
        if (x0 + tw >= gray.width) break;
      }
      if (y0 + th >= gray.height) break;
    }
  } finally {
    if (own) await worker.terminate();
  }
  return { items, tiles, ms: Date.now() - t0, tileKeys };
}
