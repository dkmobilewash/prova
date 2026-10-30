import { prisma } from "@prova/db";
import { rasterizeSheet, type RasterizedSheet } from "@/lib/takeoff/raster/rasterizeSheet";
import { readPlanBytes } from "./planBytes";
import { isScannedSheet } from "./scannedSheet";
import { scannedPageRow, type ScannedPageRead, type ScannedPageRowOutcome } from "./scannedPageRow";
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
  /** The sheet number read from the title-block corner (#845), or null. */
  sheetNumber: RasterizedSheet["sheetNumber"];
  ms: number;
};

export type RasterDeps = {
  readPlanBytes: typeof readPlanBytes;
  rasterize: (bytes: Uint8Array, pageNumber: number) => Promise<RasterizedSheet>;
  /** Keep the page's read. The real one upserts `PlanSheetRaster`; a test
   *  hands in a map, so the stage can be run THROUGH THE RUNNER without a
   *  database — the only way its failure path gets exercised in a unit test. */
  store: (planId: string, pageNumber: number, row: RasterRow) => Promise<void>;
  /** The page's row and OCR-read scale on the job (`scannedPageRow.ts`); the real one writes the database, a test records the call. */
  pageRow: (input: { planId: string; pageNumber: number; userId: string | null; read: ScannedPageRead }) => Promise<ScannedPageRowOutcome>;
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
  pageRow: scannedPageRow,
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
      sheetNumber: read.sheetNumber,
      ms: read.ms.total,
    };
    await deps.store(ctx.planId, task.pageNumber, row);
    // The sheet is readable now, so it gets its page row — and its scale,
    // where OCR read one — the way a vector sheet gets them from its printed
    // scale. A failure here is logged and does not fail the read: the raster
    // row is written and the page can still be given a scale by hand.
    try {
      await deps.pageRow({ planId: ctx.planId, pageNumber: task.pageNumber, userId: ctx.startedByUserId, read: { widthPt: read.widthPt, heightPt: read.heightPt, printedScale: read.printedScale, sheetNumber: read.sheetNumber } });
    } catch (error) {
      console.error("[raster] the page row after the read threw", { planId: ctx.planId, pageNumber: task.pageNumber, error });
    }
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

/**
 * ── THE NUMBER OF A SHEET RASTERED BEFORE THE CORNER READ EXISTED ──
 *
 * Rows written before #845 carry `sheetNumber: null`: the tiled pass misses
 * the title block's big numerals, and the stored text cannot name the sheet
 * after the fact (checked: Evergreen p24's 221 stored words read nothing).
 * So each such row is read again for its number only — render, strips, the
 * corner cell, stop (`numberOnly`) — and where that names the sheet, the row
 * gets the number and the page row its label, if it has none. A row that has
 * a number is not read; a page a person labelled keeps that label. Rows that
 * still read nothing stay null and are reported, not invented.
 */
export type SheetNumberDeps = {
  readPlanBytes: typeof readPlanBytes;
  read: (bytes: Uint8Array, pageNumber: number) => Promise<{ sheetNumber: string | null }>;
};

const numberDeps: SheetNumberDeps = {
  readPlanBytes,
  read: (bytes, pageNumber) => rasterizeSheet(bytes, pageNumber, { numberOnly: true }),
};

export async function backfillScannedSheetNumbers(input: { planId?: string; dryRun?: boolean } = {}, deps: SheetNumberDeps = numberDeps) {
  const rows = await prisma.planSheetRaster.findMany({
    where: { sheetNumber: null, ...(input.planId === undefined ? {} : { planId: input.planId }) },
    select: { planId: true, pageNumber: true, plan: { select: { companyId: true } } },
    orderBy: [{ planId: "asc" }, { pageNumber: "asc" }],
  });
  const outcomes: { planId: string; pageNumber: number; sheetNumber: string | null; label: "set" | "kept" | "no page row" | null }[] = [];
  if (input.dryRun) return { unnamed: rows.length, outcomes };
  const bytesByPlan = new Map<string, Uint8Array | null>();
  for (const row of rows) {
    if (!bytesByPlan.has(row.planId)) {
      const file = await deps.readPlanBytes(row.planId, row.plan.companyId);
      bytesByPlan.set(row.planId, file.ok ? new Uint8Array(file.bytes) : null);
      if (!file.ok) console.error("[raster] the plan file could not be read for its sheet numbers", { planId: row.planId, error: file.error });
    }
    const bytes = bytesByPlan.get(row.planId) ?? null;
    if (bytes === null) continue;
    const { sheetNumber } = await deps.read(bytes, row.pageNumber);
    let label: (typeof outcomes)[number]["label"] = null;
    if (sheetNumber !== null) {
      await prisma.planSheetRaster.update({ where: { planId_pageNumber: { planId: row.planId, pageNumber: row.pageNumber } }, data: { sheetNumber } });
      const page = await prisma.takeoffPlanPage.findUnique({ where: { planId_pageNumber: { planId: row.planId, pageNumber: row.pageNumber } }, select: { id: true, label: true } });
      if (page === null) label = "no page row";
      else if (page.label !== null) label = "kept";
      else {
        await prisma.takeoffPlanPage.update({ where: { id: page.id }, data: { label: sheetNumber } });
        label = "set";
      }
    }
    outcomes.push({ planId: row.planId, pageNumber: row.pageNumber, sheetNumber, label });
  }
  return { unnamed: rows.length, outcomes };
}
