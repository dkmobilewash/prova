import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectForSheet } from "../offeredCandidates";
import { rasterizeSheet } from "../raster/rasterizeSheet";
import { scaleFromPrinted } from "../scaleFromPrinted";

/**
 * ── THE RASTER STAGE'S COST, SHEET BY SHEET, ON A WHOLE SET ──
 *
 * Runs exactly what the stage runs (`rasterizeSheet` at 200 dpi, Tesseract
 * included) over the first N pages of one TRAINING set as if every page were
 * a scan, and records time per step and the process's resident memory after
 * each, so the report can say what a 50-sheet set costs and whether it fits
 * the server's per-invocation limits. Nothing is scored here — that is
 * `scanned.eval.ts` on the research branch.
 *
 *   REAL_PLAN_DIR=… RASTER_EVAL_SET="2025.07.08_Baker_EOC_BID.pdf" RASTER_EVAL_PAGES=50 RASTER_EVAL_OUT=… \
 *   node_modules/.bin/vitest run --config vitest.eval.config.mts lib/takeoff/realplan/rasterStage.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.RASTER_EVAL_SET ?? "";
const PAGES = Number(process.env.RASTER_EVAL_PAGES ?? "50");
const OUT = process.env.RASTER_EVAL_OUT ?? "";
const HELD_OUT = /central.?bank|gen.?bbq|\bSLN\b|STEM|lodi|pavilion|nall|fairchild|albany|oreilly|jefferson/i;

describe.skipIf(DIR === "" || SET === "")("the raster stage over a set", () => {
  it("times and measures every page as if it were a scan", { timeout: 3_600_000 }, async () => {
    expect(HELD_OUT.test(SET), `${SET} is held out`).toBe(false);
    const bytes = new Uint8Array(readFileSync(join(DIR, SET)));
    console.log(`baseline rss ${Math.round(process.memoryUsage().rss / 1048576)} MB before any sheet`);
    const rows: { page: number; ms: { render: number; lines: number; ocr: number; total: number }; lines: number; text: number; scale: string | null; sheet: string | null; stoppedEarly: boolean; rssMb: number; rssSteps: number[]; heapMb: number }[] = [];
    for (let page = 1; page <= PAGES; page += 1) {
      let read;
      try {
        // A copy per page: pdf.js TRANSFERS the buffer it is given to its
        // worker, so the bytes are spent after one open (the stage reads the
        // plan file afresh per task, which is why it never sees this).
        read = await rasterizeSheet(bytes.slice(), page);
      } catch (error) {
        if (String(error).includes("Invalid page")) break;
        throw error;
      }
      // With `NODE_OPTIONS=--expose-gc`, collect before sampling, so the
      // figure is what the process KEEPS after a sheet rather than garbage
      // the collector has not reached — the number a server's limit sees
      // once the allocator returns freed pages.
      (globalThis as { gc?: () => void }).gc?.();
      const mem = process.memoryUsage();
      const mb = (b: number) => Math.round(b / 1048576);
      // What the finder would then do with it, where the sheet's own caption
      // gave a scale: the walls it offers and whether it took the whole sheet.
      let detectNote = "";
      const printed = read.printedScale === null ? null : scaleFromPrinted([read.printedScale], read.widthPt, read.heightPt);
      if (printed) {
        const detected = detectForSheet({ segments: read.lines, textItems: read.text, pageSize: { widthPt: read.widthPt, heightPt: read.heightPt }, feetPerUnit: printed.declaredDistanceFeet, scanned: true });
        const feet = Math.round(detected.found.walls.reduce((n, w) => n + w.lengthFeet, 0));
        detectNote = ` · detect: ${feet} ft in ${detected.found.walls.length} runs, views ${detected.views}, kept [${detected.kept.map((k) => k.name).join(", ")}]${detected.wholeSheet ? " WHOLE SHEET" : ""}`;
      }
      rows.push({ page, ms: read.ms, lines: read.lines.length, text: read.text.length, scale: read.printedScale, sheet: read.sheetNumber, stoppedEarly: read.ocrStoppedEarly, rssMb: mb(mem.rss), rssSteps: [mb(read.rss.afterRender), mb(read.rss.afterLines), mb(read.rss.afterOcr)], heapMb: mb(mem.heapUsed) });
      console.log(`p${page} ${read.sheetNumber ?? "—"}${read.ocrStoppedEarly ? " (stopped early)" : ""}: ${read.ms.total} ms (render ${read.ms.render}, lines ${read.ms.lines}, ocr ${read.ms.ocr}) · ${read.lines.length} lines · ${read.text.length} words · scale ${read.printedScale ?? "—"} · rss render/lines/ocr ${rows[rows.length - 1].rssSteps.join("/")} MB · title "${read.titleBlockText.replace(/\s+/g, " ").slice(0, 70)}"${detectNote}`);
    }
    const sorted = rows.map((r) => r.ms.total).sort((a, b) => a - b);
    const summary = {
      set: SET,
      pages: rows.length,
      medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
      maxMs: sorted[sorted.length - 1] ?? 0,
      meanMs: Math.round(rows.reduce((n, r) => n + r.ms.total, 0) / Math.max(1, rows.length)),
      peakRssMb: Math.max(0, ...rows.map((r) => r.rssMb)),
      peakHeapMb: Math.max(0, ...rows.map((r) => r.heapMb)),
      scaleRead: rows.filter((r) => r.scale !== null).length,
      stoppedEarly: rows.filter((r) => r.stoppedEarly).length,
    };
    console.log(JSON.stringify(summary));
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${SET}.raster-stage.json`), JSON.stringify({ summary, rows }, null, 2));
    }
    expect(rows.length).toBeGreaterThan(0);
  });
});
