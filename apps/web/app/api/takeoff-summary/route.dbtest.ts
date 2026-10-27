import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { PDFDocument } from "pdf-lib";

/**
 * The takeoff summary download on a scratch database: the switch, then one
 * job's typed wall (a measurement with a wall run), untyped wall, room, area
 * and door schedule coming out as CSV and as a PDF with the sheet embedded —
 * while a raw finder group and a measurement on a schedule sheet stay OUT.
 * The plan is the e2e fixture read the way a dev build reads a local set
 * (`lib/plan-ingest/localPlanFile.ts`).
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
process.env.TAKEOFF_LOCAL_PLAN_DIR = `${process.cwd()}/e2e/fixtures`;
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { GET } = await import("./route");
const { saveTakeoffExportSwitch } = await import("@/lib/actions/takeoffExport");

let companyId = "";
let jobId = "";
let planId = "";
const call = (qs: string) => GET(new Request(`http://localhost/api/takeoff-summary${qs}`));

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Export Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({
    data: { companyId, clerkId: `export_${Date.now()}`, email: `export_${Date.now()}@example.test`, role: "OWNER" },
  });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Export Job", status: "ESTIMATE" } });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:plan-sheet.pdf", fileName: "plan-sheet.pdf" } });
  planId = plan.id;
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1 } });
  // Page 2 is a schedule sheet by the index: its measurement must be left out, and said so.
  const schedulePage = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 2 } });
  for (const n of [1, 2]) await prisma.planSheetText.create({ data: { planId, pageNumber: n, hasTextLayer: true, widthPt: 200, heightPt: 200 } });
  const inventory = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "PAGE_INVENTORY", pageCount: 2, finishedAt: new Date() } });
  await prisma.planSheetProposal.create({
    data: {
      ingestJobId: inventory.id,
      planId,
      pageNumber: 2,
      proposedSheetNumber: "A601",
      proposedTitle: "DOOR SCHEDULE",
      proposedReason: "test",
      proposedConfidence: "HIGH",
      model: "test",
      promptVersion: "test",
      status: "ACCEPTED",
      acceptedSheetNumber: "A601",
      acceptedTitle: "DOOR SCHEDULE",
    },
  });
  const scheduleCalibration = await prisma.takeoffScaleCalibration.create({
    data: { pageId: schedulePage.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" },
  });
  // 100 ft across the page.
  const calibration = await prisma.takeoffScaleCalibration.create({
    data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" },
  });
  const type = await prisma.wallType.create({
    data: { companyId, code: "P1", name: "Partition", thicknessIn: "6", defaultHeightFt: "10", sides: 2, studSpacingIn: "16" },
  });
  // A raw finder group nobody pressed Add on: NOT exported.
  await prisma.takeoffWallProposal.create({
    data: {
      pageId: page.id,
      calibrationId: calibration.id,
      thicknessInches: 6,
      source: "REMAINDER",
      runs: [{ x1: 0.1, y1: 0.9, x2: 0.9, y2: 0.9, thicknessFeet: 0.5 }],
    },
  });
  // "Add as P1 — priced": the run as a measurement with a wall run naming the type.
  const run = await prisma.wallRun.create({
    data: { companyId, jobId, wallTypeId: type.id, label: "P1 wall — 6″", lengthFt: "30", heightFt: "10" },
  });
  const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "ACT ceiling", type: "AREA", colorHex: "#00AAFF" } });
  await prisma.takeoffMeasurement.createMany({
    data: [
      {
        pageId: page.id,
        calibrationId: calibration.id,
        kind: "AREA",
        xs: [0.5, 0.6, 0.6, 0.5],
        ys: [0.5, 0.5, 0.6, 0.6],
        label: "OFFICE",
        source: "ROOM_FINDER",
        roomName: "OFFICE",
        roomNumber: "101",
        ceilingFamily: "GYP",
        ceilingCode: "GB",
        ceilingHeightFeet: 10,
        ceilingFrom: "tag",
      },
      { pageId: page.id, calibrationId: calibration.id, kind: "AREA", xs: [0, 0.2, 0.2, 0], ys: [0, 0, 0.1, 0.1], itemId: item.id },
      { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [0.1, 0.4], ys: [0.5, 0.5], label: "P1 wall — 6″", wallRunId: run.id, postedAt: new Date() },
      { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [0.1, 0.2], ys: [0.7, 0.7], label: "8″ wall" },
      { pageId: schedulePage.id, calibrationId: scheduleCalibration.id, kind: "LINEAR", xs: [0.1, 0.9], ys: [0.7, 0.7], label: "8″ wall" },
    ],
  });
  const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "SCHEDULE_ROWS", pageCount: 1, finishedAt: new Date() } });
  await prisma.planScheduleProposal.create({
    data: {
      ingestJobId: ingest.id,
      planId,
      pageNumber: 1,
      kind: "DOOR",
      title: "DOOR SCHEDULE",
      rows: [{ mark: "101", description: "HM", size: `3'-0" x 7'-0"`, quantity: null, notes: null }],
      reason: "test",
      confidence: "HIGH",
      gridRowCount: 1,
      readRowCount: 1,
      model: "test",
      promptVersion: "test",
    },
  });
  void type;
});

afterAll(async () => {
  await prisma.planIngestJob.deleteMany({ where: { planId } });
  await prisma.planSheetText.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.wallRun.deleteMany({ where: { jobId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("GET /api/takeoff-summary", () => {
  it("refuses while the company's switch is off, and says where the switch is", async () => {
    const res = await call(`?jobId=${jobId}&format=csv`);
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Settings/);
  });

  it("the owner turns it on", async () => {
    const form = new FormData();
    form.set("takeoffExportOn", "on");
    expect(await saveTakeoffExportSwitch(form)).toEqual({ ok: true });
  });

  it("refuses a job that is not the company's, and a format it does not make", async () => {
    expect((await call(`?jobId=someone-elses&format=csv`)).status).toBe(404);
    expect((await call(`?jobId=${jobId}&format=xlsx`)).status).toBe(400);
  });

  it("the CSV carries the typed wall, the untyped wall feet-only, the room, the area, the door — and not the raw group or the schedule sheet's line", async () => {
    const res = await call(`?jobId=${jobId}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/takeoff-summary-Export-Job-\d{4}-\d{2}-\d{2}\.csv/);
    const csvText = await res.text();
    const lines = csvText.trim().split("\n");
    // 30 ft at 10 ft high, two sides → 600 board sq ft; 16" o.c. on 30 ft → 24 studs; track both sides → 60 ft.
    expect(lines).toContain("Walls,P1,1 run,,30,ft,30,10,600,24,60,,,Sheet 1,");
    expect(lines).toContain("Untyped walls,8″ wall,1 run,,10,ft,10,,,,,,,Sheet 1,no type: feet only");
    const leftOut = lines.find((line) => line.startsWith("Left out,"));
    expect(leftOut).toMatch(/^Left out,A601 · DOOR SCHEDULE,1 measurement not exported,.*not a floor plan: A601 is a schedule/);
    // The raw finder group's 80 ft is nowhere in the file.
    expect(csvText).not.toMatch(/\b80\b/);
    expect(lines).toContain("Rooms,OFFICE,101,,100,sq ft,,,,,,100,40,Sheet 1,");
    expect(lines).toContain("Ceilings,GB,1 room,,100,sq ft,,10,,,,100,,Sheet 1,");
    expect(lines).toContain("Areas,ACT ceiling,1 measurement,,200,sq ft,,,,,,200,60,Sheet 1,");
    expect(lines).toContain(`Doors,101,HM,"3'-0"" x 7'-0""",1,ea,,,,,,,,Sheet 1,`);
  });

  it("the PDF has the tables and then the one measured sheet, embedded from the plan file", async () => {
    const res = await call(`?jobId=${jobId}&format=pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    // Only the floor plan gets a sheet page; the schedule sheet does not.
    expect(String(pdf.getPage(1).node.Resources()?.lookup(pdf.context.obj("XObject")))).toMatch(/EmbeddedPdfPage\S* \d+ \d+ R/);
  });
});
