import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { addSheetExclusion, removeSheetExclusion } = await import("./takeoffExclusions");
const { saveRoomMeasurements } = await import("./roomFinder");

let companyId = "", jobId = "", pageId = "";
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Split Co", roomFinderOn: true } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `sp_${Date.now()}`, email: `sp_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Split", status: "ESTIMATE" } })).id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x", fileName: "x.pdf" } });
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } })).id;
  await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } as never });
});
afterAll(async () => {
  await prisma.takeoffMeasurement.deleteMany({ where: { pageId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffSheetExclusion.deleteMany({ where: { pageId } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { pageId } });
  await prisma.takeoffPlanPage.deleteMany({ where: { id: pageId } });
  await prisma.takeoffPlan.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

const room = (xs: number[], ys: number[], number: string) => ({ xs, ys, label: number, roomName: "R", roomNumber: number });
const save = (rooms: unknown[]) => { const form = new FormData(); form.set("pageId", pageId); form.set("rooms", JSON.stringify(rooms)); return saveRoomMeasurements(jobId, form); };

describe("a room split", () => {
  it("saves with the sheet as two points, and goes when removed", async () => {
    const added = await addSheetExclusion(jobId, pageId, "ROOM_SPLIT", [0.1, 0.1], [0, 0.2]);
    expect(added.ok).toBe(true);
    expect(await prisma.takeoffSheetExclusion.count({ where: { pageId, kind: "ROOM_SPLIT" } })).toBe(1);
    expect((await addSheetExclusion(jobId, pageId, "ROOM_SPLIT", [0.1], [0])).ok).toBe(false);
    if (added.ok) await removeSheetExclusion(jobId, pageId, added.value.ids[0]!);
    expect(await prisma.takeoffSheetExclusion.count({ where: { pageId } })).toBe(0);
  });
  it("saving the rooms after a split replaces the sheet's rooms, so a room and its parts are not both counted", async () => {
    expect((await save([room([0, 0.2, 0.2, 0], [0, 0, 0.1, 0.1], "137")])).ok).toBe(true);
    expect((await save([room([0, 0.1, 0.1, 0], [0, 0, 0.1, 0.1], "137"), room([0.1, 0.2, 0.2, 0.1], [0, 0, 0.1, 0.1], "135")])).ok).toBe(true);
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId, source: "ROOM_FINDER" }, select: { roomNumber: true } });
    expect(rows.map((r) => r.roomNumber).sort()).toEqual(["135", "137"]);
  });
});
