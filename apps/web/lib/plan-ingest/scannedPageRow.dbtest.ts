import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { rasterWork, storeRaster } from "./raster";
import { backfillScannedPageRows, scannedPageRow } from "./scannedPageRow";
import { runIngest, type ClaimedTask, type RunnerPorts } from "./runner";
import type { RasterizedSheet } from "@/lib/takeoff/raster/rasterizeSheet";

/**
 * A scanned set's sheets on the job, through the RASTER stage and the ingest
 * runner, on a scratch database: the real `rasterWork` with a stood-in read
 * (no Tesseract), the real raster store and the real page-row step. Page 1
 * prints a scale OCR can read, page 2 prints none; both get a page row, only
 * page 1 a calibration — from `scaleFromPrinted` with `scanned: true`, never
 * a typed number — and a second run adds nothing.
 */
let planId = "";
const ARCH_D = { widthPt: 2592 + 18, heightPt: 1728 + 18 }; // 36 x 24 in plus half an inch of scanner margin each way
const read = (printedScale: string | null, sheetNumber: string | null): RasterizedSheet =>
  ({ dpi: 72, widthPt: ARCH_D.widthPt, heightPt: ARCH_D.heightPt, tiltDegrees: 0, lines: [], text: [], printedScale, sheetNumber, sheetNumberFromStrips: null, sheetNumberCell: null, titleBlockText: null, ocrStoppedEarly: false, ms: { render: 1, lines: 1, ocr: 1, total: 3 }, rss: { afterRender: 0, afterLines: 0, afterOcr: 0 } }) as unknown as RasterizedSheet;

function memoryPorts(tasks: ClaimedTask[], work: RunnerPorts["work"]) {
  const queue = [...tasks];
  const failed: { task: ClaimedTask; error: string }[] = [];
  const ports: RunnerPorts = {
    claim: async () => { const next = queue.shift(); return next === undefined ? null : { ...next, attempts: next.attempts + 1 }; },
    work,
    finish: async () => {},
    fail: async (task, error) => { failed.push({ task, error }); },
  };
  return { ports, failed };
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Scanned Rows Co" } });
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Scanned Job", status: "ESTIMATE" } });
  const plan = await prisma.takeoffPlan.create({ data: { companyId: company.id, jobId: job.id, fileUrl: "local:scan.pdf", fileName: "scan.pdf" } });
  planId = plan.id;
  for (const pageNumber of [1, 2]) await prisma.planSheetText.create({ data: { planId, pageNumber, hasTextLayer: false, widthPt: ARCH_D.widthPt, heightPt: ARCH_D.heightPt } });
});

const run = async () => {
  const work = rasterWork(
    { planId, companyId: "", ingestJobId: "ingest-1", jobId: "", startedByUserId: null },
    {
      readPlanBytes: async () => ({ ok: true, bytes: Buffer.alloc(8) }),
      rasterize: async (_bytes, pageNumber) => (pageNumber === 1 ? read(`1/8" = 1'-0"`, "A-101") : read(null, null)),
      store: storeRaster,
      pageRow: scannedPageRow,
    },
  );
  const { ports, failed } = memoryPorts([{ id: "t1", pageNumber: 1, stage: "RASTER", attempts: 0 }, { id: "t2", pageNumber: 2, stage: "RASTER", attempts: 0 }], work);
  const report = await runIngest({ ports, budgetMs: 60_000 });
  return { report, failed };
};

