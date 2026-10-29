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
//   { type: "ocrCell", gray, width, height, cachePath, region, upscale, psm, whitelist } → { lines }
import { parentPort } from "node:worker_threads";

let pdfjs = null;
let doc = null;
let worker = null;

async function open(bytes) {
  pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs");
  doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
}

// ── A SCAN IS ONE IMAGE, AND pdf.js HAS ALREADY DECODED IT ──
//
// By the time the operator list exists, pdf.js has decoded a 1-bit scan to
// PACKED rows — 18 MB for a 400-dpi ARCH D page. What costs the seconds and
// the 2–4 GB (NOTES-scanned.md §12) is DRAWING it: the canvas path expands
// it to full-resolution RGBA, 572 MB a copy, and scales that down. So when a
// page is exactly one image laid over the whole page — no rotation, no other
// ink, 1 bit per pixel — the grey is box-averaged straight out of the bits
// and the canvas is never touched. Anything else falls back to the banded
// render below; a vector sheet never enters here.
//
// Ops that only set state are allowed alongside the image, because a scanner
// writes an empty text object on every page; any op that could paint —
// stroke, fill, showText, a second image, a mask — is a reason to fall back.
const STATE_ONLY_OPS = new Set(["save", "restore", "transform", "dependency", "beginText", "endText", "moveText", "setFont", "setTextMatrix", "setLeading", "setCharSpacing", "setWordSpacing", "setHScale", "setTextRise", "setTextRenderingMode", "setGState", "setLineWidth", "setLineCap", "setLineJoin", "setMiterLimit", "setDash", "setFlatness", "setRenderingIntent", "setFillGray", "setStrokeGray", "setFillRGBColor", "setStrokeRGBColor", "setFillCMYKColor", "setStrokeCMYKColor", "setFillColorSpace", "setStrokeColorSpace", "setFillColor", "setStrokeColor", "setFillColorN", "setStrokeColorN", "beginMarkedContent", "beginMarkedContentProps", "endMarkedContent", "markPoint", "markPointProps", "beginCompat", "endCompat"]);
let opNames = null;

async function scanGray(page, width, height) {
  const ops = await page.getOperatorList();
  opNames ??= Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]));
  let imageId = null;
  let placed = null;
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const name = opNames[ops.fnArray[i]];
    if (name === "paintImageXObject") {
      if (imageId !== null) return null;
      imageId = ops.argsArray[i][0];
    } else if (name === "transform") {
      placed = ops.argsArray[i];
    } else if (!STATE_ONLY_OPS.has(name)) {
      return null;
    }
  }
  if (imageId === null || placed === null || page.rotate !== 0) return null;
  // The image must sit over the whole page: its matrix is [w 0 0 h x y] in
  // page points, within a point of the page box.
  const [x0, y0, x1, y1] = page.view;
  const near = (a, b) => Math.abs(a - b) <= 1;
  if (!near(placed[0], x1 - x0) || placed[1] !== 0 || placed[2] !== 0 || !near(placed[3], y1 - y0) || !near(placed[4], x0) || !near(placed[5], y0)) return null;
  const image = page.objs.get(imageId);
  if (!image || image.kind !== pdfjs.ImageKind.GRAYSCALE_1BPP || !image.data) return null;
  const { width: sw, height: sh, data: bits } = image;
  const rowBytes = (sw + 7) >> 3;
  // Each output pixel averages the source pixels whose floor-mapped column
  // and row land on it — a box filter, exact at integer ratios (a 400-dpi
  // scan read at 200 is 2 x 2) and nearest-area otherwise.
  const colOf = new Uint32Array(sw);
  for (let x = 0; x < sw; x += 1) colOf[x] = Math.min(width - 1, Math.floor((x * width) / sw));
  const colCount = new Uint32Array(width);
  for (let x = 0; x < sw; x += 1) colCount[colOf[x]] += 1;
  const sum = new Uint32Array(width * height);
  const rowCount = new Uint32Array(height);
  for (let y = 0; y < sh; y += 1) {
    const oy = Math.min(height - 1, Math.floor((y * height) / sh));
    rowCount[oy] += 1;
    const base = oy * width;
    const row = y * rowBytes;
    for (let x = 0; x < sw; x += 1) {
      // Bit set is white, as pdf.js paints GRAYSCALE_1BPP.
      if (bits[row + (x >> 3)] & (0x80 >> (x & 7))) sum[base + colOf[x]] += 1;
    }
  }
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const rows = rowCount[y];
    for (let x = 0; x < width; x += 1) {
      const n = rows * colCount[x];
      // Mapped the way the canvas path comes out — 256ths, white pinned to
      // 255 — so a 2 x 2 box reads 0 / 64 / 128 / 192 / 255 and the grey is
      // byte-identical to the render it replaces (measured on Evergreen p24:
      // 0 pixels differ; with plain rounding, 0.4% differed by one level).
      const white = sum[y * width + x];
      data[y * width + x] = n === 0 || white === n ? 255 : Math.round((256 * white) / n);
    }
  }
  return data;
}

