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
//   { type: "ocr", gray, width, height, dpi, cachePath, tilePxAt150, minConfidence, regions, skipTiles, lanes }
//                                                          → { items, tiles, tileKeys }
import { parentPort } from "node:worker_threads";
import { planTiles } from "./tilePlan.mjs";

let pdfjs = null;
let doc = null;

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

// ── TILES, READ BY A SMALL POOL OF TESSERACT WORKERS ──
//
// Tiles are cut straight from the grey into a tile canvas each lane owns;
// with `regions`, only the tiles touching one are read; `skipTiles` are
// tiles a previous call already read (the first look's, when the rest of
// the page is read after it).
//
// Three things make the page faster than one worker reading every tile in
// turn, and none of them may change a single word that comes out — the
// walls read the words (NOTES-scanned.md §12 measured one grey level moving
// 24 ft), so the output is kept byte-identical by construction:
//   · a tile with no ink is never sent. Tesseract on a blank tile returns
//     nothing, after a quarter of a second; a plan sheet's margins are a
//     third of its tiles. The ink count is a threshold on dark pixels, far
//     below what a single glyph leaves.
//   · `lanes` Tesseract workers read tiles concurrently (WASM is CPU-bound,
//     so each lane is a core). Results are kept per tile and folded in TILE
//     ORDER afterwards, so the dedupe sees them in the same order as a
//     single worker would and the items list is the same list.
//   · the lanes are created once and kept for the sheet; the first
//     `createWorker` and language load are the price of the first tile.
const lanes = [];
async function laneWorkers(cachePath, count) {
  while (lanes.length < count) {
    const { createWorker } = await import("tesseract.js");
    lanes.push(await createWorker("eng", 1, { cachePath, logger: () => {} }));
  }
  return lanes.slice(0, count);
}

async function ocr(gray, width, height, dpi, cachePath, tilePxAt150, minConfidence, regions, skipTiles, laneCount) {
  const workers = await laneWorkers(cachePath, Math.max(1, laneCount ?? 1));
  const tile = Math.round((tilePxAt150 * dpi) / 150);
  const overlap = Math.round(tile / 12);
  const { plan, tileKeys } = planTiles(gray, width, height, tile, overlap, regions, new Set(skipTiles ?? []));
  const results = new Array(plan.length);
  let next = 0;
  const lane = async (tess) => {
    const canvas = doc.canvasFactory.create(tile, tile);
    const image = canvas.context.getImageData(0, 0, tile, tile);
    for (;;) {
      const index = next;
      if (index >= plan.length) return;
      next += 1;
      const { x0, y0, tw, th } = plan[index];
      const full = tw === tile && th === tile;
      const piece = full ? canvas : doc.canvasFactory.create(tw, th);
      const pixels = full ? image : piece.context.getImageData(0, 0, tw, th);
      for (let y = 0; y < th; y += 1) {
        const row = (y0 + y) * width + x0;
        for (let x = 0; x < tw; x += 1) {
          const v = gray[row + x];
          const o = (y * tw + x) * 4;
          pixels.data[o] = pixels.data[o + 1] = pixels.data[o + 2] = v;
          pixels.data[o + 3] = 255;
        }
      }
      piece.context.putImageData(pixels, 0, 0);
      const { data } = await tess.recognize(piece.canvas.toBuffer("image/png"), {}, { blocks: true });
      results[index] = data.blocks ?? [];
    }
  };
  await Promise.all(workers.map((tess) => lane(tess)));
  const items = [];
  const seen = new Set();
  plan.forEach(({ x0, y0 }, index) => {
    for (const block of results[index]) {
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
  });
  return { items, tiles: plan.length, tileKeys };
}

parentPort.on("message", async (message) => {
  try {
    if (message.type === "render") {
      const out = await render(message.bytes, message.page, message.dpi, message.bandPx);
      parentPort.postMessage({ ok: true, ...out }, [out.gray.buffer]);
    } else if (message.type === "ocr") {
      const out = await ocr(message.gray, message.width, message.height, message.dpi, message.cachePath, message.tilePxAt150, message.minConfidence, message.regions, message.skipTiles, message.lanes);
      // The grey goes back the way it came, so the caller keeps using it.
      parentPort.postMessage({ ok: true, ...out, gray: message.gray }, [message.gray.buffer]);
    } else if (message.type === "close") {
      for (const tess of lanes) await tess.terminate();
      if (doc) await doc.destroy();
      parentPort.postMessage({ ok: true });
    }
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.stack ?? error) });
  }
});
