import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { sendTakeoffItemsToEstimate } = await import("./takeoffItems");

let companyId = "", jobId = "", planId = "", pageId = "";
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Reno Co" } })).id;
  context.company.id = companyId;
  const userId = (await prisma.user.create({ data: { companyId, clerkId: `rn_${Date.now()}`, email: `rn_${Date.now()}@example.test`, role: "OWNER" } })).id;
  context.id = userId;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Reno", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x", fileName: "x.pdf" } })).id;
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101" } })).id;
  await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 2592, heightPt: 1728, rotation: 0, renovationMarks: ["(E)", "DEMO"] } as never });
  const calibrationId = (await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } as never })).id;
  const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#112233" } });
  await prisma.takeoffMeasurement.create({ data: { itemId: item.id, pageId, calibrationId, kind: "LINEAR", xs: [0, 0.5], ys: [0, 0], label: "wall", createdByUserId: userId } });
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

describe("Send to estimate on a renovation sheet", () => {
  it("sends, and names the sheet when no work area or exclusion was used", async () => {
    const sent = await sendTakeoffItemsToEstimate(jobId);
    expect(sent.ok && sent.value.renovationUnchecked).toEqual(["A101"]);
    expect(sent.ok && sent.value.created).toBeGreaterThan(0);
  });
  it("is quiet once a work area is drawn", async () => {
    await prisma.takeoffSheetExclusion.create({ data: { pageId, kind: "WORK_AREA", xs: [0, 1, 1], ys: [0, 0, 1] } });
    const sent = await sendTakeoffItemsToEstimate(jobId);
    expect(sent.ok && sent.value.renovationUnchecked).toEqual([]);
  });
});