// Drawn in bands of `bandPx` rows into one reused canvas; the only full-page
// buffer is the 8-bit grey. A one-image scan skips the canvas entirely.
async function render(bytes, pageNumber, dpi, bandPx) {
  await open(bytes);
  const page = await doc.getPage(pageNumber);
  const full = page.getViewport({ scale: dpi / 72 });
  const width = Math.round(full.width);
  const height = Math.round(full.height);
  const direct = await scanGray(page, width, height);
  if (direct) {
    page.cleanup?.();
    return { gray: direct, width, height, direct: true };
  }
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
  return { gray: data, width, height, direct: false };
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

// ── ONE CELL OF THE PAGE, READ AS A LINE ──
//
// The sheet number is the biggest text on the page and Tesseract's tiled
// pass reads it worst: the strip tile cuts it in with its neighbours and the
// automatic layout splits "A241B" into "A244 1 B" (Evergreen p22, measured).
// So the cell is cut out on its own, upscaled, and read in SINGLE-LINE mode
// with a whitelist of what a designation can contain. A second Tesseract
// worker does it, so the parameters never touch the tiled pass and its
// words — and therefore the walls — stay exactly what they were.
let cellWorker = null;
async function ocrCell(gray, width, height, cachePath, region, upscale, psm, whitelist) {
  if (cellWorker === null) {
    const { createWorker } = await import("tesseract.js");
    cellWorker = await createWorker("eng", 1, { cachePath, logger: () => {} });
  }
  await cellWorker.setParameters({ tessedit_pageseg_mode: String(psm), tessedit_char_whitelist: whitelist ?? "" });
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width, Math.ceil(region.x + region.width));
  const y1 = Math.min(height, Math.ceil(region.y + region.height));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 4 || ch < 4) return { lines: [] };
  const s = Math.max(1, Math.round(upscale));
  const piece = doc.canvasFactory.create(cw * s, ch * s);
  const image = piece.context.getImageData(0, 0, cw * s, ch * s);
  for (let y = 0; y < ch * s; y += 1) {
    const row = (y0 + Math.floor(y / s)) * width + x0;
    for (let x = 0; x < cw * s; x += 1) {
      const v = gray[row + Math.floor(x / s)];
      const o = (y * cw * s + x) * 4;
      image.data[o] = image.data[o + 1] = image.data[o + 2] = v;
      image.data[o + 3] = 255;
    }
  }
  piece.context.putImageData(image, 0, 0);
  const { data } = await cellWorker.recognize(piece.canvas.toBuffer("image/png"), {}, { blocks: true });
  const lines = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const str = line.text.trim();
        if (str === "") continue;
        lines.push({ str, confidence: line.confidence, height: (line.bbox.y1 - line.bbox.y0) / s });
      }
    }
  }
  return { lines };
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
    } else if (message.type === "ocrCell") {
      const out = await ocrCell(message.gray, message.width, message.height, message.cachePath, message.region, message.upscale, message.psm, message.whitelist);
      parentPort.postMessage({ ok: true, ...out, gray: message.gray }, [message.gray.buffer]);
    } else if (message.type === "close") {
      if (worker) await worker.terminate();
      if (cellWorker) await cellWorker.terminate();
      if (doc) await doc.destroy();
      parentPort.postMessage({ ok: true });
    }
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.stack ?? error) });
  }
});
