import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { UNTYPED_ITEM } from "@/lib/takeoff/untypedItem";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { sendTakeoffItemsToEstimate } = await import("./takeoffItems");
const { addFinishLinesToEstimate } = await import("./takeoff");
const { setDefaultPartition } = await import("./wallTypes");

let companyId = "", jobId = "", planId = "", pageId = "", calibrationId = "", untypedId = "", typeId = "", typedItem = "", ceilingId = "", userId = "";
const lines = async () => (await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, orderBy: { description: "asc" } })).map((l) => [l.description, Number(l.quantity), l.unit]);

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Decisions Co" } })).id;
  context.company.id = companyId;
  userId = (await prisma.user.create({ data: { companyId, clerkId: `ed_${Date.now()}`, email: `ed_${Date.now()}@example.test`, role: "OWNER" } })).id;
  context.id = userId;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Decisions", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x", fileName: "x.pdf" } })).id;
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1 } })).id;
  // 100 ft across the page width, so 0.5 of a page is 50 ft.
  calibrationId = (await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } as never })).id;
  typeId = (await prisma.wallType.create({ data: { companyId, code: "A", name: "Partition", defaultHeightFt: 10, sides: 2, components: { create: [{ description: "board", unit: "sq ft", basis: "BOARDED_SQFT", factor: 1 }] } } })).id;
  const item = (name: string, type: "LINEAR" | "AREA_WITH_PERIMETER", extra = {}) => prisma.takeoffItem.create({ data: { companyId, jobId, name, type, colorHex: "#112233", ...extra } });
  untypedId = (await item(UNTYPED_ITEM, "LINEAR")).id;
  typedItem = (await item("A walls", "LINEAR", { wallTypeId: typeId, heightFt: 10, sides: 2 })).id;
  ceilingId = (await item("Ceiling — ACT", "AREA_WITH_PERIMETER")).id;
  const line = (itemId: string, openings: unknown[] = []) => ({ itemId, pageId, calibrationId, kind: "LINEAR" as const, xs: [0, 0.5], ys: [0, 0], label: "wall", source: "DETECTED" as const, openings: openings as never, createdByUserId: userId });
  await prisma.takeoffMeasurement.createMany({ data: [
    line(untypedId),
    line(typedItem, [{ widthFt: 3, heightFt: 7 }]),
    { itemId: ceilingId, pageId, calibrationId, kind: "AREA", xs: [0, 0.1, 0.1, 0], ys: [0, 0, 0.1, 0.1], label: "101 ceiling", source: "ROOM_FINDER", ceilingFamily: "ACT", roomNumber: "101", createdByUserId: userId },
    { itemId: ceilingId, pageId, calibrationId, kind: "AREA", xs: [0.2, 0.3, 0.3, 0.2], ys: [0, 0, 0.1, 0.1], label: "102 ceiling", source: "ROOM_FINDER", ceilingFamily: "ACT", roomNumber: "102", createdByUserId: userId },
    { itemId: ceilingId, pageId, calibrationId, kind: "AREA", xs: [0.4, 0.5, 0.5, 0.4], ys: [0, 0, 0.1, 0.1], label: "HALL 1 + OFFICE 2 ceiling", source: "ROOM_FINDER", ceilingFamily: "ACT", createdByUserId: userId },
  ] });
});
afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { pageId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { pageId } });
  await prisma.takeoffPlanPage.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.wallTypeComponent.deleteMany({ where: { wallTypeId: typeId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("Send to estimate", () => {
  it("drops no footage: untyped walls and ceilings arrive unpriced, and a door comes off the board", async () => {
    await sendTakeoffItemsToEstimate(jobId);
    expect(await lines()).toEqual([
      ["A walls — board", 50 * 10 * 2 - 21 * 2, "sq ft"],
      ["Ceiling — ACT", 300, "sq ft"],
      ["Walls — untyped (no type: check)", 50, "lin ft"],
    ]);
  });
  it("prices untyped walls with the default partition, marked as assumed, and clearing it goes back", async () => {
    expect((await setDefaultPartition(typeId)).ok).toBe(true);
    await sendTakeoffItemsToEstimate(jobId);
    expect((await lines()).find((l) => String(l[0]).startsWith("Walls"))).toEqual(["Walls — untyped (assumed type: check) — board", 1000, "sq ft"]);
    expect((await setDefaultPartition(typeId)).ok).toBe(true);
    await sendTakeoffItemsToEstimate(jobId);
    expect((await lines()).find((l) => String(l[0]).startsWith("Walls"))).toEqual(["Walls — untyped (no type: check)", 50, "lin ft"]);
  });
  it("takes a company's own opening rule over the default", async () => {
    await prisma.company.update({ where: { id: companyId }, data: { openingDeduction: "LARGE_ONLY" } });
    await sendTakeoffItemsToEstimate(jobId);
    expect((await lines())[0]).toEqual(["A walls — board", 1000, "sq ft"]);
    await prisma.company.update({ where: { id: companyId }, data: { openingDeduction: null } });
  });
  it("counts a room's ceiling once: the finish line, and the ceiling item only for rooms it does not cover", async () => {
    await addFinishLinesToEstimate(jobId, pageId, "A101", [{ label: "Ceiling ACT-1", quantity: 200, unit: "sq ft" }], ["101", "HALL 1 + OFFICE 2"]);
    const all = await lines();
    expect(all.find((l) => l[0] === "A101 — Ceiling ACT-1")?.[1]).toBe(200);
    expect(all.find((l) => l[0] === "Ceiling — ACT")?.[1]).toBe(100);
  });
});
