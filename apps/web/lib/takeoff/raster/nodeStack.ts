import { fileURLToPath } from "node:url";
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
};

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

/** One sheet's render and OCR, in a thread of its own. `close()` is what frees the memory.
 *
 *
 * ── THE WORKER SCRIPT IS A FILE ON DISK, AND WEBPACK MUST NOT SEE IT ──
 *
 * This was `new Worker(new URL("./rasterWorker.mjs", import.meta.url))`, the
 * documented spelling — and webpack recognises exactly that spelling as
 * worker syntax. Next's server build turned it into
 * `new Worker(new URL(c.p + c.u(1854), c.b))`: the thread was started on a
 * webpack CHUNK (6 KB, Tesseract's `createWorker` loaded through
 * `c.e(3147)`) instead of the plain ESM file, and in that thread the page
 * never came back. Evergreen's 106 RASTER tasks: 0 finished, attempts spent,
 * no error anywhere, the server idle on a claimed task (2026-10-29). The same
 * file run by vitest, where no bundler rewrites it, reads a page in 16 s. The
 * eval could never see this, because the eval never goes through the bundle.
 *
 * So the path is a string computed from `import.meta.url` — which webpack
 * leaves as the source file's own URL and does not pattern-match — and the
 * thread loads the real `rasterWorker.mjs`, which resolves `pdfjs-dist` and
 * `tesseract.js` from node_modules like any module. The file is force-included
 * in the output trace (`next.config.mjs`) so a deploy ships it;
 * `rasterWorkerPath()` is exported so a test can assert the file exists where
 * the thread will look.
 */
export function rasterWorkerPath(): string {
  const here = fileURLToPath(import.meta.url);
  return here.slice(0, here.lastIndexOf("/") + 1) + "rasterWorker.mjs";
}

/** How long one message to the thread may take before the sheet is given up
 *  on. A page is 5–28 s on Evergreen at 200 dpi; the runner's lease is 90 s. */
export const SHEET_WORKER_TIMEOUT_MS = 75_000;

export class SheetWorker {
  private readonly worker: Worker;
  /** Set the moment the thread dies, so a later ask fails at once instead of
   *  waiting on a thread that will never answer. */
  private dead: Error | null = null;
  private readonly timeoutMs: number;
  private constructor(worker: Worker, timeoutMs: number) {
    this.worker = worker;
    this.timeoutMs = timeoutMs;
    // ── LISTENED TO FROM THE START, NOT ONLY DURING AN ASK ──
    // A thread that fails to load emits `error` before the first message is
    // ever posted; with no listener that is an uncaught exception in the
    // server, and with one the next ask knows to refuse.
    this.worker.on("error", (error: Error) => {
      this.dead = error;
    });
    this.worker.on("exit", (code) => {
      if (this.dead === null && code !== 0) this.dead = new Error(`the sheet's thread exited with code ${code}`);
    });
  }
  static start(options: { script?: string; timeoutMs?: number } = {}): SheetWorker {
    return new SheetWorker(new Worker(options.script ?? rasterWorkerPath()), options.timeoutMs ?? SHEET_WORKER_TIMEOUT_MS);
  }
  private ask<T extends object>(message: object, transfer: ArrayBufferLike[] = []): Promise<T> {
    if (this.dead !== null) return Promise.reject(this.dead);
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
      const onExit = (code: number) => {
        cleanup();
        reject(new Error(`the sheet's thread exited with code ${code} before answering`));
      };
      // ── A THREAD THAT NEVER ANSWERS IS A FAILURE, NOT A WAIT ──
      // Without this a hung thread held the runner's claim until the lease
      // lapsed, the next tick claimed the page again, and nothing was ever
      // written down. Unref'd so it cannot keep a process alive.
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`the sheet's thread did not answer within ${Math.round(this.timeoutMs / 1000)} s`));
      }, this.timeoutMs);
      timer.unref();
      const cleanup = () => {
        clearTimeout(timer);
        this.worker.off("message", onMessage);
        this.worker.off("error", onError);
        this.worker.off("exit", onExit);
      };
      this.worker.once("message", onMessage);
      this.worker.once("error", onError);
      this.worker.once("exit", onExit);
      this.worker.postMessage(message, transfer as ArrayBuffer[]);
    });
  }
  /** One page as 8-bit grey at `dpi`, rotation applied the way the viewer shows it, drawn in bands. */
  /** `direct` is true when the page was one 1-bit image read straight from its bits, never through a canvas (see `scanGray` in the worker). */
  async render(bytes: Uint8Array, pageNumber: number, dpi: number, bandPx = 600): Promise<Gray & { direct: boolean }> {
    // A copy is handed over: pdf.js keeps the buffer it is given, and the
    // caller may still want its bytes.
    const copy = bytes.slice();
    const reply = await this.ask<{ gray: Uint8Array; width: number; height: number; direct: boolean }>({ type: "render", bytes: copy, page: pageNumber, dpi, bandPx }, [copy.buffer]);
    return { width: reply.width, height: reply.height, data: reply.gray, direct: reply.direct };
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

  /** Ends the sheet: the document, the Tesseract worker and the thread go. */
  async close(): Promise<void> {
    try {
      if (this.dead === null) await this.ask({ type: "close" });
    } catch {
      // A thread that cannot even close is terminated below; nothing to add.
    } finally {
      await this.worker.terminate();
    }
  }
}
