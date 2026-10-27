import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { PDFDocument } from "pdf-lib";

/**
 * The takeoff summary download on a scratch database: the switch, then one
 * job's walls, room, area and door schedule coming out as CSV and as a PDF
 * with the sheet embedded. The plan is the e2e fixture read the way a dev
 * build reads a local set (`lib/plan-ingest/localPlanFile.ts`).
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
  // 100 ft across the page.
  const calibration = await prisma.takeoffScaleCalibration.create({
    data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" },
  });
  const type = await prisma.wallType.create({
    data: { companyId, code: "P1", name: "Partition", thicknessIn: "6", defaultHeightFt: "10", sides: 2, studSpacingIn: "16" },
  });
  await prisma.takeoffWallProposal.create({
    data: {
      pageId: page.id,
      calibrationId: calibration.id,
      thicknessInches: 6,
      source: "REMAINDER",
      runs: [{ x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.5, thicknessFeet: 0.5 }],
    },
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
      },
      { pageId: page.id, calibrationId: calibration.id, kind: "AREA", xs: [0, 0.2, 0.2, 0], ys: [0, 0, 0.1, 0.1], itemId: item.id },
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
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
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

  it("the CSV carries the wall by its type, the room, the area by item and the door, each with its sheet", async () => {
    const res = await call(`?jobId=${jobId}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/takeoff-summary-Export-Job-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = (await res.text()).trim().split("\n");
    // 30 ft at 10 ft high, two sides → 600 board sq ft; 16" o.c. on 30 ft → 24 studs; track both sides → 60 ft.
    expect(lines).toContain("Walls,P1,,,30,ft,30,10,600,24,60,,,Sheet 1,");
    expect(lines).toContain("Rooms,OFFICE,101,,100,sq ft,,,,,,100,40,Sheet 1,");
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
    expect(String(pdf.getPage(1).node.Resources()?.lookup(pdf.context.obj("XObject")))).toMatch(/EmbeddedPdfPage\S* \d+ \d+ R/);
  });
});