describe("a scanned sheet's page row after RASTER", () => {
  it("GIVES EVERY READ PAGE A ROW, and the one with an OCR-read scale its calibration from scaleFromPrinted", async () => {
    const { report, failed } = await run();
    expect(failed).toEqual([]);
    expect(report).toMatchObject({ done: 2, retryable: 0, exhausted: 0 });
    const pages = await prisma.takeoffPlanPage.findMany({ where: { planId }, orderBy: { pageNumber: "asc" }, include: { calibrations: true } });
    expect(pages.map((p) => [p.pageNumber, p.label, p.pageWidthPt, p.calibrations.length])).toEqual([[1, "A-101", ARCH_D.widthPt, 1], [2, null, ARCH_D.widthPt, 0]]);
    const cal = pages[0]!.calibrations[0]!;
    // 1/8" = 1'-0" across a 36 in sheet is 288 ft, the scanner's margin allowed for.
    expect(Number(cal.declaredDistanceFeet)).toBeCloseTo((ARCH_D.widthPt / 72) * 8, 2);
    expect(cal.note).toMatch(/read off the picture/);
    expect(cal.createdByUserId).toBeNull();
    const reading = await prisma.planSheetScaleReading.findUnique({ where: { planId_pageNumber: { planId, pageNumber: 1 } } });
    expect(reading?.source).toBe("PRINTED");
    expect(reading?.scaleName).toBe(`1/8" = 1'-0"`);
    expect(await prisma.planSheetScaleReading.count({ where: { planId, pageNumber: 2 } })).toBe(0);
  });

  it("never writes twice: a second read keeps the one calibration, and a hand-set scale is left alone", async () => {
    const { report } = await run();
    expect(report).toMatchObject({ done: 2 });
    expect(await prisma.takeoffScaleCalibration.count({ where: { page: { planId } } })).toBe(1);
    expect(await prisma.takeoffPlanPage.count({ where: { planId } })).toBe(2);
    // A scale somebody set on page 2 by hand survives the next read.
    const p2 = await prisma.takeoffPlanPage.findUniqueOrThrow({ where: { planId_pageNumber: { planId, pageNumber: 2 } } });
    await prisma.takeoffScaleCalibration.create({ data: { pageId: p2.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
    const outcome = await scannedPageRow({ planId, pageNumber: 2, userId: null, read: { widthPt: ARCH_D.widthPt, heightPt: ARCH_D.heightPt, printedScale: `1/4" = 1'-0"`, sheetNumber: "A-102" } });
    expect(outcome).toEqual({ page: "kept", scale: "already set" });
    const after = await prisma.takeoffPlanPage.findUniqueOrThrow({ where: { planId_pageNumber: { planId, pageNumber: 2 } }, include: { calibrations: true } });
    expect(after.calibrations.map((c) => Number(c.declaredDistanceFeet))).toEqual([100]);
    expect(after.label).toBe("A-102");
  });

  it("BACKFILLS the pages rastered before this existed: a raster row with no page row gets one by the same rules, and rows that exist are not touched", async () => {
    const rasterRow = (pageNumber: number, printedScale: string | null, sheetNumber: string | null) => ({ planId, pageNumber, dpi: 72, widthPt: ARCH_D.widthPt, heightPt: ARCH_D.heightPt, tiltDegrees: 0, lines: [], text: [], printedScale, sheetNumber, ms: 3 });
    // Pages 1 and 2 have raster rows from the stage and page rows already (page 2's calibration is the hand-set 100 ft); 3 and 4 were "rastered before": raster rows only, 3 printing a scale and 4 none.
    await prisma.planSheetRaster.createMany({ data: [rasterRow(3, `1/4" = 1'-0"`, "A-103"), rasterRow(4, null, null)] });
    const dry = await backfillScannedPageRows({ planId, dryRun: true });
    expect(dry).toMatchObject({ rasters: 4, withRows: 2, outcomes: [] });
    expect(dry.missing.map((m) => m.pageNumber)).toEqual([3, 4]);
    expect(await prisma.takeoffPlanPage.count({ where: { planId } })).toBe(2);

    const done = await backfillScannedPageRows({ planId });
    expect(done.outcomes.map((o) => [o.pageNumber, o.outcome])).toEqual([[3, { page: "created", scale: "set" }], [4, { page: "created", scale: "none read" }]]);
    const pages = await prisma.takeoffPlanPage.findMany({ where: { planId }, orderBy: { pageNumber: "asc" }, include: { calibrations: true } });
    expect(pages.map((p) => [p.pageNumber, p.label, p.pageWidthPt, p.calibrations.length])).toEqual([[1, "A-101", ARCH_D.widthPt, 1], [2, "A-102", ARCH_D.widthPt, 1], [3, "A-103", ARCH_D.widthPt, 1], [4, null, ARCH_D.widthPt, 0]]);
    expect(Number(pages[2]!.calibrations[0]!.declaredDistanceFeet)).toBeCloseTo((ARCH_D.widthPt / 72) * 4, 2);
    expect(pages[2]!.calibrations[0]!.note).toMatch(/read off the picture/);
    expect(pages[1]!.calibrations.map((c) => Number(c.declaredDistanceFeet))).toEqual([100]);
    expect((await prisma.planSheetScaleReading.findUnique({ where: { planId_pageNumber: { planId, pageNumber: 3 } } }))?.scaleName).toBe(`1/4" = 1'-0"`);
    // Nothing left to do, and nothing done twice.
    expect(await backfillScannedPageRows({ planId })).toMatchObject({ rasters: 4, withRows: 4, missing: [], outcomes: [] });
    expect(await prisma.takeoffScaleCalibration.count({ where: { page: { planId } } })).toBe(3);
  });
});
