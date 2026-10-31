import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveDemoTakeoff } = await import("./demoTakeoff");

let companyId = "", jobId = "", pageId = "", bareId = "", planId = "";
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Demo Takeoff Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({ data: { companyId, clerkId: `demo_${Date.now()}`, email: `demo_${Date.now()}@example.test` } });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Demo", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:none.pdf", fileName: "none.pdf" } })).id;
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, pageWidthPt: 2592 } })).id;
  bareId = (await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 2, pageWidthPt: 2592 } })).id;
  await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "288", createdByUserId: owner.id } });
});
afterAll(async () => {
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffPlanPage.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("saveDemoTakeoff", () => {
  const input = { walls: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.1, tag: "W1" }, { x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.2 }], doors: [{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.3 }] };
  it("refuses a sheet with no scale, because a wall has a length", async () => {
    expect(await saveDemoTakeoff(jobId, bareId, input)).toEqual({ ok: false, error: "Set the scale on this sheet before measuring it." });
  });
  it("saves its own two items, named by type, and refuses a second save", async () => {
    const result = await saveDemoTakeoff(jobId, pageId, input);
    expect(result).toEqual({ ok: true, value: { walls: 2, doors: 2 } });
    const items = await prisma.takeoffItem.findMany({ where: { jobId }, include: { measurements: true }, orderBy: { name: "asc" } });
    expect(items.map((i) => [i.name, i.type, i.measurements.length])).toEqual([["Demo doors", "COUNT", 1], ["Demo walls", "LINEAR", 2]]);
    expect(items[1].measurements.map((m) => m.label).sort()).toEqual(["Demo wall", "Demo wall W1"]);
    expect(items[0].measurements[0].xs).toHaveLength(2);
    const again = await saveDemoTakeoff(jobId, pageId, input);
    expect(again.ok).toBe(false);
    expect(await prisma.takeoffItem.count({ where: { jobId } })).toBe(2);
  });
});
