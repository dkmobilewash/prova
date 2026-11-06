import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

// A group on a plan captioned for one building part takes that part's height, pre-filled with its source.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { loadReviewQueue } = await import("./reviewQueueQuery");
const { wallItemsForSheet } = await import("@/lib/plan-ingest/wallItems");
const { PLAN_CAPTIONS } = await import("./levelReads");

let companyId = "", jobId = "", planId = "";
const runs = [{ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.1 }, { x1: 0.4, y1: 0.1, x2: 0.4, y2: 0.3 }];
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Building Heights Co" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Bunkie-shaped", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
  await prisma.wallType.create({
    data: {
      companyId, code: "EXT", name: "Exterior", thicknessIn: "8.00", sides: 2,
      notes: ["Height option 10 ft: A311 T.O. WALL 10' - 0\"", "Height option 14.333 ft: A313 T.O. WALL 2 14' - 4\"", "Height for ADDITION 10 ft: A311 T.O. WALL 10' - 0\"", "Height for WAREHOUSE 14.333 ft: A313 T.O. WALL 2 14' - 4\""].join("\n"),
    },
  });
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 31 } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  await prisma.takeoffWallProposal.create({ data: { pageId: page.id, calibrationId: cal.id, thicknessInches: 8, source: "REMAINDER", runs: runs.map((r) => ({ ...r, thicknessFeet: 8 / 12 })) } });
  await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 31, kind: PLAN_CAPTIONS, value: { captions: [{ name: "FLOOR PLAN - INVESTIGATIVE SERVICES ADDITION", captionX: 0.1, captionY: 0.5 }], buildings: ["ADDITION"] } } });
  expect((await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 31, userId: null })).kind).toBe("written");
});
afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("a wall group takes its plan's building part's height", () => {
  it("pre-fills ADDITION's 10'-0\" for the group on the ADDITION plan, not the warehouses' 14'-4\"", async () => {
    const types = (await loadReviewQueue(companyId, jobId)).items.filter((i) => i.kind === "type");
    expect(types).toHaveLength(1);
    const item = types[0]!;
    expect(item.kind === "type" && item.building?.name).toBe("ADDITION");
    expect(item.kind === "type" && item.building?.heights.EXT).toEqual({ feet: 10, from: "legend EXT, ADDITION: A311 T.O. WALL 10' - 0\" → 10'-0\"" });
  });

  it("pre-fills nothing by building where the sheet names none", async () => {
    await prisma.takeoffPlanTextRead.deleteMany({ where: { planId, kind: PLAN_CAPTIONS } });
    const item = (await loadReviewQueue(companyId, jobId)).items.find((i) => i.kind === "type");
    expect(item?.kind === "type" && item.building).toBeUndefined();
  });
});
