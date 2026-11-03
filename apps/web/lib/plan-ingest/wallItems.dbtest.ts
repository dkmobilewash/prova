import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { syncTakeoffItemLines } from "@/lib/estimating/takeoff-item-lines";
import { HELD_ITEM, HELD_LABEL } from "@/lib/takeoff/estimateHold";
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
  it("WRITES A TAGGED GROUP ON ITS TYPE'S ITEM and the rest on the untyped item, one measurement per run", async () => {
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
    expect(Math.round(outcome.typedFeet)).toBe(50);
    expect(Math.round(outcome.untypedFeet)).toBe(30);
    expect(outcome.byType).toEqual([{ code: "A1", feet: expect.closeTo(50, 6) }]);
    const items = await prisma.takeoffItem.findMany({ where: { jobId }, select: { name: true, wallTypeId: true, type: true, heightFt: true } });
    expect(items.map((i) => [i.name, i.wallTypeId, i.type, i.heightFt === null ? null : Number(i.heightFt)]).sort()).toEqual([["A1 walls", typeId, "LINEAR", 10], [UNTYPED_ITEM, null, "LINEAR", null]]);
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId, source: "DETECTED" }, include: { item: true } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === "LINEAR")).toBe(true);
    expect(rows.filter((r) => r.item?.name === "A1 walls")).toHaveLength(2);
    expect(rows.filter((r) => r.item?.name === UNTYPED_ITEM).map((r) => r.label)).toEqual(["wall, untyped"]);
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
});
