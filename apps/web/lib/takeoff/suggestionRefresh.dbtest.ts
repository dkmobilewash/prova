import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { legendProposalFrom } from "@/lib/takeoff/legendProposalBuild";
import { wallItemsForSheet } from "@/lib/plan-ingest/wallItems";
import { storeGeneralHeight } from "./levelReads";
import { stampSuggestions, SUGGESTIONS_READ } from "./suggestionStamp";

/**
 * Chrome on Baker, 2026-11-06: takeoff ran, the legend read finished after it,
 * and the queue kept untyped groups and "Ceiling 10'-0"" until Run takeoff was
 * pressed again. Here: a run, a person's confirmed group, then the legend lands
 * and the refresh works the sheet out again — the group shows the legend's type
 * and the sheet-wide 15'-0", without a re-run and without moving what was
 * confirmed. Detection and the set's height read need a plan file, so they are
 * injected: detection writes what a legend-aware run writes (a TAG proposal and
 * its stamp), the height read stores what Baker's general note gives.
 */
const runs = [{ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.1 }, { x1: 0.4, y1: 0.1, x2: 0.4, y2: 0.3 }];
const confirmedRun = { x1: 0.6, y1: 0.5, x2: 0.9, y2: 0.5 };
const detectCalls: { noModel?: boolean; pairWithThicknesses?: boolean; pageNumber: number }[] = [];
const windowCalls: number[] = [];
vi.mock("./detectWallsForCalibration", () => ({
  detectWallsForCalibration: async (t: { pageId: string; calibrationId: string; planId: string; pageNumber: number; noModel?: boolean; pairWithThicknesses?: boolean }) => {
    detectCalls.push({ noModel: t.noModel, pairWithThicknesses: t.pairWithThicknesses, pageNumber: t.pageNumber });
    const readAt = new Date();
    await prisma.takeoffWallProposal.createMany({
      data: [{ pageId: t.pageId, calibrationId: t.calibrationId, thicknessInches: 7, source: "TAG", sourceLabel: "S6A", namedCode: "S6A", runs: runs.map((r) => ({ ...r, thicknessFeet: 7 / 12 })) }],
    });
    await stampSuggestions(t.planId, t.pageNumber, readAt);
    return "written";
  },
}));
vi.mock("./legendHeights", () => ({
  legendHeightsFor: async (input: { planId: string }) => {
    await storeGeneralHeight(input.planId, { feet: 15, from: "general note A601: all walls to deck" });
    return new Map();
  },
}));
vi.mock("@/lib/plan-ingest/rooms", () => ({
  windowsForSheet: async (input: { pageNumber: number }) => {
    windowCalls.push(input.pageNumber);
    return { kind: "skipped", why: "no window tags read" };
  },
}));
const { refreshSuggestions, staleSuggestionSheets } = await import("./suggestionRefresh");
const { loadReviewQueue } = await import("./reviewQueueQuery");

let companyId = "", jobId = "", planId = "", pageId = "";
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Suggestion Refresh Co" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Refresh Suggestions", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1 } })).id;
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  // The run, before the legend: no tag read, nothing to suggest, stamped as a run stamps.
  await prisma.takeoffWallProposal.createMany({
    data: [
      { pageId, calibrationId: cal.id, thicknessInches: 7, source: "REMAINDER", runs: runs.map((r) => ({ ...r, thicknessFeet: 7 / 12 })) },
      { pageId, calibrationId: cal.id, thicknessInches: 5, source: "REMAINDER", runs: [{ ...confirmedRun, thicknessFeet: 5 / 12 }] },
    ],
  });
  await stampSuggestions(planId, 1, new Date(Date.now() - 60_000));
  expect((await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null })).kind).toBe("written");
});
afterAll(async () => {
  await prisma.takeoffMeasurement.deleteMany({ where: { pageId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

const typeItems = async () => (await loadReviewQueue(companyId, jobId)).items.flatMap((i) => (i.kind === "type" ? [i] : []));
const confirmed = () => prisma.takeoffMeasurement.findFirstOrThrow({ where: { pageId, source: "DETECTED", xs: { has: confirmedRun.x1 } }, select: { itemId: true, label: true } });

describe("a legend that lands after the takeoff reaches the queue without a re-run", () => {
  let byHand: { itemId: string | null; label: string | null };
  it("a person confirms one group by hand; nothing is stale while the run had no legend to miss", async () => {
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "S8A walls", type: "LINEAR", colorHex: "#888888" } });
    const row = await prisma.takeoffMeasurement.findFirstOrThrow({ where: { pageId, source: "DETECTED", xs: { has: confirmedRun.x1 } }, select: { id: true } });
    await prisma.takeoffMeasurement.update({ where: { id: row.id }, data: { itemId: item.id, label: "S8A wall (set by hand)" } });
    byHand = await confirmed();
    expect(await staleSuggestionSheets(planId)).toEqual([]);
    expect((await typeItems()).map((i) => i.suggested)).toEqual([null]);
  });

  it("the legend lands: the counted sheet is stale", async () => {
    const run = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 9 } });
    const read = { types: [{ code: "S6A", name: "S6A", lines: ['6" METAL STUDS TO DECK'] }], uno: [], reason: "r", confidence: "HIGH" as const };
    await prisma.planLegendProposal.create({ data: { ingestJobId: run.id, planId, pageNumber: 9, ...legendProposalFrom({ pageNumber: 9, sheetTitle: null, model: "m", read, crops: [] }) } });
    expect(await staleSuggestionSheets(planId)).toEqual([1]);
  });

  it("the refresh: the group shows the legend's type and 15'-0\", detected with no model call, the confirmed group untouched", async () => {
    expect(await refreshSuggestions({ planId, companyId })).toEqual([1]);
    expect(detectCalls).toEqual([{ noModel: true, pairWithThicknesses: false, pageNumber: 1 }]);
    expect(windowCalls).toEqual([1]);
    const items = await typeItems();
    expect(items.map((i) => i.suggested?.code)).toEqual(["S6A"]);
    expect((await loadReviewQueue(companyId, jobId)).heights["*"]?.feet).toBe(15);
    expect(await confirmed()).toEqual(byHand);
  });

  it("is done once: a second load finds nothing stale", async () => {
    expect(await refreshSuggestions({ planId, companyId })).toEqual([]);
    expect(detectCalls).toHaveLength(1);
  });

  it("older rules make it stale again", async () => {
    await prisma.takeoffPlanTextRead.update({ where: { planId_pageNumber_kind: { planId, pageNumber: 1, kind: SUGGESTIONS_READ } }, data: { value: { rules: 0 } } });
    expect(await staleSuggestionSheets(planId)).toEqual([1]);
  });
});
