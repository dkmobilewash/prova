import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveSymbolCountAcrossSheets } = await import("./symbolCount");
const { sendTakeoffItemsToEstimate } = await import("./takeoffItems");

let companyId = "", jobId = "", planId = "";
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Count Lines Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `cl_${Date.now()}`, email: `cl_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Count Lines", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x", fileName: "x.pdf" } })).id;
});
afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffPlanPage.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

const line = () => prisma.jobLineItem.findFirst({ where: { jobId, isDeleted: false, takeoffItem: { name: "ZZ Troffer" } } });
describe("a count sent to the estimate", () => {
  it("arrives as a line with no assembly, and one send later it moves rather than repeats", async () => {
    const pages = [{ pageNumber: 1, xs: [0.1, 0.2], ys: [0.1, 0.2] }, { pageNumber: 2, xs: [0.3], ys: [0.3] }];
    expect((await saveSymbolCountAcrossSheets(jobId, planId, { label: "ZZ Troffer", sheets: pages })).ok).toBe(true);
    const sent = await sendTakeoffItemsToEstimate(jobId);
    expect(sent.ok && sent.value.unpriced).toEqual([]);
    expect(await line()).toMatchObject({ description: "ZZ Troffer", unit: "ea" });
    expect(Number((await line())?.quantity)).toBe(3);
    await saveSymbolCountAcrossSheets(jobId, planId, { label: "ZZ Troffer", sheets: [{ pageNumber: 3, xs: [0.4], ys: [0.4] }] });
    await sendTakeoffItemsToEstimate(jobId);
    expect(Number((await line())?.quantity)).toBe(4);
    expect(await prisma.jobLineItem.count({ where: { jobId, isDeleted: false } })).toBe(1);
  });
  it("leaves out what was already posted by hand", async () => {
    await prisma.takeoffMeasurement.updateMany({ where: { item: { jobId, name: "ZZ Troffer" } }, data: { postedAt: new Date() } });
    await sendTakeoffItemsToEstimate(jobId);
    expect(await line()).toBeNull();
  });
});
