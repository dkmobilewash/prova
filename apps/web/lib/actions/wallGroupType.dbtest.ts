import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { legendProposalFrom } from "@/lib/takeoff/legendProposalBuild";

// "Set type": a person names an untyped group from the set's legend, and the
// choice is saved with the job, priced, and carried to the next sheet.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { setWallGroupType } = await import("./wallGroupType");
const { wallItemsForSheet, UNTYPED_ITEM } = await import("@/lib/plan-ingest/wallItems");

let companyId = "";
let jobId = "";
let planId = "";
const runs = [{ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.1 }, { x1: 0.4, y1: 0.1, x2: 0.4, y2: 0.3 }];

async function sheet(pageNumber: number, rows: typeof runs) {
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  await prisma.takeoffWallProposal.create({ data: { pageId: page.id, calibrationId: cal.id, thicknessInches: 7, source: "REMAINDER", runs: rows.map((r) => ({ ...r, thicknessFeet: 7 / 12 })) } });
  return page.id;
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Set Type Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `settype_${Date.now()}`, email: `settype_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Set Type Job", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
  const run = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 9 } });
  const read = { types: [{ code: "C", name: "Partition C", lines: ['3 5/8" METAL STUDS @ 16" O.C.', '5/8" GYP. BD. EACH SIDE'] }], uno: [], reason: "r", confidence: "HIGH" as const };
  await prisma.planLegendProposal.create({ data: { ingestJobId: run.id, planId, pageNumber: 9, ...legendProposalFrom({ pageNumber: 9, sheetTitle: null, model: "m", read, crops: [] }) } });
});

describe("Set type", () => {
  it("moves the group's posted untyped runs onto the type's item, adding the type from the legend", async () => {
    const pageId = await sheet(1, runs);
    expect((await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null })).kind).toBe("written");
    const result = await setWallGroupType(jobId, { planId, pageNumber: 1, code: "c", inches: 7, runs });
    expect(result).toEqual({ ok: true });
    const type = await prisma.wallType.findFirst({ where: { companyId, code: "C" }, select: { id: true, _count: { select: { components: true } } } });
    expect(type?._count.components).toBeGreaterThan(0);
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId }, include: { item: true } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.item?.wallTypeId === type?.id && r.label === "C wall (set by hand)")).toBe(true);
    expect(await prisma.takeoffItem.count({ where: { jobId, name: UNTYPED_ITEM, measurements: { some: {} } } })).toBe(0);
  });

  it("is remembered for the job: the next sheet's group that thick posts as the type", async () => {
    const pageId = await sheet(2, [{ x1: 0.5, y1: 0.5, x2: 0.8, y2: 0.5 }]);
    const item = await prisma.takeoffItem.findFirst({ where: { jobId, wallType: { code: "C" } }, select: { id: true, thicknessIn: true } });
    expect(Number(item?.thicknessIn)).toBe(7);
    // Detection matches the group to the item by thickness (`matchGroupToItem`).
    await prisma.takeoffWallProposal.updateMany({ where: { pageId }, data: { itemId: item!.id } });
    await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 2, userId: null });
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId }, select: { itemId: true, label: true } });
    expect(rows).toEqual([{ itemId: item!.id, label: "C wall (set for this job)" }]);
  });

  it("writes the runs when nothing was posted yet, and refuses a code the legend lacks", async () => {
    const pageId = await sheet(3, [{ x1: 0.2, y1: 0.7, x2: 0.6, y2: 0.7 }]);
    expect(await setWallGroupType(jobId, { planId, pageNumber: 3, code: "C", inches: 7, runs: [{ x1: 0.2, y1: 0.7, x2: 0.6, y2: 0.7 }] })).toEqual({ ok: true });
    expect(await prisma.takeoffMeasurement.count({ where: { pageId, item: { wallType: { code: "C" } } } })).toBe(1);
    const refused = await setWallGroupType(jobId, { planId, pageNumber: 3, code: "Q9", inches: 7, runs });
    expect(refused.ok).toBe(false);
  });
});
