// The render and the OCR of ONE scanned sheet, in a worker thread of their
// own. `nodeStack.ts` starts one per sheet and terminates it when the sheet
// is done, which is how the memory a sheet costs — pdf.js's decoded page,
// the canvases, Tesseract's WASM heap — leaves the process with the sheet
// instead of staying as the process's high-water mark (NOTES-scanned.md §7).
//
// Plain JavaScript on purpose: a worker file is loaded by path, not bundled
// with its importer, so it imports only the two packages it needs by name
// and nothing from the app. The protocol is typed on the TypeScript side.
//
//   { type: "render", bytes, page, dpi, bandPx }           → { gray, width, height }
//   { type: "ocr", gray, width, height, dpi, cachePath, tilePxAt150, minConfidence, regions, skipTiles }
//                                                          → { items, tiles, tileKeys }
import { parentPort } from "node:worker_threads";

let pdfjs = null;
let doc = null;
let worker = null;

async function open(bytes) {
  pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs");
  doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
}

// Drawn in bands of `bandPx` rows into one reused canvas; the only full-page
// buffer is the 8-bit grey.
async function render(bytes, pageNumber, dpi, bandPx) {
  await open(bytes);
  const page = await doc.getPage(pageNumber);
  const full = page.getViewport({ scale: dpi / 72 });
  const width = Math.round(full.width);
  const height = Math.round(full.height);
  const data = new Uint8Array(width * height);
  const bandHeight = Math.min(bandPx, height);
  const { context } = doc.canvasFactory.create(width, bandHeight);
  for (let top = 0; top < height; top += bandHeight) {
    const rows = Math.min(bandHeight, height - top);
    context.fillStyle = "white";
    context.fillRect(0, 0, width, bandHeight);
    const viewport = page.getViewport({ scale: dpi / 72, offsetY: -top });
    await page.render({ canvasContext: context, viewport }).promise;
    const rgba = context.getImageData(0, 0, width, rows).data;
    for (let i = 0; i < width * rows; i += 1) data[top * width + i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  }
  page.cleanup?.();
  return { gray: data, width, height };
}

// Tiles cut straight from the grey into one reused tile canvas; with
// `regions`, only the tiles touching one are read; `skipTiles` are tiles a
// first pass already read. Lines, not words: a scale caption is one line.
async function ocr(gray, width, height, dpi, cachePath, tilePxAt150, minConfidence, regions, skipTiles) {
  if (worker === null) {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng", 1, { cachePath, logger: () => {} });
  }
  const tile = Math.round((tilePxAt150 * dpi) / 150);
  const overlap = Math.round(tile / 12);
  const items = [];
  const seen = new Set();
  const tileKeys = [];
  let tiles = 0;
  const skip = new Set(skipTiles ?? []);
  const touches = (x0, y0, tw, th) =>
    regions === null || regions.some((r) => x0 < r.x + r.width && x0 + tw > r.x && y0 < r.y + r.height && y0 + th > r.y);
  const shared = doc.canvasFactory.create(tile, tile);
  const sharedImage = shared.context.getImageData(0, 0, tile, tile);
  for (let y0 = 0; y0 < height; y0 += tile - overlap) {
    const th = Math.min(tile, height - y0);
    for (let x0 = 0; x0 < width; x0 += tile - overlap) {
      const tw = Math.min(tile, width - x0);
      const key = `${x0}:${y0}`;
      if (!touches(x0, y0, tw, th) || skip.has(key)) {
        if (x0 + tw >= width) break;
        continue;
      }
      tileKeys.push(key);
      const full = tw === tile && th === tile;
      const piece = full ? shared : doc.canvasFactory.create(tw, th);
      const image = full ? sharedImage : piece.context.getImageData(0, 0, tw, th);
      for (let y = 0; y < th; y += 1) {
        const row = (y0 + y) * width + x0;
        for (let x = 0; x < tw; x += 1) {
          const v = gray[row + x];
          const o = (y * tw + x) * 4;
          image.data[o] = image.data[o + 1] = image.data[o + 2] = v;
          image.data[o + 3] = 255;
        }
      }
      piece.context.putImageData(image, 0, 0);
      const { data } = await worker.recognize(piece.canvas.toBuffer("image/png"), {}, { blocks: true });
      tiles += 1;
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            if (line.confidence < minConfidence) continue;
            const str = line.text.trim();
            if (str === "") continue;
            const x = x0 + line.bbox.x0;
            const y = y0 + line.bbox.y1;
            const dedupe = `${Math.round(x / 6)}:${Math.round(y / 6)}:${str}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            items.push({ str, x, y, width: line.bbox.x1 - line.bbox.x0, height: line.bbox.y1 - line.bbox.y0, confidence: line.confidence });
          }
        }
      }
      if (x0 + tw >= width) break;
    }
    if (y0 + th >= height) break;
  }
  return { items, tiles, tileKeys };
}

parentPort.on("message", async (message) => {
  try {
    if (message.type === "render") {
      const out = await render(message.bytes, message.page, message.dpi, message.bandPx);
      parentPort.postMessage({ ok: true, ...out }, [out.gray.buffer]);
    } else if (message.type === "ocr") {
      const out = await ocr(message.gray, message.width, message.height, message.dpi, message.cachePath, message.tilePxAt150, message.minConfidence, message.regions, message.skipTiles);
      // The grey goes back the way it came, so the caller keeps using it.
      parentPort.postMessage({ ok: true, ...out, gray: message.gray }, [message.gray.buffer]);
    } else if (message.type === "close") {
      if (worker) await worker.terminate();
      if (doc) await doc.destroy();
      parentPort.postMessage({ ok: true });
    }
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.stack ?? error) });
  }
});
