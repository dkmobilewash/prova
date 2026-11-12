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
const { saveWallHeightAnswer } = await import("@/lib/actions/company");
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
async function setUp(rule: unknown, answer: { convention: "TO_STRUCTURE" | "CEILING_PLUS_6" | "FIXED" | null; fixedFt: number | null }, room?: { ceilingHeightFeet: number }) {
  const companyId = (await prisma.company.create({ data: { name: "Heights Co", defaultWallHeightFt: answer.fixedFt, wallHeightConvention: answer.convention } })).id;
  made.push(companyId);
  Object.assign(context, { companyId, company: { id: companyId } });
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `h_${Date.now()}_${Math.random()}`, email: `h_${Date.now()}_${Math.random()}@example.test`, role: "OWNER" } })).id;
  const w1 = STARTER_TYPES.find((t) => t.code === "W1")!;
  await prisma.wallType.create({ data: { companyId, code: "W1", name: w1.name, isDefaultPartition: true, components: { create: w1.parts.map((p, i) => ({ ...p, sortOrder: i })) } } });
  const gc = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: gc.id, name: "Heights job", status: "ESTIMATE" } });
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId: job.id, fileUrl: "local:none.pdf", fileName: "none.pdf" } });
  // The set's read, as `planHeights` keeps it: no PDF is opened here.
  await prisma.takeoffPlanTextRead.create({ data: { planId: plan.id, pageNumber: 0, kind: HEIGHT_RULE, value: { rule, structureFt: null, setCeilingFt: null, marks: [] } as never } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
  const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "100" } });
  const item = await prisma.takeoffItem.create({ data: { companyId, jobId: job.id, name: UNTYPED_ITEM, type: "LINEAR", colorHex: "#111111" } });
  // A room the finder stored above the walls (y > 0.5), with its ceiling.
  if (room) await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: calibration.id, kind: "AREA", source: "ROOM_FINDER", xs: [0, 0.3, 0.3, 0], ys: [0.5, 0.5, 0.6, 0.6], roomNumber: "101", ceilingHeightFeet: room.ceilingHeightFeet } });
  for (const x2 of [0.1, 0.2]) await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [0, x2], ys: [0.5, 0.5], itemId: item.id } });
  await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, job.id));
  const assign = () => assignWallHeights({ planId: plan.id, pageId: page.id, pageNumber: 1, companyId, jobId: job.id, doc: null });
  return { companyId, jobId: job.id, pageId: page.id, assign };
}
const walls = (pageId: string) => prisma.takeoffMeasurement.findMany({ where: { pageId, kind: "LINEAR" }, orderBy: { createdAt: "asc" }, select: { heightFt: true, heightAssumed: true, heightFrom: true } });
const boardLine = async (jobId: string) => (await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } })).find((l) => /Type X board/.test(l.description)) ?? null;

describe("every wall a height (D)", () => {
  it("what the drawing prints: both walls 15 ft, not assumed, and the board follows (30 ft × 15 ft × 2 sides)", async () => {
    const s = await setUp({ kind: "to-structure", feet: 15, from: 'general note: "ALL WALLS TO DECK"' }, { convention: "FIXED", fixedFt: 10 });
    expect(await boardLine(s.jobId)).toBeNull();
    expect(await s.assign()).toEqual({ drawn: 2, assumed: 0 });
    expect((await walls(s.pageId)).map((w) => [w.heightFt, w.heightAssumed])).toEqual([[15, false], [15, false]]);
    const board = (await boardLine(s.jobId))!;
    expect(Number(board.quantity)).toBe(Math.ceil((30 * 15 * 2 * 0.03125) * 1.1));
    expect(board.description).not.toContain("height assumed");
    expect((await loadBidCheckFacts(s.companyId, s.jobId)).heights.assumed?.walls).toBe(0);
  });

  it("nothing printed: the company's fixed height, ASSUMED, on the line and in bid check", async () => {
    const s = await setUp(null, { convention: "FIXED", fixedFt: 10 });
    expect(await s.assign()).toEqual({ drawn: 0, assumed: 2 });
    expect((await walls(s.pageId))[0]).toEqual({ heightFt: 10, heightAssumed: true, heightFrom: "assumed: your usual height, 10 ft" });
    const board = (await boardLine(s.jobId))!;
    expect(board.description).toContain("(height assumed: check)");
    expect(Number(board.quantity)).toBe(Math.ceil((30 * 10 * 2 * 0.03125) * 1.1));
    expect((await loadBidCheckFacts(s.companyId, s.jobId)).heights.assumed).toEqual({ walls: 2 });
  });

  it("to the ceiling + 6\": the stored room's 9 ft ceiling makes both walls 9'-6\", assumed", async () => {
    const s = await setUp(null, { convention: "CEILING_PLUS_6", fixedFt: 10 }, { ceilingHeightFeet: 9 });
    expect(await s.assign()).toEqual({ drawn: 0, assumed: 2 });
    expect((await walls(s.pageId)).map((w) => [w.heightFt, w.heightAssumed])).toEqual([[9.5, true], [9.5, true]]);
  });

  it("changing the answer moves the assumed walls and their board; no answer clears them", async () => {
    const s = await setUp(null, { convention: "FIXED", fixedFt: 10 }, { ceilingHeightFeet: 9 });
    await s.assign();
    const form = (convention: string, feet: string) => {
      const f = new FormData();
      f.set("wallHeightConvention", convention);
      f.set("defaultWallHeightFt", feet);
      return f;
    };
    expect(await saveWallHeightAnswer(form("FIXED", "12"))).toEqual({ ok: true });
    expect((await walls(s.pageId)).map((w) => w.heightFt)).toEqual([12, 12]);
    expect(Number((await boardLine(s.jobId))!.quantity)).toBe(Math.ceil((30 * 12 * 2 * 0.03125) * 1.1));
    expect(await saveWallHeightAnswer(form("CEILING_PLUS_6", "12"))).toEqual({ ok: true });
    expect((await walls(s.pageId)).map((w) => w.heightFt)).toEqual([9.5, 9.5]);
    expect(await saveWallHeightAnswer(form("FIXED", ""))).toMatchObject({ ok: false, error: expect.stringContaining("Type the height") });
    expect(await saveWallHeightAnswer(form("FIXED", "4"))).toMatchObject({ ok: false });
    expect(await saveWallHeightAnswer(form("", ""))).toEqual({ ok: true });
    expect((await walls(s.pageId)).map((w) => [w.heightFt, w.heightAssumed])).toEqual([[null, false], [null, false]]);
  });

  it("nothing printed and no default: no height, as before", async () => {
    const s = await setUp(null, { convention: null, fixedFt: null });
    expect(await s.assign()).toEqual({ drawn: 0, assumed: 0 });
    expect((await walls(s.pageId)).every((w) => w.heightFt === null)).toBe(true);
  });

  it("the trade pick sets the answer: the preset's, or the one chosen and typed", async () => {
    const { tradePreset } = await import("@/lib/trade-presets");
    const preset = tradePreset("FRAMING_DRYWALL")!;
    for (const [typed, convention, stored] of [[undefined, undefined, [10, preset.wallHeightConvention]], ["11.5", "FIXED", [11.5, "FIXED"]]] as const) {
      const companyId = (await prisma.company.create({ data: { name: "Fresh heights" } })).id;
      made.push(companyId);
      Object.assign(context, { companyId, company: { id: companyId } });
      expect(await applyTradePreset("FRAMING_DRYWALL", undefined, typed, convention)).toEqual({ ok: true });
      const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      expect([Number(c.defaultWallHeightFt), c.wallHeightConvention]).toEqual(stored);
    }
  });
});
