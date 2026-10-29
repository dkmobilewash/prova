import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { claimPorts, closeIfSettled, ingestViewOf } from "@/lib/plan-ingest/claim";
import { rasterWork, storeRaster, storedRasterFor } from "@/lib/plan-ingest/raster";
import { runIngest } from "@/lib/plan-ingest/runner";
import type { RasterizedSheet } from "@/lib/takeoff/raster/rasterizeSheet";

/**
 * Scanned sheets on a scratch database: the switch, which pages become
 * RASTER tasks (the scans the inventory's counts say are scans), what the
 * stage stores with the render-and-OCR step injected, and what the takeoff
 * page then loads — the stored lines for the viewer and the OCR'd scale as
 * the calibration prefill.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
process.env.TAKEOFF_LOCAL_PLAN_DIR = `${process.cwd()}/e2e/fixtures`;
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveScannedPlansSwitch } = await import("./scannedSheets");
const { startPlanIngest } = await import("./planIngest");
const { loadTakeoffWorkspace } = await import("@/lib/takeoff/workspaceLoad");

let companyId = "";
let planId = "";
let jobId = "";
let job: { id: string; status: string };

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Scanned Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({
    data: { companyId, clerkId: `scan_${Date.now()}`, email: `scan_${Date.now()}@example.test`, role: "OWNER" },
  });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const created = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Scanned Job", status: "ESTIMATE" } });
  job = { id: created.id, status: created.status };
  jobId = created.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:plan-sheet.pdf" } });
  planId = plan.id;
  // The inventory's rows: page 1 is a scan (no text, no paths, an image); page 2
  // has a text layer. The fixture file has one page, so a task past it would say so.
  await prisma.planSheetText.create({
    data: { planId, pageNumber: 1, hasTextLayer: false, pathOperators: 0, imageOperators: 1, widthPt: 200, heightPt: 200 },
  });
  await prisma.planSheetText.create({ data: { planId, pageNumber: 2, hasTextLayer: true, widthPt: 200, heightPt: 200 } });
});

afterAll(async () => {
  await prisma.planIngestJob.deleteMany({ where: { planId } });
  await prisma.planSheetText.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

const read: RasterizedSheet = {
  dpi: 200,
  widthPt: 200,
  heightPt: 200,
  tiltDegrees: 0.4,
  lines: [
    { x1: 20, y1: 100, x2: 180, y2: 100, width: 1 },
    { x1: 20, y1: 110, x2: 180, y2: 110, width: 1 },
  ],
  text: [{ str: `SCALE: 1/8" = 1'-0"`, x: 20, y: 190, width: 80, height: 6, confidence: 91 }],
  printedScale: `1/8" = 1'-0"`,
  sheetNumber: "A101",
  sheetNumberFromStrips: "A101",
  sheetNumberCell: "A101",
  titleBlockText: "SHEET NUMBER A101 FLOOR PLAN",
  ocrStoppedEarly: false,
  ms: { render: 1, lines: 1, ocr: 1, total: 3 },
  rss: { afterRender: 0, afterLines: 0, afterOcr: 0 },
};

describe("scanned sheets", () => {
  it("refuses to start while the company's switch is off, and says where the switch is", async () => {
    const result = await startPlanIngest(planId, "RASTER");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Settings/);
  });

  it("the owner turns it on", async () => {
    const form = new FormData();
    form.set("scannedPlansOn", "on");
    expect(await saveScannedPlansSwitch(form)).toEqual({ ok: true });
  });

  it("makes a task for the scanned page only", async () => {
    const result = await startPlanIngest(planId, "RASTER");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(1);
    const tasks = await prisma.planIngestTask.findMany({ where: { jobId: result.value.jobId }, select: { pageNumber: true } });
    expect(tasks.map((t) => t.pageNumber)).toEqual([1]);
  });

  it("the stage stores what the render-and-OCR step read, and the server's detection can read it back", async () => {
    const run = await prisma.planIngestJob.findFirstOrThrow({ where: { planId, stage: "RASTER" }, select: { id: true } });
    const asked: number[] = [];
    const work = rasterWork(
      { planId, companyId, ingestJobId: run.id, jobId, startedByUserId: context.id },
      {
        readPlanBytes: async () => ({ ok: true, bytes: Buffer.from("%PDF-stub") }),
        rasterize: async (_bytes, pageNumber) => {
          asked.push(pageNumber);
          return read;
        },
        store: storeRaster,
      },
    );
    const report = await runIngest({ ports: claimPorts({ jobId: run.id, work }), budgetMs: 10_000 });
    expect(report).toMatchObject({ done: 1, retryable: 0, exhausted: 0 });
    expect(await closeIfSettled(run.id)).toBe(true);
    expect((await ingestViewOf(run.id, "RASTER")).complete).toBe(true);
    expect(asked).toEqual([1]);
    const stored = await storedRasterFor(planId, 1);
    expect(stored).toEqual({
      widthPt: 200,
      heightPt: 200,
      segments: read.lines,
      textItems: read.text,
      printedScale: `1/8" = 1'-0"`,
    });
    expect(await storedRasterFor(planId, 2)).toBeNull();
  });

  it("the takeoff page gets the scanned pages, the stored lines, and the OCR'd scale as the prefill", async () => {
    const loaded = await loadTakeoffWorkspace({ id: companyId }, job);
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.scannedPages).toEqual([1]);
    expect(loaded.scannedPlansOn).toBe(true);
    expect(loaded.rasterByPage[1]?.segments.length).toBe(2);
    expect(loaded.rasterByPage[2]).toBeUndefined();
    expect(loaded.printedScaleByPage[1]).toBe(`1/8" = 1'-0"`);
    // The scan's own number, read off its corner and stored on the raster row, names it in the picker.
    expect(loaded.sheetLabelByPage[1]).toBe("A101");
  });

  it("a second press with every scan read hands back the finished run rather than a new one of zero", async () => {
    const again = await startPlanIngest(planId, "RASTER");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.total).toBe(1);
  });
});
