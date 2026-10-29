import { Worker } from "node:worker_threads";
import type { Gray } from "./pgm";

/**
 * ── THE RENDER AND THE OCR A LINUX SERVER CAN RUN, ONE SHEET PER WORKER ──
 *
 * `scanTool.swift` is the research arm: PDFKit and Vision, a Mac only. This
 * is the same two steps with what the app already ships — `pdfjs-dist` with
 * its Node canvas (`@napi-rs/canvas`, prebuilt for linux-x64/arm64 and
 * darwin) and `tesseract.js` (WASM, already a dependency) — run inside a
 * `worker_threads` Worker that lives for ONE sheet (`rasterWorker.mjs`).
 *
 * The worker is the memory answer. Measured (NOTES-scanned.md §7): a sheet's
 * working set is 450–760 MB and a process that reads fifty in a row keeps a
 * high-water mark of 1.2–1.7 GB, because pdf.js's decoded page, the canvases
 * and Tesseract's WASM heap stay with the process. Terminating the worker
 * tears its isolate down and gives that memory back, sheet by sheet.
 *
 * The grey page crosses the thread boundary by TRANSFER (zero copy) each
 * way; the lines are read on this side, where the TypeScript lives.
 */

export type OcrItem = { str: string; x: number; y: number; width: number; height: number; confidence: number };
/** A window of the page, in pixels; OCR reads only the tiles that touch one. */
export type PxRegion = { x: number; y: number; width: number; height: number };

export type OcrOptions = {
  /** Where tesseract.js keeps `eng.traineddata` (downloaded once). */
  cachePath: string;
  /** Tile edge in pixels at 150 dpi; scaled with the dpi so a tile covers the same paper. 1200 by default. */
  tilePxAt150?: number;
  dpi: number;
  /** Drop lines Tesseract is less sure of than this (0–100). 40 by default. */
  minConfidence?: number;
  regions?: readonly PxRegion[];
  skipTiles?: ReadonlySet<string>;
  /** Tesseract workers reading tiles at once. `RASTER_OCR_LANES` sets the default, 2 without it; the words come out the same whatever the count. */
  lanes?: number;
};

/** The lane count the environment asks for, or 2. */
export function defaultOcrLanes(): number {
  const asked = Number(process.env.RASTER_OCR_LANES ?? "");
  return Number.isInteger(asked) && asked >= 1 ? asked : 2;
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

type Reply = { ok: true; [k: string]: unknown } | { ok: false; error: string };

/**
 * ── WARM, OR TORN DOWN: THE POOL ──
 *
 * §7's memory answer was a thread per sheet, terminated with it. Creating
 * one costs what it loads: pdf.js, and a Tesseract worker per lane with its
 * language file — a second or two a sheet, paid on every sheet of a set
 * read in one process (the ingest runner advances a whole job in one call).
 *
 * So `close()` now RELEASES the thread to a small idle pool, with its
 * document destroyed and its Tesseract lanes kept warm, and `start()` takes
 * an idle one before making a new one. An idle thread is `unref()`'d, so it
 * never keeps a process alive. `RASTER_WORKER_POOL=0` turns the pool off and
 * terminates on close, exactly as before; `SheetWorker.drain()` terminates
 * whatever is idle. Measured in NOTES-scanned.md: what a warm thread holds
 * between sheets is the lanes' WASM heaps, and the sheet's own grey, canvases
 * and document go with `release`.
 */
const POOL_LIMIT = 2;
const idle: SheetWorker[] = [];

function poolOn(): boolean {
  return process.env.RASTER_WORKER_POOL !== "0";
}

/** One sheet's render and OCR, in a thread of its own. `close()` gives the thread back, or ends it with the pool off. */
export class SheetWorker {
  private readonly worker: Worker;
  private constructor(worker: Worker) {
    this.worker = worker;
  }

  static start(): SheetWorker {
    const warm = idle.pop();
    if (warm) {
      warm.worker.ref();
      return warm;
    }
    return new SheetWorker(new Worker(new URL("./rasterWorker.mjs", import.meta.url)));
  }

  /** How many threads are waiting warm; for tests and the budget report. */
  static idleCount(): number {
    return idle.length;
  }

  /** Terminates every idle thread. */
  static async drain(): Promise<void> {
    const waiting = idle.splice(0);
    await Promise.all(waiting.map((w) => w.worker.terminate()));
  }

  private ask<T extends object>(message: object, transfer: ArrayBufferLike[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onMessage = (reply: Reply) => {
        cleanup();
        if (reply.ok) resolve(reply as unknown as T);
        else reject(new Error(reply.error));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        this.worker.off("message", onMessage);
        this.worker.off("error", onError);
      };
      this.worker.once("message", onMessage);
      this.worker.once("error", onError);
      this.worker.postMessage(message, transfer as ArrayBuffer[]);
    });
  }

  /** One page as 8-bit grey at `dpi`, rotation applied the way the viewer shows it, drawn in bands. */
  async render(bytes: Uint8Array, pageNumber: number, dpi: number, bandPx = 600): Promise<Gray> {
    // A copy is handed over: pdf.js keeps the buffer it is given, and the
    // caller may still want its bytes.
    const copy = bytes.slice();
    const reply = await this.ask<{ gray: Uint8Array; width: number; height: number }>({ type: "render", bytes: copy, page: pageNumber, dpi, bandPx }, [copy.buffer]);
    return { width: reply.width, height: reply.height, data: reply.gray };
  }

  /**
   * Tesseract over tiles of the grey, LINES not words: a scale caption is
   * one line and the app's scale reader wants it whole. Positions in pixels,
   * y down from the top. The grey is transferred and handed back.
   */
  async ocr(gray: Gray, options: OcrOptions): Promise<{ items: OcrItem[]; tiles: number; tileKeys: string[]; gray: Gray }> {
    const reply = await this.ask<{ items: OcrItem[]; tiles: number; tileKeys: string[]; gray: Uint8Array }>(
      {
        type: "ocr",
        gray: gray.data,
        width: gray.width,
        height: gray.height,
        dpi: options.dpi,
        cachePath: options.cachePath,
        tilePxAt150: options.tilePxAt150 ?? 1200,
        minConfidence: options.minConfidence ?? 40,
        regions: options.regions ?? null,
        skipTiles: options.skipTiles ? [...options.skipTiles] : null,
        lanes: options.lanes ?? defaultOcrLanes(),
      },
      [gray.data.buffer],
    );
    return {
      items: reply.items.map((i) => ({ ...i, str: tidyOcrLine(i.str) })),
      tiles: reply.tiles,
      tileKeys: reply.tileKeys,
      gray: { width: gray.width, height: gray.height, data: reply.gray },
    };
  }

  /** Ends the sheet: the document goes; the thread and its Tesseract lanes wait for the next sheet, or go too with the pool off. */
  async close(): Promise<void> {
    if (poolOn() && idle.length < POOL_LIMIT) {
      try {
        await this.ask({ type: "release" });
        this.worker.unref();
        idle.push(this);
        return;
      } catch {
        // A thread that could not release is not one to keep.
      }
    }
    try {
      await this.ask({ type: "close" });
    } finally {
      await this.worker.terminate();
    }
  }
}
