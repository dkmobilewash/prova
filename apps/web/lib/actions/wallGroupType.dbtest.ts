import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { legendProposalFrom } from "@/lib/takeoff/legendProposalBuild";

// "Set type": a person names an untyped group from the set's legend, and the
// choice is saved with the job, priced, and carried to the next sheet.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// The line writes, watched: Accept all writes them once for all its groups.
let syncCalls = 0;
vi.mock("@/lib/estimating/takeoff-item-lines", async (actual) => {
  const real = await actual<typeof import("@/lib/estimating/takeoff-item-lines")>();
  return { ...real, syncDecidedItems: async (...args: Parameters<typeof real.syncDecidedItems>) => ((syncCalls += 1), real.syncDecidedItems(...args)) };
});
const { clearWallGroupType, confirmSheetSuggestions, setWallGroupType, undoSheetSuggestions } = await import("./wallGroupType");
const { wallItemsForSheet, UNTYPED_ITEM } = await import("@/lib/plan-ingest/wallItems");

let companyId = "";
let jobId = "";
let planId = "";
const runs = [{ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.1 }, { x1: 0.4, y1: 0.1, x2: 0.4, y2: 0.3 }];

async function sheet(pageNumber: number, rows: typeof runs) {
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  await prisma.takeoffWallProposal.create({ data: { pageId: page.id, calibrationId: cal.id, thicknessInches: 7, source: "REMAINDER", runs: rows.map((r) => ({ ...r, thicknessFeet: 7 / 12 })) } });
  return page.id;
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Set Type Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `settype_${Date.now()}`, email: `settype_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Set Type Job", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
  const run = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 9 } });
  const read = { types: [{ code: "C", name: "Partition C", lines: ['3 5/8" METAL STUDS @ 16" O.C.', '5/8" GYP. BD. EACH SIDE'] }], uno: [], reason: "r", confidence: "HIGH" as const };
  await prisma.planLegendProposal.create({ data: { ingestJobId: run.id, planId, pageNumber: 9, ...legendProposalFrom({ pageNumber: 9, sheetTitle: null, model: "m", read, crops: [] }) } });
});

describe("Set type", () => {
  it("moves the group's posted untyped runs onto the type's item, adding the type from the legend", async () => {
    const pageId = await sheet(1, runs);
    expect((await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null })).kind).toBe("written");
    const result = await setWallGroupType(jobId, { planId, pageNumber: 1, code: "c", inches: 7, runs });
    expect(result).toEqual({ ok: true });
    const type = await prisma.wallType.findFirst({ where: { companyId, code: "C" }, select: { id: true, _count: { select: { components: true } } } });
    expect(type?._count.components).toBeGreaterThan(0);
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId }, include: { item: true } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.item?.wallTypeId === type?.id && r.label === "C wall (set by hand)")).toBe(true);
    expect(await prisma.takeoffItem.count({ where: { jobId, name: UNTYPED_ITEM, measurements: { some: {} } } })).toBe(0);
  });

  it("ONLY THE GROUP PRESSED: another group as thick, with its own tag, is untouched; the item learns no thickness; Clear puts it all back (Chrome on Baker)", async () => {
    // Two 7" groups on one sheet, tagged differently, both posted untyped.
    const one = [{ x1: 0.1, y1: 0.8, x2: 0.5, y2: 0.8 }];
    const other = [{ x1: 0.6, y1: 0.8, x2: 0.9, y2: 0.8 }];
    const pageId = await sheet(2, [...one, ...other]);
    await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 2, userId: null });
    const on = async (run: (typeof one)[number]) =>
      (await prisma.takeoffMeasurement.findFirstOrThrow({ where: { pageId, xs: { equals: [run.x1, run.x2] }, ys: { equals: [run.y1, run.y2] } }, select: { item: { select: { name: true } } } })).item?.name;
    expect(await setWallGroupType(jobId, { planId, pageNumber: 2, code: "C", inches: 7, runs: one })).toEqual({ ok: true });
    expect(await on(one[0]!)).toBe("C walls");
    expect(await on(other[0]!)).toBe(UNTYPED_ITEM);
    // Nothing for detection to match the other group by: the item has no thickness.
    const item = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, wallType: { code: "C" } }, select: { id: true, thicknessIn: true } });
    expect(item.thicknessIn).toBeNull();
    // Clear (Set type's Undo): back exactly, the other group still untouched.
    expect((await clearWallGroupType(jobId, { planId, pageNumber: 2, runs: one })).ok).toBe(true);
    expect([await on(one[0]!), await on(other[0]!)]).toEqual([UNTYPED_ITEM, UNTYPED_ITEM]);
  });

  it("Clear takes the thickness off a typed item it leaves empty, which an earlier build's Set type wrote", async () => {
    const run = [{ x1: 0.1, y1: 0.9, x2: 0.4, y2: 0.9 }];
    await sheet(5, run);
    await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 5, userId: null });
    await setWallGroupType(jobId, { planId, pageNumber: 5, code: "C", inches: 7, runs: run });
    const item = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, wallType: { code: "C" } }, select: { id: true } });
    // As the old build left it.
    await prisma.takeoffItem.update({ where: { id: item.id }, data: { thicknessIn: "7.00" } });
    // Every C run on the job cleared: the item is empty, and its thickness goes with its walls.
    const all = await prisma.takeoffMeasurement.findMany({ where: { itemId: item.id }, select: { page: { select: { pageNumber: true } }, xs: true, ys: true } });
    for (const pageNumber of new Set(all.map((m) => m.page.pageNumber))) {
      const runs = all.filter((m) => m.page.pageNumber === pageNumber).map((m) => ({ x1: m.xs[0]!, y1: m.ys[0]!, x2: m.xs[1]!, y2: m.ys[1]! }));
      expect((await clearWallGroupType(jobId, { planId, pageNumber, runs })).ok).toBe(true);
    }
    expect((await prisma.takeoffItem.findUniqueOrThrow({ where: { id: item.id }, select: { thicknessIn: true } })).thicknessIn).toBeNull();
  });

  it("writes the runs when nothing was posted yet, and refuses a code the legend lacks", async () => {
    const pageId = await sheet(3, [{ x1: 0.2, y1: 0.7, x2: 0.6, y2: 0.7 }]);
    expect(await setWallGroupType(jobId, { planId, pageNumber: 3, code: "C", inches: 7, runs: [{ x1: 0.2, y1: 0.7, x2: 0.6, y2: 0.7 }] })).toEqual({ ok: true });
    expect(await prisma.takeoffMeasurement.count({ where: { pageId, item: { wallType: { code: "C" } } } })).toBe(1);
    const refused = await setWallGroupType(jobId, { planId, pageNumber: 3, code: "Q9", inches: 7, runs });
    expect(refused.ok).toBe(false);
  });

  it("A RE-RUN A HAIR OFF IS THE SAME WALL: Set type moves it rather than writing it twice, and Clear type finds it (Chrome on Baker A101)", async () => {
    const pageId = await sheet(4, [{ x1: 0.2, y1: 0.6, x2: 0.6, y2: 0.6 }]);
    await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 4, userId: null });
    // The finder run again returns the run a hair off the posted one.
    const rerun = [{ x1: 0.2004, y1: 0.6003, x2: 0.5997, y2: 0.5998 }];
    expect(await setWallGroupType(jobId, { planId, pageNumber: 4, code: "C", inches: 7, runs: rerun })).toEqual({ ok: true });
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId }, select: { item: { select: { wallType: { select: { code: true } } } } } });
    expect(rows.map((r) => r.item?.wallType?.code ?? null)).toEqual(["C"]);
    const cleared = await clearWallGroupType(jobId, { planId, pageNumber: 4, runs: rerun });
    expect(cleared.ok && cleared.value.moved).toHaveLength(1);
    expect(await prisma.takeoffMeasurement.count({ where: { pageId, item: { name: UNTYPED_ITEM } } })).toBe(1);
  });

  it("ACCEPT ALL WRITES THE LINES ONCE, for every group it took (Topeka: 10.8 s, the job re-read per group)", async () => {
    const a = [{ x1: 0.1, y1: 0.95, x2: 0.3, y2: 0.95 }];
    const b = [{ x1: 0.5, y1: 0.95, x2: 0.8, y2: 0.95 }];
    await sheet(6, [...a, ...b]);
    await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 6, userId: null });
    syncCalls = 0;
    const result = await confirmSheetSuggestions(jobId, [
      { planId, pageNumber: 6, code: "C", inches: 7, runs: a, heightFt: 10 },
      { planId, pageNumber: 6, code: "C", inches: 7, runs: b, heightFt: 10 },
    ]);
    expect(result.ok && result.value.accepted).toBe(2);
    expect(syncCalls).toBe(1);
    // And the lines are there: C's item carries a live line for its board.
    expect(await prisma.jobLineItem.count({ where: { jobId, isDeleted: false, takeoffItem: { wallType: { code: "C" } } } })).toBeGreaterThan(0);
  });
});

describe("Undo of an accept that added a library type (Chrome on Baker: C8B stayed, with an empty \"C8B walls\")", () => {
  let proposalId = "";
  beforeAll(async () => {
    const run = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 20 } });
    const read = { types: [{ code: "C8B", name: "Partition C8B", lines: ['6" METAL STUDS @ 16" O.C.', '5/8" GYP. BD. EACH SIDE'] }], uno: [], reason: "r", confidence: "HIGH" as const };
    proposalId = (await prisma.planLegendProposal.create({ data: { ingestJobId: run.id, planId, pageNumber: 10, ...legendProposalFrom({ pageNumber: 10, sheetTitle: null, model: "m", read, crops: [] }) } })).id;
  });
  const c8b = () => prisma.wallType.findFirst({ where: { companyId, code: "C8B" }, select: { id: true } });
  const walls = (y: number) => [{ x1: 0.1, y1: y, x2: 0.6, y2: y }];

  it("TAKES BACK THE TYPE AND THE EMPTY ITEM the accept made, and offers the legend read again", async () => {
    const pageId = await sheet(11, walls(0.5));
    await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 11, userId: null });
    expect(await c8b()).toBeNull();
    const result = await confirmSheetSuggestions(jobId, [{ planId, pageNumber: 11, code: "C8B", inches: 7, runs: walls(0.5), heightFt: 10 }]);
    if (!result.ok) throw new Error(result.error);
    expect(await c8b()).not.toBeNull();
    expect(await prisma.takeoffItem.count({ where: { jobId, name: "C8B walls" } })).toBe(1);
    expect((await prisma.planLegendProposal.findUnique({ where: { id: proposalId } }))?.status).toBe("ACCEPTED");

    expect(await undoSheetSuggestions(jobId, result.value.undo)).toEqual({ ok: true });
    expect(await c8b()).toBeNull();
    expect(await prisma.takeoffItem.count({ where: { jobId, name: "C8B walls" } })).toBe(0);
    expect((await prisma.planLegendProposal.findUnique({ where: { id: proposalId } }))?.status).toBe("PROPOSED");
    // The walls are back where they were: on "Walls — untyped".
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId }, include: { item: true } });
    expect(rows.map((r) => r.item?.name)).toEqual([UNTYPED_ITEM]);
  });

  it("KEEPS a type another accept still uses, and a forged claim removes nothing", async () => {
    await sheet(12, walls(0.6));
    await sheet(13, walls(0.7));
    await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 12, userId: null });
    await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 13, userId: null });
    const first = await confirmSheetSuggestions(jobId, [{ planId, pageNumber: 12, code: "C8B", inches: 7, runs: walls(0.6), heightFt: 10 }]);
    const second = await confirmSheetSuggestions(jobId, [{ planId, pageNumber: 13, code: "C8B", inches: 7, runs: walls(0.7), heightFt: 10 }]);
    if (!first.ok || !second.ok) throw new Error("accept failed");
    expect(first.value.undo.createdTypes).toHaveLength(1);
    expect(second.value.undo.createdTypes).toHaveLength(0);
    // Undo the first while the second still has walls on C8B: the type and its item stay.
    await undoSheetSuggestions(jobId, first.value.undo);
    expect(await c8b()).not.toBeNull();
    expect(await prisma.takeoffItem.count({ where: { jobId, name: "C8B walls" } })).toBe(1);
    // A forged undo naming the library's C (used, and not in that legend read) removes nothing.
    const c = await prisma.wallType.findFirst({ where: { companyId, code: "C" }, select: { id: true } });
    await undoSheetSuggestions(jobId, { moved: [], created: [], items: [], createdTypes: [{ id: c!.id, proposalId, reopen: true }] });
    expect(await prisma.wallType.count({ where: { id: c!.id } })).toBe(1);
  });
});
