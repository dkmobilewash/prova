import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

// Undo of a one-press scale deletes that calibration — and never one a measurement already uses,
// because a measurement cascades with its calibration and a quantity must not vanish on an Undo.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { undoSheetScale } = await import("./takeoff");

let companyId = "", jobId = "", planId = "", pageId = "";
const calibration = () => prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.1, declaredDistanceFeet: 73.5, createdByUserId: context.id } });
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Undo Scale Test Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `usc_${Date.now()}`, email: `usc_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Scale", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:none.pdf", fileName: "none.pdf" } })).id;
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 46 } })).id;
});
afterAll(async () => {
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("Undo of a scale saved in one press", () => {
  it("deletes that calibration while nothing is measured with it", async () => {
    const c = await calibration();
    expect(await undoSheetScale(jobId, planId, c.id)).toEqual({ ok: true });
    expect(await prisma.takeoffScaleCalibration.count({ where: { id: c.id } })).toBe(0);
  });

  it("REFUSES once a measurement uses it, and the measurement survives", async () => {
    const c = await calibration();
    const m = await prisma.takeoffMeasurement.create({ data: { pageId, calibrationId: c.id, kind: "LINEAR", xs: [0.1, 0.2], ys: [0.1, 0.1] } });
    expect(await undoSheetScale(jobId, planId, c.id)).toMatchObject({ ok: false });
    expect(await prisma.takeoffScaleCalibration.count({ where: { id: c.id } })).toBe(1);
    expect(await prisma.takeoffMeasurement.count({ where: { id: m.id } })).toBe(1);
  });

  it("touches nothing on another job's plan", async () => {
    const c = await calibration();
    const otherJob = (await prisma.job.create({ data: { companyId, contactId: (await prisma.contact.findFirstOrThrow({ where: { companyId } })).id, name: "Other", status: "ESTIMATE" } })).id;
    expect(await undoSheetScale(otherJob, planId, c.id)).toMatchObject({ ok: false });
    expect(await prisma.takeoffScaleCalibration.count({ where: { id: c.id } })).toBe(1);
    await prisma.job.delete({ where: { id: otherJob } });
  });
});
