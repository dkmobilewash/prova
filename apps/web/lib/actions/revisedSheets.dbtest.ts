import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Applying an addendum's sheets, and Undo, on a real database: A101 issued
 * twice, one wall kept, one gone, one new (the loader's own fixture).
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { applyRevisedSheets } = await import("./revisedSheets");
const { undoSheetSuggestions } = await import("./wallGroupType");
const { loadAddendumChanges } = await import("@/lib/takeoff/addendumChanges");

let companyId = "";
let jobId = "";
let itemId = "";
let oldPageId = "";
let newPageId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Addendum Apply Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `addapply_${Date.now()}`, email: `addapply_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Addendum Apply Job", status: "ESTIMATE" } })).id;
  const cal = { x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" };
  const first = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:bid.pdf", fileName: "bid.pdf", createdAt: new Date(Date.now() - 86_400_000) } });
  const oldA101 = await prisma.takeoffPlanPage.create({ data: { planId: first.id, pageNumber: 3, label: "A101" } });
  oldPageId = oldA101.id;
  const oldCal = await prisma.takeoffScaleCalibration.create({ data: { pageId: oldA101.id, ...cal } });
  const s6a = await prisma.wallType.create({ data: { companyId, code: "S6A", name: "6in stud", sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
  itemId = (await prisma.takeoffItem.create({ data: { companyId, jobId, name: "S6A walls", type: "LINEAR", colorHex: "#111111", wallTypeId: s6a.id, heightFt: "10", sides: 2 } })).id;
  await prisma.takeoffMeasurement.create({ data: { pageId: oldA101.id, calibrationId: oldCal.id, kind: "LINEAR", source: "DETECTED", xs: [0.1, 0.4], ys: [0.2, 0.2], itemId } });
  await prisma.takeoffMeasurement.create({ data: { pageId: oldA101.id, calibrationId: oldCal.id, kind: "LINEAR", source: "DETECTED", xs: [0.1, 0.3], ys: [0.5, 0.5], itemId } });
  const addendum = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:add1.pdf", fileName: "add1.pdf", revisionLabel: "Addendum 1" } });
  const newA101 = await prisma.takeoffPlanPage.create({ data: { planId: addendum.id, pageNumber: 1, label: "A-101" } });
  newPageId = newA101.id;
  const newCal = await prisma.takeoffScaleCalibration.create({ data: { pageId: newA101.id, ...cal } });
  await prisma.takeoffWallProposal.create({ data: { pageId: newA101.id, calibrationId: newCal.id, thicknessInches: 6, source: "REMAINDER", runs: [{ x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.2, thicknessFeet: 0.5 }, { x1: 0.6, y1: 0.7, x2: 0.72, y2: 0.7, thicknessFeet: 0.5 }] } });
});

afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffWallProposal.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { plan: { jobId } } });
  await prisma.takeoffPlan.deleteMany({ where: { jobId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

const where = async (pageId: string) =>
  (await prisma.takeoffMeasurement.findMany({ where: { pageId }, orderBy: { createdAt: "asc" }, select: { item: { select: { name: true } }, label: true } })).map((m) => `${m.item?.name}|${m.label}`);

describe("applyRevisedSheets", () => {
  it("the revised walls go onto their carried types, the new one untyped, the earlier sheet's off the estimate; the lines follow", async () => {
    const result = await applyRevisedSheets(jobId);
    expect(result.ok && { moved: result.value.moved, written: result.value.written, replaced: result.value.replaced }).toEqual({ moved: 0, written: 2, replaced: 2 });
    expect(await where(newPageId)).toEqual(["S6A walls|wall (carried from the earlier sheet)", "Walls — untyped|wall, untyped"]);
    expect(await where(oldPageId)).toEqual(["Walls — dropped|replaced by Addendum 1", "Walls — dropped|replaced by Addendum 1"]);
    // S6A's studs line is the revised 30 ft now, not the earlier 50.
    const line = await prisma.jobLineItem.findFirstOrThrow({ where: { jobId, isDeleted: false, takeoffItemId: itemId }, select: { quantity: true } });
    expect(Math.round(Number(line.quantity))).toBe(30);
    // The page says the sheet was applied, and has nothing left to apply.
    const after = await loadAddendumChanges(companyId, jobId);
    expect(after?.sheets[0]?.status).toBe("applied");
    expect((await applyRevisedSheets(jobId)).ok).toBe(false);

    // Undo: every row back where it was, the written ones gone, the line back to 50 ft.
    if (!result.ok) throw new Error(result.error);
    expect(await undoSheetSuggestions(jobId, result.value.undo)).toEqual({ ok: true });
    expect(await where(newPageId)).toEqual([]);
    expect(await where(oldPageId)).toEqual(["S6A walls|null", "S6A walls|null"]);
    const back = await prisma.jobLineItem.findFirstOrThrow({ where: { jobId, isDeleted: false, takeoffItemId: itemId }, select: { quantity: true } });
    expect(Math.round(Number(back.quantity))).toBe(50);
    expect((await loadAddendumChanges(companyId, jobId))?.sheets[0]?.status).toBe("compared");
  });
});
