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
type PdfPage = { getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> } };
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

/** One page as 8-bit grey at `dpi`, rotation applied the way the viewer shows it. */
export async function renderGray(doc: PdfDoc, pageNumber: number, dpi: number): Promise<{ gray: Gray; canvas: NodeCanvas; context: NodeContext }> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);
  const { canvas, context } = doc.canvasFactory.create(width, height);
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context, viewport }).promise;
  const rgba = context.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 1) data[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  return { gray: { width, height, data }, canvas, context };
}

/** A grey page back onto a canvas, for OCR of a degraded or deskewed page. The
 *  canvas's own ImageData is written into: the Node canvas refuses a plain object. */
export function grayToCanvas(doc: PdfDoc, gray: Gray): { canvas: NodeCanvas; context: NodeContext } {
  const { canvas, context } = doc.canvasFactory.create(gray.width, gray.height);
  const image = context.getImageData(0, 0, gray.width, gray.height);
  for (let i = 0; i < gray.data.length; i += 1) {
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = gray.data[i];
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return { canvas, context };
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
export async function ocrTiles(
  doc: PdfDoc,
  canvas: NodeCanvas,
  context: NodeContext,
  options: OcrOptions,
): Promise<{ items: OcrItem[]; tiles: number; ms: number }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { cachePath: options.cachePath, logger: () => {} });
  const tile = Math.round(((options.tilePxAt150 ?? 1200) * options.dpi) / 150);
  const overlap = Math.round(tile / 12);
  const minConfidence = options.minConfidence ?? 40;
  const items: OcrItem[] = [];
  const seen = new Set<string>();
  const t0 = Date.now();
  let tiles = 0;
  try {
    for (let y0 = 0; y0 < canvas.height; y0 += tile - overlap) {
      const th = Math.min(tile, canvas.height - y0);
      for (let x0 = 0; x0 < canvas.width; x0 += tile - overlap) {
        const tw = Math.min(tile, canvas.width - x0);
        const piece = doc.canvasFactory.create(tw, th);
        piece.context.putImageData(context.getImageData(x0, y0, tw, th), 0, 0);
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
              const x = x0 + line.bbox.x0;
              const y = y0 + line.bbox.y1;
              // The same line read in two tiles' overlap is kept once.
              const key = `${Math.round(x / 6)}:${Math.round(y / 6)}:${str}`;
              if (seen.has(key)) continue;
              seen.add(key);
              items.push({ str, x, y, width: line.bbox.x1 - line.bbox.x0, height: line.bbox.y1 - line.bbox.y0, confidence: line.confidence });
            }
          }
        }
        if (x0 + tw >= canvas.width) break;
      }
      if (y0 + th >= canvas.height) break;
    }
  } finally {
    await worker.terminate();
  }
  return { items, tiles, ms: Date.now() - t0 };
}
