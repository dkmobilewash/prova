import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { wallItemsForSheet } from "@/lib/plan-ingest/wallItems";
import { DROPPED_ITEM, DROPPED_LABEL, HELD_ITEM, HELD_LABEL, KEPT_LABEL } from "./estimateHold";
import { UNTYPED_ITEM } from "./untypedItem";

/**
 * Chrome round 6, Baker A101: 0 runs to confirm through every Find and every
 * whole-set re-run. Round 5's refresh put each surviving run back on the label
 * it had, so the untyped labels an older bug wrote were kept for good. This is
 * the fresh-job sequence on a scratch database, with detection injected (it
 * needs a plan file): the whole-set write holds what the model doubts, a work
 * area keeps it held, a person's keep and drop survive, and a stale untyped
 * label is read from the model again.
 */
const good = { x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6, thicknessFeet: 0.33 };
const doubtedA = { x1: 0.25, y1: 0.7, x2: 0.45, y2: 0.7, thicknessFeet: 0.33 };
const doubtedB = { x1: 0.6, y1: 0.7, x2: 0.8, y2: 0.7, thicknessFeet: 0.33 };
vi.mock("./detectWallsForCalibration", () => ({
  detectWallsForCalibration: async (t: { onBoundary?: (b: unknown) => void }) => {
    t.onBoundary?.({ pairings: [], segments: [], held: [doubtedA, doubtedB] });
    return "written";
  },
}));
const { refreshSheetWalls } = await import("./refreshSheetWalls");

let companyId = "";
let jobId = "";
let planId = "";
let pageId = "";
let calibrationId = "";
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Refresh Labels Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Refresh Job", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:plan-sheet.pdf" } })).id;
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1 } })).id;
  calibrationId = (await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } })).id;
  await prisma.takeoffWallProposal.create({ data: { pageId, calibrationId, thicknessInches: 4, source: "REMAINDER", runs: [good, doubtedA, doubtedB] } });
});
const refresh = () => refreshSheetWalls({ pageId, calibrationId, planId, companyId, pageNumber: 1, feetPerUnit: 100, wallTypes: [], jobId, userId: null });
const at = (run: { x1: number }) => prisma.takeoffMeasurement.findFirstOrThrow({ where: { pageId, source: "DETECTED", xs: { has: run.x1 } }, select: { id: true, label: true, item: { select: { name: true } } } });
const labels = async () => [(await at(good)).label, (await at(doubtedA)).label, (await at(doubtedB)).label];
const itemId = async (name: string) => (await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, name } })).id;

describe("to confirm survives a work area and a re-find, and stale labels are read again", () => {
  it("a whole-set run holds the two runs the model doubts", async () => {
    await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null, held: [doubtedA, doubtedB] });
    expect(await labels()).toEqual(["wall, untyped", HELD_LABEL, HELD_LABEL]);
  });
  it("a work area (the refresh) keeps both to confirm", async () => {
    expect((await refresh()).kind).toBe("replaced");
    expect(await labels()).toEqual(["wall, untyped", HELD_LABEL, HELD_LABEL]);
    expect((await at(doubtedA)).item?.name).toBe(HELD_ITEM);
  });
  it("A PERSON'S KEEP AND DROP SURVIVE a re-find; the run nobody decided stays the model's", async () => {
    await prisma.takeoffMeasurement.update({ where: { id: (await at(doubtedA)).id }, data: { label: KEPT_LABEL, itemId: await itemId(UNTYPED_ITEM) } });
    const dropped = (await prisma.takeoffItem.create({ data: { companyId, jobId, name: DROPPED_ITEM, type: "LINEAR", colorHex: "#888888" } })).id;
    await prisma.takeoffMeasurement.update({ where: { id: (await at(good)).id }, data: { label: DROPPED_LABEL, itemId: dropped } });
    await refresh();
    expect(await labels()).toEqual([DROPPED_LABEL, KEPT_LABEL, HELD_LABEL]);
    expect([(await at(good)).item?.name, (await at(doubtedA)).item?.name]).toEqual([DROPPED_ITEM, UNTYPED_ITEM]);
  });
  it("A STALE UNTYPED LABEL, as the old refresh wrote it, is read from the model again: to confirm", async () => {
    await prisma.takeoffMeasurement.update({ where: { id: (await at(doubtedB)).id }, data: { label: "wall, untyped", itemId: await itemId(UNTYPED_ITEM) } });
    await refresh();
    expect(await labels()).toEqual([DROPPED_LABEL, KEPT_LABEL, HELD_LABEL]);
    expect((await at(doubtedB)).item?.name).toBe(HELD_ITEM);
  });
});
