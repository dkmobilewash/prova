import { prisma } from "@prova/db";
import { calibrationNotices, calibrationRefusal } from "@/lib/takeoff-plan";
import { scaleFromPrinted } from "@/lib/takeoff/scaleFromPrinted";

/**
 * ── A SCANNED SHEET GETS ITS PAGE ROW THE MOMENT IT IS READ ──
 *
 * The viewer builds its sheet list from `plan.pages`, and a vector set gets
 * those rows when its printed scales are applied or a scale is set by hand.
 * A scanned set got neither on its own — the inventory sees no text layer,
 * so no scale reading, so no page row — and every `?page=N` on Evergreen fell
 * into the route's first-sheet fallback; the only way in was two rows made
 * by hand. So the RASTER stage, which is the first thing that READS a
 * scanned page, writes the row itself:
 *
 *   - the `TakeoffPlanPage`, labelled with the sheet number OCR read off the
 *     corner where it read one, with the page's width;
 *   - where OCR read a printed scale, the `PlanSheetScaleReading` the
 *     inventory would have written for a vector page (`source: PRINTED`), and
 *     a calibration from it — `scaleFromPrinted` with `scanned: true`, the
 *     product's own conversion, allowing the scanner's margin on the sheet
 *     size; never a number anybody typed. The note says it was read off the
 *     picture and checked against nothing.
 *   - otherwise just the row, which the viewer shows as "set the scale".
 *
 * Never twice: a page that already carries a calibration keeps it — which is
 * what leaves the two hand-made Evergreen rows alone.
 */
export type ScannedPageRead = {
  widthPt: number;
  heightPt: number;
  printedScale: string | null;
  sheetNumber: string | null;
};

export type ScannedPageRowOutcome = {
  page: "created" | "kept";
  scale: "set" | "already set" | "none read" | `refused: ${string}`;
};

export async function scannedPageRow(input: { planId: string; pageNumber: number; userId: string | null; read: ScannedPageRead }): Promise<ScannedPageRowOutcome> {
  const { planId, pageNumber, read } = input;
  const existing = await prisma.takeoffPlanPage.findUnique({
    where: { planId_pageNumber: { planId, pageNumber } },
    select: { id: true, label: true, calibrations: { select: { id: true }, take: 1 } },
  });
  const page =
    existing ??
    (await prisma.takeoffPlanPage.create({
      data: { planId, pageNumber, label: read.sheetNumber, pageWidthPt: read.widthPt },
      select: { id: true, label: true, calibrations: { select: { id: true }, take: 1 } },
    }));
  if (existing !== null && existing.label === null && read.sheetNumber !== null) {
    await prisma.takeoffPlanPage.update({ where: { id: page.id }, data: { label: read.sheetNumber, pageWidthPt: read.widthPt } });
  }
  const outcome: ScannedPageRowOutcome = { page: existing === null ? "created" : "kept", scale: "none read" };
  if (read.printedScale === null) return outcome;
  const printed = scaleFromPrinted([read.printedScale], read.widthPt, read.heightPt, { scanned: true });
  if (printed === null) return { ...outcome, scale: `refused: ${read.printedScale} does not fit this sheet's size` };
  const reading = {
    scaleName: printed.scaleName,
    source: "PRINTED",
    x1: printed.x1,
    y1: printed.y1,
    x2: printed.x2,
    y2: printed.y2,
    declaredDistanceFeet: printed.declaredDistanceFeet,
    declaredText: printed.declaredText,
    agreedText: null,
    consideredCount: 0,
    inheritedError: null,
    declineReason: null,
  };
  await prisma.planSheetScaleReading.upsert({
    where: { planId_pageNumber: { planId, pageNumber } },
    create: { planId, pageNumber, ...reading },
    update: reading,
  });
  if (page.calibrations.length > 0) return { ...outcome, scale: "already set" };
  const line = { x1: printed.x1, y1: printed.y1, x2: printed.x2, y2: printed.y2, declaredDistanceFeet: printed.declaredDistanceFeet };
  const refusal = calibrationRefusal(calibrationNotices(line, read.widthPt, null, null));
  if (refusal) return { ...outcome, scale: `refused: ${refusal}` };
  await prisma.takeoffScaleCalibration.create({
    data: {
      pageId: page.id,
      ...line,
      declaredDistanceFeet: line.declaredDistanceFeet.toFixed(4),
      note: `From the ${printed.scaleName} this scan prints, read off the picture by OCR and checked against nothing — check it on the sheet. The sheet's size allows for the scanner's margin.`,
      createdByUserId: input.userId,
    },
  });
  return { ...outcome, scale: "set" };
}

/**
 * ── THE PAGES RASTERED BEFORE THIS EXISTED ──
 *
 * RASTER never re-reads a page, so a scanned set read before the page-row
 * step shipped has raster rows and no page rows (Evergreen's other 104).
 * This gives each such raster row the page row the stage would have written,
 * by the stage's own rules: one `scannedPageRow` per `PlanSheetRaster` with
 * no `TakeoffPlanPage`, from what OCR stored. A raster row whose page already
 * exists is not touched at all — which is what leaves a hand-made row, and
 * whatever scale a person set on it, exactly as it was.
 */
export async function backfillScannedPageRows(input: { planId?: string; userId?: string | null; dryRun?: boolean } = {}) {
  const rasters = await prisma.planSheetRaster.findMany({
    where: input.planId === undefined ? {} : { planId: input.planId },
    select: { planId: true, pageNumber: true, widthPt: true, heightPt: true, printedScale: true, sheetNumber: true },
    orderBy: [{ planId: "asc" }, { pageNumber: "asc" }],
  });
  const pages = await prisma.takeoffPlanPage.findMany({ where: { planId: { in: [...new Set(rasters.map((r) => r.planId))] } }, select: { planId: true, pageNumber: true } });
  const has = new Set(pages.map((p) => `${p.planId}:${p.pageNumber}`));
  const missing = rasters.filter((r) => !has.has(`${r.planId}:${r.pageNumber}`));
  const outcomes: { planId: string; pageNumber: number; outcome: ScannedPageRowOutcome }[] = [];
  if (!input.dryRun) {
    for (const r of missing) {
      const outcome = await scannedPageRow({ planId: r.planId, pageNumber: r.pageNumber, userId: input.userId ?? null, read: { widthPt: r.widthPt, heightPt: r.heightPt, printedScale: r.printedScale, sheetNumber: r.sheetNumber } });
      outcomes.push({ planId: r.planId, pageNumber: r.pageNumber, outcome });
    }
  }
  return { rasters: rasters.length, withRows: rasters.length - missing.length, missing: missing.map((r) => ({ planId: r.planId, pageNumber: r.pageNumber })), outcomes };
}
