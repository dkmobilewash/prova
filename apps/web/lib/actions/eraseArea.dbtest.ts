import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * "Erase walls in this area" (coordination/erase-area-tool.md), P3a + P4: the box is stored as an ERASE_AREA exclusion
 * and moves the sheet's walls through the SAME refresh a work area does (E3). No new sync path is added. The
 * refresh itself re-reads the PDF, so it is counted here, not run (Amendment 1); the to-the-cent drop is the production proof.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const refreshes: unknown[] = [];
vi.mock("next/server", async (actual) => ({ ...(await actual<object>()), after: (work: unknown) => void refreshes.push(work) }));
const { addSheetExclusion, removeSheetExclusion, clearSheetExclusions } = await import("./takeoffExclusions");

let companyId = "", jobId = "", pageId = "";
const BOX = { xs: [0.1, 0.4, 0.4, 0.1], ys: [0.1, 0.1, 0.3, 0.3] };
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Erase Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `er_${Date.now()}`, email: `er_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Erase", status: "ESTIMATE" } })).id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x", fileName: "x.pdf" } });
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } })).id;
  await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } as never });
});
afterAll(async () => {
  await prisma.takeoffSheetExclusion.deleteMany({ where: { pageId } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { pageId } });
  await prisma.takeoffPlanPage.deleteMany({ where: { id: pageId } });
  await prisma.takeoffPlan.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("P3a: an erase box is stored and refreshes the sheet like a work area", () => {
  it("stores the four corners as ERASE_AREA and fires one refresh; removing it fires another", async () => {
    refreshes.length = 0;
    const added = await addSheetExclusion(jobId, pageId, "ERASE_AREA", BOX.xs, BOX.ys);
    expect(added.ok).toBe(true);
    const row = await prisma.takeoffSheetExclusion.findFirstOrThrow({ where: { pageId, kind: "ERASE_AREA" }, select: { xs: true, ys: true } });
    expect(row).toEqual(BOX);
    expect(refreshes).toHaveLength(1);
    if (added.ok) await removeSheetExclusion(jobId, pageId, added.value.ids[0]!);
    expect(await prisma.takeoffSheetExclusion.count({ where: { pageId } })).toBe(0);
    expect(refreshes).toHaveLength(2);
  });
  it("Clear erased areas removes every box and nothing else, with one refresh", async () => {
    expect((await addSheetExclusion(jobId, pageId, "ERASE_AREA", BOX.xs, BOX.ys)).ok).toBe(true);
    expect((await addSheetExclusion(jobId, pageId, "ERASE_AREA", BOX.xs.map((x) => x + 0.4), BOX.ys)).ok).toBe(true);
    expect((await addSheetExclusion(jobId, pageId, "WORK_AREA", [0, 1, 1, 0], [0, 0, 1, 1])).ok).toBe(true);
    // Not vacuous: both boxes are there before the clear.
    expect(await prisma.takeoffSheetExclusion.count({ where: { pageId, kind: "ERASE_AREA" } })).toBe(2);
    refreshes.length = 0;
    expect((await clearSheetExclusions(jobId, pageId, "ERASE_AREA")).ok).toBe(true);
    expect(await prisma.takeoffSheetExclusion.findMany({ where: { pageId }, select: { kind: true } })).toEqual([{ kind: "WORK_AREA" }]);
    expect(refreshes).toHaveLength(1);
    await clearSheetExclusions(jobId, pageId, "WORK_AREA");
  });
});

describe("P4: the action refuses a box that is not one", () => {
  it.each([
    ["three corners", [0.1, 0.4, 0.4], [0.1, 0.1, 0.3]],
    ["two points", [0.1, 0.4], [0.1, 0.3]],
    ["a corner off the page", [0.1, 5, 5, 0.1], [0.1, 0.1, 0.3, 0.3]],
    ["mismatched lists", [0.1, 0.4, 0.4, 0.1], [0.1, 0.1, 0.3]],
  ])("%s writes nothing and refreshes nothing", async (_name, xs, ys) => {
    refreshes.length = 0;
    expect((await addSheetExclusion(jobId, pageId, "ERASE_AREA", xs, ys)).ok).toBe(false);
    expect(await prisma.takeoffSheetExclusion.count({ where: { pageId } })).toBe(0);
    expect(refreshes).toHaveLength(0);
  });
});
