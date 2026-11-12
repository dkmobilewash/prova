import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { STARTER_TYPES } from "@/lib/wall-type-starters";

/**
 * D, against a real Postgres: every wall on a sheet gets a height once its rooms are found — what the
 * drawing prints (the set's rule, kept as a plan read), else the company's default, ASSUMED — and the
 * wall's board follows it onto the estimate; an assumed one is marked on the line and asked in bid
 * check; changing the default moves the assumed walls and their lines; the trade pick sets it.
 */
const context = { company: { id: "" }, companyId: "", id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { assignWallHeights, HEIGHT_RULE } = await import("./wallHeightsAssign");
const { syncTakeoffItemLines } = await import("@/lib/estimating/takeoff-item-lines");
const { saveDefaultWallHeight } = await import("@/lib/actions/company");
const { applyTradePreset } = await import("@/lib/actions/tradePresets");
const { loadBidCheckFacts } = await import("@/lib/estimating/bidCheckQuery");
const { UNTYPED_ITEM } = await import("./untypedItem");

const made: string[] = [];
afterAll(async () => {
  for (const companyId of made) {
    await prisma.jobLineItem.deleteMany({ where: { job: { companyId } } });
    await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { companyId } } } });
    await prisma.takeoffItem.deleteMany({ where: { companyId } });
    await prisma.takeoffPlanTextRead.deleteMany({ where: { plan: { companyId } } });
    await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { companyId } } } });
    await prisma.takeoffPlanPage.deleteMany({ where: { plan: { companyId } } });
    await prisma.takeoffPlan.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.wallType.deleteMany({ where: { companyId } });
    await prisma.companyTradeScope.deleteMany({ where: { companyId } });
    await prisma.proposalClause.deleteMany({ where: { companyId } });
    await prisma.estimateTemplate.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
});

/** A company whose default partition is the starter W1 (no height of its own), and an untyped sheet of 30 ft of wall. */
async function setUp(rule: unknown, defaultWallHeightFt: number | null) {
  const companyId = (await prisma.company.create({ data: { name: "Heights Co", defaultWallHeightFt } })).id;
  made.push(companyId);
  Object.assign(context, { companyId, company: { id: companyId } });
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `h_${Date.now()}_${Math.random()}`, email: `h_${Date.now()}_${Math.random()}@example.test`, role: "OWNER" } })).id;
  const w1 = STARTER_TYPES.find((t) => t.code === "W1")!;
  await prisma.wallType.create({ data: { companyId, code: "W1", name: w1.name, isDefaultPartition: true, components: { create: w1.parts.map((p, i) => ({ ...p, sortOrder: i })) } } });
  const gc = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: gc.id, name: "Heights job", status: "ESTIMATE" } });
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId: job.id, fileUrl: "local:none.pdf", fileName: "none.pdf" } });
  if (rule !== undefined) await prisma.takeoffPlanTextRead.create({ data: { planId: plan.id, pageNumber: 0, kind: HEIGHT_RULE, value: { rule } as never } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
  const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "100" } });
  const item = await prisma.takeoffItem.create({ data: { companyId, jobId: job.id, name: UNTYPED_ITEM, type: "LINEAR", colorHex: "#111111" } });
  for (const x2 of [0.1, 0.2]) await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [0, x2], ys: [0.5, 0.5], itemId: item.id } });
  await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, job.id));
  const assign = () => assignWallHeights({ planId: plan.id, pageId: page.id, pageNumber: 1, companyId, jobId: job.id, doc: null as never, rooms: [], ceilings: new Map() });
  return { companyId, jobId: job.id, pageId: page.id, assign };
}
const walls = (pageId: string) => prisma.takeoffMeasurement.findMany({ where: { pageId }, orderBy: { createdAt: "asc" }, select: { heightFt: true, heightAssumed: true, heightFrom: true } });
const boardLine = async (jobId: string) => (await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } })).find((l) => /Type X board/.test(l.description)) ?? null;

describe("every wall a height (D)", () => {
  it("what the drawing prints: both walls 15 ft, not assumed, and the board follows (30 ft × 15 ft × 2 sides)", async () => {
    const s = await setUp({ kind: "to-structure", feet: 15, from: 'general note: "ALL WALLS TO DECK"' }, 10);
    expect(await boardLine(s.jobId)).toBeNull();
    expect(await s.assign()).toEqual({ drawn: 2, assumed: 0 });
    expect((await walls(s.pageId)).map((w) => [w.heightFt, w.heightAssumed])).toEqual([[15, false], [15, false]]);
    const board = (await boardLine(s.jobId))!;
    expect(Number(board.quantity)).toBe(Math.ceil((30 * 15 * 2 * 0.03125) * 1.1));
    expect(board.description).not.toContain("height assumed");
    expect((await loadBidCheckFacts(s.companyId, s.jobId)).heights.assumed?.walls).toBe(0);
  });

  it("nothing printed: the company default, ASSUMED, on the line and in bid check", async () => {
    const s = await setUp(null, 10);
    expect(await s.assign()).toEqual({ drawn: 0, assumed: 2 });
    expect((await walls(s.pageId))[0]).toEqual({ heightFt: 10, heightAssumed: true, heightFrom: "assumed: your default wall height, 10 ft" });
    const board = (await boardLine(s.jobId))!;
    expect(board.description).toContain("(height assumed: check)");
    expect(Number(board.quantity)).toBe(Math.ceil((30 * 10 * 2 * 0.03125) * 1.1));
    expect((await loadBidCheckFacts(s.companyId, s.jobId)).heights.assumed).toEqual({ walls: 2, feet: 10 });
  });

  it("changing the default moves the assumed walls and their board; clearing it clears them", async () => {
    const s = await setUp(null, 10);
    await s.assign();
    const form = (v: string) => {
      const f = new FormData();
      f.set("defaultWallHeightFt", v);
      return f;
    };
    expect(await saveDefaultWallHeight(form("12"))).toEqual({ ok: true });
    expect((await walls(s.pageId)).map((w) => w.heightFt)).toEqual([12, 12]);
    expect(Number((await boardLine(s.jobId))!.quantity)).toBe(Math.ceil((30 * 12 * 2 * 0.03125) * 1.1));
    expect(await saveDefaultWallHeight(form("4"))).toMatchObject({ ok: false });
    expect(await saveDefaultWallHeight(form(""))).toEqual({ ok: true });
    expect((await walls(s.pageId)).map((w) => [w.heightFt, w.heightAssumed])).toEqual([[null, false], [null, false]]);
  });

  it("nothing printed and no default: no height, as before", async () => {
    const s = await setUp(null, null);
    expect(await s.assign()).toEqual({ drawn: 0, assumed: 0 });
    expect((await walls(s.pageId)).every((w) => w.heightFt === null)).toBe(true);
  });

  it("the trade pick sets the default: the preset's 10 ft, or the figure typed", async () => {
    for (const [typed, stored] of [[undefined, 10], ["11.5", 11.5]] as const) {
      const companyId = (await prisma.company.create({ data: { name: "Fresh heights" } })).id;
      made.push(companyId);
      Object.assign(context, { companyId, company: { id: companyId } });
      expect(await applyTradePreset("FRAMING_DRYWALL", undefined, typed)).toEqual({ ok: true });
      expect(Number((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).defaultWallHeightFt)).toBe(stored);
    }
  });
});
