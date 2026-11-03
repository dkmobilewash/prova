import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { deleteTakeoffItem } = await import("./takeoffItems");

let companyId = "", jobId = "", planId = "", pageId = "", pageCalibration = "";
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Delete Co" } })).id;
  context.company.id = companyId;
  const userId = (await prisma.user.create({ data: { companyId, clerkId: `dl_${Date.now()}`, email: `dl_${Date.now()}@example.test`, role: "OWNER" } })).id;
  context.id = userId;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Delete", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x", fileName: "x.pdf" } })).id;
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101" } })).id;
  await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 2592, heightPt: 1728, rotation: 0, renovationMarks: ["(E)", "DEMO"] } as never });
  const calibrationId = (await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } as never })).id;
  pageCalibration = calibrationId;
});
afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffSheetExclusion.deleteMany({ where: { pageId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { pageId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { pageId } });
  await prisma.planSheetText.deleteMany({ where: { planId } });
  await prisma.takeoffPlanPage.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

async function countItemWithMarks() {
  const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "R1 troffer", type: "COUNT", colorHex: "#112233" } });
  await prisma.takeoffMeasurement.create({ data: { itemId: item.id, pageId, calibrationId: pageCalibration, kind: "COUNT", xs: [0.1, 0.2], ys: [0.1, 0.2], label: "R1", createdByUserId: context.id } });
  return item.id;
}

describe("deleting a takeoff item", () => {
  it("takes its measurements with it when asked", async () => {
    const id = await countItemWithMarks();
    expect(await deleteTakeoffItem(jobId, id, true)).toEqual({ ok: true });
    expect(await prisma.takeoffMeasurement.count({ where: { pageId, label: "R1" } })).toBe(0);
  });
  it("leaves them in Unassigned otherwise", async () => {
    const id = await countItemWithMarks();
    expect(await deleteTakeoffItem(jobId, id)).toEqual({ ok: true });
    expect(await prisma.takeoffMeasurement.findMany({ where: { pageId, label: "R1" }, select: { itemId: true } })).toEqual([{ itemId: null }]);
  });
});
