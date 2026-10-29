import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
/**
 * ── THE SAME FLOOR IS NEVER ADDED TO THE ESTIMATE TWICE ──
 * Baker EOC, 2026-10-29: A100 (overall floor plan) and A101 (floor plan)
 * posted together put one floor on the estimate twice. Two measurements
 * from sheets that show one level are refused with both names; a post from
 * one sheet goes through and its run says which sheet fed it.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { postTakeoffMeasurements } = await import("./takeoff");
let companyId = "";
let jobId = "";
const measurementByPage: Record<number, string> = {};
let wallTypeId = "";
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "One Level Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({ data: { companyId, clerkId: `onelevel_${Date.now()}`, email: `onelevel_${Date.now()}@example.test`, role: "OWNER" } });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "One Level Job", status: "ESTIMATE" } });
  jobId = job.id;
  const wallType = await prisma.wallType.create({ data: { companyId, code: "P1", name: "Partition", defaultHeightFt: 10, components: { create: [{ description: "GWB", basis: "FACE_SQFT", factor: 2 }] } } as never });
  wallTypeId = wallType.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:plan-sheet.pdf", fileName: "plan-sheet.pdf" } });
  const inventory = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId, stage: "PAGE_INVENTORY", pageCount: 3, finishedAt: new Date() } });
  const titles: Record<number, [string, string]> = { 1: ["A100", "OVERALL FLOOR PLAN"], 2: ["A101", "FLOOR PLAN"], 3: ["A102", "LEVEL 2 FLOOR PLAN"] };
  for (const n of [1, 2, 3]) {
    await prisma.planSheetText.create({ data: { planId: plan.id, pageNumber: n, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
    await prisma.planSheetProposal.create({
      data: { ingestJobId: inventory.id, planId: plan.id, pageNumber: n, proposedSheetNumber: titles[n][0], proposedTitle: titles[n][1], proposedPageType: "PLAN", proposedReason: "test", proposedConfidence: "HIGH", model: "test", promptVersion: "test", status: "ACCEPTED", acceptedSheetNumber: titles[n][0], acceptedTitle: titles[n][1] },
    });
    const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: n } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
    const m = await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [0.1, 0.5], ys: [0.5, 0.5], label: `run p${n}` } });
    measurementByPage[n] = m.id;
  }
});
const post = (pages: number[]) => {
  const form = new FormData();
  for (const n of pages) form.append("measurementId", measurementByPage[n]);
  form.set("recipe", "wall");
  form.set("wallTypeId", wallTypeId);
  form.set("label", "Pilot walls");
  return postTakeoffMeasurements(jobId, form);
};
describe("posting measurements from more than one sheet", () => {
  it("REFUSES two sheets that show the same floor, naming both, and adds nothing", async () => {
    const result = await post([1, 2]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("A100");
    expect(result.error).toContain("A101");
    expect(await prisma.wallRun.count({ where: { jobId } })).toBe(0);
  });
  it("accepts two different levels, and the run names the sheets that fed it", async () => {
    const result = await post([1, 3]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const run = await prisma.wallRun.findFirst({ where: { jobId }, orderBy: { createdAt: "desc" } });
    expect(run?.label).toBe("Pilot walls — from A100, A102");
    expect(Number(run?.lengthFt)).toBe(80);
  });
});
