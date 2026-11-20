import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * ── ONE UPLOAD, TWO PROJECTS (TAKEOFF_PROJECT_IDENTITY, prereg-project-identity.md) ──
 *
 * "2609 Aldrich Avenue South Suite 10.pdf" bundles Excell Academy's sheets (U+B) with Kurita's (Ryan A+E), and the
 * walls run counted Kurita's A101 with nothing said. With the flag on, nothing is counted until the user says which
 * project they are bidding; then only that project's sheets are candidates. With it off, nothing changes at all.
 * Title blocks invented in the shape of the real ones (no client text in the repository).
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { chooseUploadProject } = await import("./wholeSetTakeoff");
const { uploadProjectQuestion, wallsSheetsFor, wallsTaskPages, wholeSetSummary } = await import("@/lib/plan-ingest/walls");

const CERTIFY = ["WAS PREPARED BY ME OR UNDER MY DIRECT SUPERVISION", "LAWS OF THE STATE OF MINNESOTA"];
const excell = (sheet: string) => ["U+B ARCHITECTURE & DESIGN, INC.", "2609 ALDRICH AVENUE SOUTH SUITE 100", "Excell Academy for Higher Learning", "Project: 2019015_EXC-6", ...CERTIFY, sheet].join("\n");
const kurita = (sheet: string) => ["RYAN A+E, INC.", "533 SOUTH THIRD STREET, SUITE 100", "PROJECT INFORMATION", "KURITA", "PROJECT NO. 905-586", ...CERTIFY, sheet].join("\n");
// page, sheet number, title, title block
const SHEETS: [number, string, string, string][] = [
  [18, "A001", "FLOOR PLAN", excell("A001")],
  [27, "A300", "BUILDING SECTIONS", excell("A300")],
  [66, "A101", "GROUND LEVEL FLOOR PLAN", kurita("A101")],
  [67, "A102", "SECOND LEVEL FLOOR PLAN", kurita("A102")],
];

let planId = "";
const before = process.env.TAKEOFF_PROJECT_IDENTITY;

beforeAll(async () => {
  context.company.id = (await prisma.company.create({ data: { name: `Two projects ${Date.now()}`, wholeSetTakeoffOn: true } })).id;
  const companyId = context.company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Excell Academy", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "https://example.test/aldrich.pdf" } })).id;
  const ingestJobId = (await prisma.planIngestJob.create({ data: { planId, companyId, stage: "PAGE_INVENTORY", pageCount: 95 } })).id;
  for (const [pageNumber, number, title, block] of SHEETS) {
    await prisma.planSheetText.create({ data: { planId, pageNumber, hasTextLayer: true, widthPt: 2592, heightPt: 1728, titleBlockText: block } });
    await prisma.planSheetProposal.create({
      data: { ingestJobId, planId, pageNumber, proposedSheetNumber: number, proposedTitle: title, proposedReason: "read from the title block", proposedConfidence: "HIGH", model: "keyless", promptVersion: "keyless" },
    });
    const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber, pageWidthPt: 2592 } });
    await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.5, declaredDistanceFeet: "72" } });
  }
});

afterAll(async () => {
  process.env.TAKEOFF_PROJECT_IDENTITY = before;
  const companyId = context.company.id;
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("one upload holding two projects", () => {
  it("flag OFF: today's behaviour exactly — no sheet tagged, no question, the run takes both projects' floor plans", async () => {
    delete process.env.TAKEOFF_PROJECT_IDENTITY;
    const sheets = await wallsSheetsFor(planId, context.company.id);
    expect(sheets.some((sheet) => "project" in sheet)).toBe(false);
    expect(await uploadProjectQuestion(planId, context.company.id)).toBeNull();
    expect(wallsTaskPages(sheets)).toEqual([18, 66, 67]);
  });

  it("flag ON, unanswered: nothing is counted, and the question offers both projects with no default", async () => {
    process.env.TAKEOFF_PROJECT_IDENTITY = "1";
    expect(wallsTaskPages(await wallsSheetsFor(planId, context.company.id))).toEqual([]);
    const question = await uploadProjectQuestion(planId, context.company.id);
    expect(question?.groups.map((g) => [g.label, g.pages])).toEqual([["Project 2019015_EXC-6", [18, 27]], ["KURITA", [66, 67]]]);
    expect(question?.chosen).toBeNull();
    expect((await wholeSetSummary(planId, context.company.id, 3)).find((row) => row.pageNumber === 66)?.status).toEqual({ kind: "skipped", why: "waiting to be told which project to take off" });
  });

  it("flag ON, answered: only the chosen project's floor plans run, the other is listed as another project, and the user can switch", async () => {
    process.env.TAKEOFF_PROJECT_IDENTITY = "1";
    expect(await chooseUploadProject(planId, 18)).toEqual({ ok: true });
    expect((await prisma.takeoffPlan.findUniqueOrThrow({ where: { id: planId } })).projectPages).toEqual([18, 27]);
    expect(wallsTaskPages(await wallsSheetsFor(planId, context.company.id))).toEqual([18]);
    expect((await wholeSetSummary(planId, context.company.id, 3)).find((row) => row.pageNumber === 66)?.status).toEqual({ kind: "skipped", why: "another project in this upload" });
    expect((await uploadProjectQuestion(planId, context.company.id))?.chosen).toBe(0);

    expect(await chooseUploadProject(planId, 66)).toEqual({ ok: true });
    expect(wallsTaskPages(await wallsSheetsFor(planId, context.company.id))).toEqual([66, 67]);
  });

  it("refuses a page that is not one of the offered projects, and stores nothing", async () => {
    process.env.TAKEOFF_PROJECT_IDENTITY = "1";
    expect(await chooseUploadProject(planId, 5)).toMatchObject({ ok: false });
    expect((await prisma.takeoffPlan.findUniqueOrThrow({ where: { id: planId } })).projectPages).toEqual([66, 67]);
  });
});
