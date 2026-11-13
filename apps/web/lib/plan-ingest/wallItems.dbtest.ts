import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { syncTakeoffItemLines } from "@/lib/estimating/takeoff-item-lines";
import { DROPPED_ITEM, DROPPED_LABEL, HELD_ITEM, HELD_LABEL } from "@/lib/takeoff/estimateHold";
import { UNTYPED_ITEM, wallItemsForSheet } from "./wallItems";
/**
 * The whole-set run's walls onto the job by type, on a scratch database: a
 * TAG group naming one of the company's types lands on that type's item, a
 * REMAINDER group on "Walls — untyped", one LINEAR measurement per run,
 * `source: DETECTED`; the gates (no walls, already done) refuse without writing.
 */
let companyId = "";
let jobId = "";
let planId = "";
let pageId = "";
let calibrationId = "";
let typeId = "";
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Walls By Type Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Walls Job", status: "ESTIMATE" } });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:plan-sheet.pdf", fileName: "plan-sheet.pdf" } });
  planId = plan.id;
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1 } });
  pageId = page.id;
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  calibrationId = cal.id;
  const type = await prisma.wallType.create({ data: { companyId, code: "A1", name: "Partition A1", thicknessIn: 6, defaultHeightFt: 10, sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
  typeId = type.id;
});
const ask = () => wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null });
describe("walls on the job by type", () => {
  it("is skipped on a sheet with no walls found", async () => {
    expect(await ask()).toEqual({ kind: "skipped", why: "no walls found" });
  });
  it("SUGGESTS, NEVER POSTS: even a printed tag's group goes on the untyped item, one measurement per run (`postingGate.ts`)", async () => {
    const tagged = [{ x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.2, thicknessFeet: 0.5 }, { x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.4, thicknessFeet: 0.5 }];
    const loose = [{ x1: 0.5, y1: 0.4, x2: 0.2, y2: 0.4, thicknessFeet: 0.5 }];
    // One write, as the stage does it: the groups of one detection share a timestamp.
    await prisma.takeoffWallProposal.createMany({ data: [
      { pageId, calibrationId, thicknessInches: 6, source: "TAG", sourceLabel: "A1", namedCode: "A1", runs: tagged },
      // 4 in thick: no type of the company's is that thick, so nothing names it.
      { pageId, calibrationId, thicknessInches: 4, source: "REMAINDER", runs: loose.map((r) => ({ ...r, thicknessFeet: 4 / 12 })) },
    ] });
    const outcome = await ask();
    expect(outcome.kind, JSON.stringify(outcome)).toBe("written");
    if (outcome.kind !== "written") return;
    expect(Math.round(outcome.typedFeet)).toBe(0);
    expect(Math.round(outcome.untypedFeet)).toBe(80);
    expect(outcome.byType).toEqual([]);
    const items = await prisma.takeoffItem.findMany({ where: { jobId }, select: { name: true, wallTypeId: true, type: true, heightFt: true } });
    expect(items.map((i) => [i.name, i.wallTypeId, i.type, i.heightFt === null ? null : Number(i.heightFt)])).toEqual([[UNTYPED_ITEM, null, "LINEAR", null]]);
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId, source: "DETECTED" }, include: { item: true } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === "LINEAR" && r.item?.name === UNTYPED_ITEM && r.label === "wall, untyped")).toBe(true);
    // The company HAS A1, with parts; the tag still only suggests it.
    expect(await prisma.takeoffItem.count({ where: { jobId, wallTypeId: typeId } })).toBe(0);
  });
  it("never writes twice", async () => {
    expect(await ask()).toEqual({ kind: "skipped", why: "walls already on the job" });
    expect(await prisma.takeoffMeasurement.count({ where: { pageId, source: "DETECTED" } })).toBe(3);
  });
  it("HOLDS A DOUBTED RUN OFF THE ESTIMATE: drawn on its own item, and the sync writes no line for it", async () => {
    await prisma.takeoffMeasurement.deleteMany({ where: { pageId } });
    await prisma.takeoffWallProposal.deleteMany({ where: { pageId } });
    const good = { x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6, thicknessFeet: 0.33 };
    const doubted = { x1: 0.2, y1: 0.7, x2: 0.4, y2: 0.7, thicknessFeet: 0.33 };
    await prisma.takeoffWallProposal.create({ data: { pageId, calibrationId, thicknessInches: 4, source: "REMAINDER", runs: [good, doubted] } });
    const outcome = await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null, held: [doubted] });
    expect(outcome.kind).toBe("written");
    if (outcome.kind !== "written") return;
    expect(outcome.heldFeet).toBeGreaterThan(0);
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId }, select: { label: true, item: { select: { name: true } } } });
    expect(rows.map((r) => [r.label, r.item?.name]).sort()).toEqual([[HELD_LABEL, HELD_ITEM], ["wall, untyped", UNTYPED_ITEM]]);
    const summary = await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId));
    // Not a line, and not an "unpriced" warning either: nothing is wrong with it yet.
    expect(summary.unpriced.map((u) => u.name)).not.toContain(HELD_ITEM);
    const held = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, name: HELD_ITEM } });
    const untyped = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, name: UNTYPED_ITEM } });
    expect(await prisma.jobLineItem.count({ where: { jobId, takeoffItemId: held.id } })).toBe(0);
    expect(await prisma.jobLineItem.count({ where: { jobId, takeoffItemId: untyped.id } })).toBeGreaterThan(0);
  });
  it("A DROPPED WALL LEAVES THE ESTIMATE too, and is not reported unpriced", async () => {
    const untyped = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, name: UNTYPED_ITEM } });
    const one = await prisma.takeoffMeasurement.findFirstOrThrow({ where: { pageId, itemId: untyped.id } });
    const dropped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: DROPPED_ITEM, type: "LINEAR", colorHex: "#999999" } });
    await prisma.takeoffMeasurement.update({ where: { id: one.id }, data: { itemId: dropped.id, label: DROPPED_LABEL } });
    const summary = await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId));
    expect(summary.unpriced.map((u) => u.name)).not.toContain(DROPPED_ITEM);
    expect(await prisma.jobLineItem.count({ where: { jobId, takeoffItemId: dropped.id } })).toBe(0);
  });
  it("A PLAIN TAG (B) AND A FAMILY'S VARIANT (B6 of B) both wait on \"Walls — untyped\" for a person (`postingGate.ts`)", async () => {
    await prisma.takeoffMeasurement.deleteMany({ where: { pageId } });
    await prisma.takeoffWallProposal.deleteMany({ where: { pageId } });
    await prisma.wallType.create({ data: { companyId, code: "B", name: "Partition B", thicknessIn: 8, defaultHeightFt: 10, sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
    const run = (y: number) => ({ x1: 0.2, y1: y, x2: 0.5, y2: y, thicknessFeet: 8 / 12 });
    await prisma.takeoffWallProposal.createMany({ data: [
      { pageId, calibrationId, thicknessInches: 8, source: "TAG", sourceLabel: "B", namedCode: "B", runs: [run(0.8)] },
      { pageId, calibrationId, thicknessInches: 8, source: "TAG", sourceLabel: "B6", namedCode: "B6", runs: [run(0.9)] },
    ] });
    const outcome = await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null });
    expect(outcome.kind).toBe("written");
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId }, select: { label: true, item: { select: { name: true, wallTypeId: true } } } });
    expect(rows.map((r) => [r.label, r.item?.name, r.item?.wallTypeId])).toEqual([["wall, untyped", UNTYPED_ITEM, null], ["wall, untyped", UNTYPED_ITEM, null]]);
  });
});

describe("the wall model's score rides onto each posted wall (METHOD v2, part 1)", () => {
  it("stores a run's score as its `confidence`, and null where the run has none or it is not a probability", async () => {
    const page2 = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 2 } });
    const cal2 = await prisma.takeoffScaleCalibration.create({ data: { pageId: page2.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
    const scored = { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.1, thicknessFeet: 0.33, modelScore: 0.83 };
    const unscored = { x1: 0.1, y1: 0.3, x2: 0.4, y2: 0.3, thicknessFeet: 0.33 };
    await prisma.takeoffWallProposal.create({ data: { pageId: page2.id, calibrationId: cal2.id, thicknessInches: 4, source: "REMAINDER", runs: [scored, unscored] } });
    const outcome = await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 2, userId: null });
    expect(outcome.kind).toBe("written");
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId: page2.id, source: "DETECTED" }, select: { ys: true, confidence: true } });
    expect(rows.map((r) => [r.ys[0], r.confidence]).sort()).toEqual([[0.1, 0.83], [0.3, null]]);
  });
});
