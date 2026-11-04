import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { syncTakeoffItemLines } from "@/lib/estimating/takeoff-item-lines";
import { DROPPED_ITEM, HELD_ITEM, HELD_LABEL, KEPT_LABEL } from "@/lib/takeoff/estimateHold";
import { UNTYPED_ITEM } from "@/lib/takeoff/untypedItem";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { confirmHeldWall, reviewWall } = await import("./takeoff");

/**
 * Chrome round 5: "It is a wall" on A101 put every floor, base, finish and
 * ceiling line on an estimate nobody had sent (0 → 11 lines). A review
 * decision moves one run: nothing on an unsent estimate, and on a sent one
 * only the lines of the items the run left and joined.
 */
let companyId = "";
let jobId = "";
let pageId = "";
let calibrationId = "";
let heldId = "";
let countId = "";
const held: string[] = [];

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Review Scope Co" } });
  companyId = company.id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { clerkId: `user_scope_${Date.now()}`, email: `scope-${Date.now()}@example.test`, companyId } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Review Scope Job", status: "ESTIMATE" } })).id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x", fileName: "x.pdf" } });
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, finishTakeoff: { lines: [{ description: "A101 — Floor CPT-1", quantity: 500, unit: "sq ft" }], ceilingRooms: [] } } })).id;
  calibrationId = (await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } })).id;
  const item = (name: string, type: "LINEAR" | "COUNT") => prisma.takeoffItem.create({ data: { companyId, jobId, name, type, colorHex: "#888888" } });
  heldId = (await item(HELD_ITEM, "LINEAR")).id;
  const untyped = (await item(UNTYPED_ITEM, "LINEAR")).id;
  countId = (await item("R1 troffer", "COUNT")).id;
  const wall = (itemId: string, y: number, label: string) =>
    prisma.takeoffMeasurement.create({ data: { pageId, calibrationId, kind: "LINEAR", xs: [0.1, 0.3], ys: [y, y], label, source: "DETECTED", itemId } });
  await wall(untyped, 0.1, "wall, untyped");
  for (const y of [0.2, 0.3]) held.push((await wall(heldId, y, HELD_LABEL)).id);
  await prisma.takeoffMeasurement.create({ data: { pageId, calibrationId, kind: "COUNT", xs: [0.5], ys: [0.5], label: "R1", source: "MANUAL", itemId: countId } });
});

afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { pageId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { pageId } });
  await prisma.takeoffPlanPage.deleteMany({ where: { id: pageId } });
  await prisma.takeoffPlan.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

const lines = async () =>
  (await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, orderBy: { description: "asc" } })).map((l) => [l.description, Number(l.quantity)]);

describe("a review decision moves one run", () => {
  it("ON AN ESTIMATE NOBODY SENT, 'It is a wall' moves the run and writes no line at all", async () => {
    expect(await confirmHeldWall(jobId, held[0]!)).toEqual({ ok: true });
    expect(await lines()).toEqual([]);
    const moved = await prisma.takeoffMeasurement.findUniqueOrThrow({ where: { id: held[0]! }, include: { item: true } });
    expect([moved.label, moved.item?.name]).toEqual([KEPT_LABEL, UNTYPED_ITEM]);
  });
  it("ON A SENT ONE, only the walls' line moves: the finish and count lines stay as they were sent", async () => {
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId));
    const sent = await lines();
    expect(sent).toEqual([["A101 — Floor CPT-1", 500], ["R1 troffer", 1], [`${UNTYPED_ITEM} (no type: check)`, 40]]);
    // Changed since the send, and not this decision's to post.
    await prisma.takeoffMeasurement.create({ data: { pageId, calibrationId, kind: "COUNT", xs: [0.6], ys: [0.6], label: "R1", source: "MANUAL", itemId: countId } });
    await prisma.takeoffPlanPage.update({ where: { id: pageId }, data: { finishTakeoff: { lines: [{ description: "A101 — Floor CPT-1", quantity: 900, unit: "sq ft" }], ceilingRooms: [] } } });
    expect(await confirmHeldWall(jobId, held[1]!)).toEqual({ ok: true });
    expect(await lines()).toEqual([["A101 — Floor CPT-1", 500], ["R1 troffer", 1], [`${UNTYPED_ITEM} (no type: check)`, 60]]);
  });
  it("A DROP puts the run on 'Walls — dropped' and takes only its feet off the walls' line", async () => {
    const saved = await reviewWall(jobId, held[1]!, "drop");
    expect(saved.ok).toBe(true);
    const dropped = await prisma.takeoffMeasurement.findUniqueOrThrow({ where: { id: held[1]! }, include: { item: true } });
    expect(dropped.item?.name).toBe(DROPPED_ITEM);
    expect(await lines()).toEqual([["A101 — Floor CPT-1", 500], ["R1 troffer", 1], [`${UNTYPED_ITEM} (no type: check)`, 40]]);
    if (!saved.ok) return;
    expect(await reviewWall(jobId, held[1]!, "restore", saved.value)).toMatchObject({ ok: true });
    expect(await lines()).toEqual([["A101 — Floor CPT-1", 500], ["R1 troffer", 1], [`${UNTYPED_ITEM} (no type: check)`, 60]]);
  });
});
