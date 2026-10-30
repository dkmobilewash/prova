import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveSymbolCountAcrossSheets } = await import("./symbolCount");

let companyId = "", jobId = "", planId = "";
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Symbols Across Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({ data: { companyId, clerkId: `syma_${Date.now()}`, email: `syma_${Date.now()}@example.test`, role: "OWNER" } });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Across", status: "ESTIMATE" } });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:none.pdf", fileName: "none.pdf" } });
  planId = plan.id;
  // Page 3 has a scale already; page 5 prints one the action may apply; page 7 has nothing.
  const p3 = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 3, label: "E2.01", pageWidthPt: 2592 } });
  await prisma.takeoffScaleCalibration.create({ data: { pageId: p3.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "288", createdByUserId: owner.id } });
  await prisma.planSheetText.create({ data: { planId, pageNumber: 5, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
  await prisma.planSheetScaleReading.create({ data: { planId, pageNumber: 5, scaleName: '1/8" = 1\'-0"', x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "288", source: "CAPTION" } });
});
afterAll(async () => {
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { planId } });
  await prisma.planSheetScaleReading.deleteMany({ where: { planId } });
  await prisma.planSheetText.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("saveSymbolCountAcrossSheets", () => {
  it("saves on a calibrated sheet, applies the printed scale to one that prints it, and reports the one that has neither", async () => {
    const result = await saveSymbolCountAcrossSheets(jobId, planId, {
      label: "2x4 troffer",
      sheets: [
        { pageNumber: 3, xs: [0.2, 0.3], ys: [0.4, 0.4] },
        { pageNumber: 5, xs: [0.5, 0.6, 0.7], ys: [0.1, 0.1, 0.1] },
        { pageNumber: 7, xs: [0.9], ys: [0.9] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.saved.map((s) => [s.pageNumber, s.count])).toEqual([[3, 2], [5, 3]]);
    expect(result.value.total).toBe(5);
    expect(result.value.skipped).toHaveLength(1);
    expect(result.value.skipped[0]!.pageNumber).toBe(7);
    expect(result.value.skipped[0]!.why).toMatch(/no scale/);
    const rows = await prisma.takeoffMeasurement.findMany({ where: { page: { planId } }, include: { page: true } });
    expect(rows.map((r) => r.page.pageNumber).sort()).toEqual([3, 5]);
    expect(rows.every((r) => r.kind === "COUNT" && r.label === "2x4 troffer")).toBe(true);
    // Page 5 now has the calibration the printed scale gave it; page 7 still has no row at all.
    expect(await prisma.takeoffScaleCalibration.count({ where: { page: { planId, pageNumber: 5 } } })).toBe(1);
    expect(await prisma.takeoffPlanPage.count({ where: { planId, pageNumber: 7 } })).toBe(0);
  });
  it("refuses an empty label, a foreign item and an empty set", async () => {
    expect((await saveSymbolCountAcrossSheets(jobId, planId, { label: " ", sheets: [{ pageNumber: 3, xs: [0.1], ys: [0.1] }] })).ok).toBe(false);
    expect((await saveSymbolCountAcrossSheets(jobId, planId, { label: "x", itemId: "nope", sheets: [{ pageNumber: 3, xs: [0.1], ys: [0.1] }] })).ok).toBe(false);
    expect((await saveSymbolCountAcrossSheets(jobId, planId, { label: "x", sheets: [] })).ok).toBe(false);
  });
});
