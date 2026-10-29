import { prisma } from "@prova/db";
import { rasterizeSheet, type RasterizedSheet } from "@/lib/takeoff/raster/rasterizeSheet";
import { readPlanBytes } from "./planBytes";
import { isScannedSheet } from "./scannedSheet";
import type { StageCtx, StageWork } from "./stages";

/**
 * ── THE RASTER STAGE: a scanned sheet read as lines and text ──
 *
 * One task per SCANNED page (`scannedPageNumbers`): render at 200 dpi, read
 * the lines off the bitmap, deskew, OCR the text, read the printed scale —
 * `rasterizeSheet` — and keep the result on `PlanSheetRaster`, in points,
 * where `detectWallsForCalibration` and the viewer's Find the walls read it
 * instead of the file's strokes. The finder is then the same finder.
 *
 * A stage of the ingest runner for the same reasons the whole-set takeoff
 * is: one task per sheet, an atomic claim, the browser pump, retries. It
 * spends nothing (no model) and takes seconds per sheet: measured in
 * `realplan/rasterStage.eval.ts`, around ten seconds of CPU at 200 dpi with
 * Tesseract most of it, inside the runner's per-advance budget of one sheet.
 *
 * The plan file is read per task, like detection; the pdf is opened,
 * rendered and destroyed inside the task, so nothing is held between pages.
 */

export async function scannedPageNumbers(planId: string): Promise<number[]> {
  const rows = await prisma.planSheetText.findMany({
    where: { planId },
    select: { pageNumber: true, hasTextLayer: true, pathOperators: true, imageOperators: true },
    orderBy: { pageNumber: "asc" },
  });
  return rows.filter(isScannedSheet).map((row) => row.pageNumber);
}

/** What the stage keeps for a page — the row `PlanSheetRaster` holds. */
export type RasterRow = {
  dpi: number;
  widthPt: number;
  heightPt: number;
  tiltDegrees: number;
  lines: RasterizedSheet["lines"];
  text: RasterizedSheet["text"];
  printedScale: string | null;
  ms: number;
};

export type RasterDeps = {
  readPlanBytes: typeof readPlanBytes;
  rasterize: (bytes: Uint8Array, pageNumber: number) => Promise<RasterizedSheet>;
  /** Keep the page's read. The real one upserts `PlanSheetRaster`; a test
   *  hands in a map, so the stage can be run THROUGH THE RUNNER without a
   *  database — the only way its failure path gets exercised in a unit test. */
  store: (planId: string, pageNumber: number, row: RasterRow) => Promise<void>;
};

/** The real store: `PlanSheetRaster`, one row per page, replaced on a re-run. */
export async function storeRaster(planId: string, pageNumber: number, row: RasterRow): Promise<void> {
  await prisma.planSheetRaster.upsert({
    where: { planId_pageNumber: { planId, pageNumber } },
    create: { planId, pageNumber, ...row },
    update: row,
  });
}

const realDeps: RasterDeps = {
  readPlanBytes,
  rasterize: (bytes, pageNumber) => rasterizeSheet(bytes, pageNumber),
  store: storeRaster,
};

export function rasterWork(ctx: StageCtx, deps: RasterDeps = realDeps): StageWork {
  return async (task) => {
    const file = await deps.readPlanBytes(ctx.planId, ctx.companyId);
    if (!file.ok) return { ok: false, error: file.error };
    let read: RasterizedSheet;
    try {
      read = await deps.rasterize(new Uint8Array(file.bytes), task.pageNumber);
    } catch (error) {
      console.error("[raster] a scanned sheet could not be read", { planId: ctx.planId, pageNumber: task.pageNumber, error });
      return { ok: false, error: "This sheet couldn't be read as an image. Retry it, and tell C Stream if it keeps failing." };
    }
    const row: RasterRow = {
      dpi: read.dpi,
      widthPt: read.widthPt,
      heightPt: read.heightPt,
      tiltDegrees: read.tiltDegrees,
      lines: read.lines,
      text: read.text,
      printedScale: read.printedScale,
      ms: read.ms.total,
    };
    await deps.store(ctx.planId, task.pageNumber, row);
    return { ok: true };
  };
}

/** The stored read for a page, or null — in the shape `detectForSheet` takes. */
export type StoredRaster = {
  widthPt: number;
  heightPt: number;
  segments: { x1: number; y1: number; x2: number; y2: number; width?: number }[];
  textItems: { str: string; x: number; y: number; width: number; height: number; confidence?: number }[];
  printedScale: string | null;
};

export function storedRasterFrom(row: { widthPt: number; heightPt: number; lines: unknown; text: unknown; printedScale: string | null } | null): StoredRaster | null {
  if (row === null) return null;
  const lines = Array.isArray(row.lines) ? (row.lines as StoredRaster["segments"]) : [];
  const text = Array.isArray(row.text) ? (row.text as StoredRaster["textItems"]) : [];
  return { widthPt: row.widthPt, heightPt: row.heightPt, segments: lines, textItems: text, printedScale: row.printedScale };
}

export async function storedRasterFor(planId: string, pageNumber: number): Promise<StoredRaster | null> {
  return storedRasterFrom(
    await prisma.planSheetRaster.findUnique({
      where: { planId_pageNumber: { planId, pageNumber } },
      select: { widthPt: true, heightPt: true, lines: true, text: true, printedScale: true },
    }),
  );
}
