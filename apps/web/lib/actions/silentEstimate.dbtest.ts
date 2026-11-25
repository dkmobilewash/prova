import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * ── NOTHING TYPED BY HAND LEAVES THE ESTIMATE UNSAID (Diego's order (e), 2026-11-25) ──
 *
 * coordination/silent-estimate-sync.md, rules A1-A4, B1, C1, C2, written before this file. Each case below failed on
 * main d41ab48c. Real Postgres, the real actions.
 *
 * The fixture: one sheet at 100 ft across. W2 walls: two runs, 20 ft + 10 ft, a runner track and studs. W4 walls: one
 * 50 ft run. C1 ceiling: a 10 ft × 10 ft outline priced by an AREA_SQFT part. All sent to the estimate. Then W2's track line is priced by hand at $7.
 */
const context = { company: { id: "" }, companyId: "", id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const takeoff = await import("./takeoff");
const items = await import("./takeoffItems");
const { clearWallGroupType } = await import("./wallGroupType");
const { syncTakeoffItemLines } = await import("@/lib/estimating/takeoff-item-lines");

const made: string[] = [];
afterAll(async () => {
  for (const companyId of made) {
    await prisma.jobLineItem.deleteMany({ where: { job: { companyId } } });
    await prisma.takeoffPlan.deleteMany({ where: { companyId } });
    await prisma.takeoffItem.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.wallType.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
});

type Setup = { companyId: string; jobId: string; planId: string; pageId: string; w2: string; w4: string; ceiling: string; runA: string; runB: string; runW4: string; area: string; track: string };
let s: Setup;

async function setUp(): Promise<Setup> {
  const companyId = (await prisma.company.create({ data: { name: "Silent Estimate Co" } })).id;
  made.push(companyId);
  Object.assign(context, { companyId, company: { id: companyId } });
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `se_${Date.now()}_${Math.random()}`, email: `se_${Date.now()}_${Math.random()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Silent Estimate Job", status: "ESTIMATE" } })).id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:A.pdf", fileName: "A.pdf" } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A-201" } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  const parts = { create: [{ description: "runner track", basis: "LINEAR_FT" as const, unit: "lin ft", factor: 1 }, { description: "studs", basis: "STUDS" as const, unit: "ea", factor: 1 }] };
  const t2 = await prisma.wallType.create({ data: { companyId, code: "W2", name: "W2", defaultHeightFt: 10, sides: 2, components: parts } });
  const t4 = await prisma.wallType.create({ data: { companyId, code: "W4", name: "W4", defaultHeightFt: 10, sides: 2, components: parts } });
  const item = (name: string, wallTypeId: string | null, type: "LINEAR" | "AREA_WITH_PERIMETER" = "LINEAR") =>
    prisma.takeoffItem.create({ data: { companyId, jobId, name, type, colorHex: "#111111", wallTypeId, ...(wallTypeId ? { heightFt: 10, sides: 2 } : {}) } }).then((i) => i.id);
  const w2 = await item("W2 walls", t2.id);
  const w4 = await item("W4 walls", t4.id);
  // A ceiling priced by an assembly: an AREA_SQFT part reads the outline with its openings deducted.
  const act = await prisma.wallType.create({ data: { companyId, code: "C1", name: "C1 ceiling", components: { create: [{ description: "ceiling grid", basis: "AREA_SQFT", unit: "sq ft", factor: 1 }] } } });
  const ceiling = await item("C1 ceiling", act.id, "AREA_WITH_PERIMETER");
  const run = (itemId: string, y: number, len: number) =>
    prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: cal.id, kind: "LINEAR", source: "DETECTED", xs: [0.1, 0.1 + len], ys: [y, y], itemId } }).then((m) => m.id);
  const runA = await run(w2, 0.1, 0.2);
  const runB = await run(w2, 0.2, 0.1);
  const runW4 = await run(w4, 0.3, 0.5);
  const area = (await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: cal.id, kind: "AREA", xs: [0.5, 0.6, 0.6, 0.5], ys: [0.5, 0.5, 0.6, 0.6], itemId: ceiling } })).id;
  const sent = await items.sendTakeoffItemsToEstimate(jobId);
  if (!sent.ok) throw new Error(sent.error);
  const track = (await prisma.jobLineItem.findFirstOrThrow({ where: { takeoffItemId: w2, isDeleted: false, description: { contains: "runner track" } } })).id;
  await prisma.jobLineItem.update({ where: { id: track }, data: { unitPrice: "7.00" } });
  return { companyId, jobId, planId: plan.id, pageId: page.id, w2, w4, ceiling, runA, runB, runW4, area, track };
}

const line = (id: string) => prisma.jobLineItem.findUniqueOrThrow({ where: { id } }).then((l) => ({ isDeleted: l.isDeleted, takeoffItemId: l.takeoffItemId, quantity: Number(l.quantity), unitPrice: l.unitPrice === null ? null : Number(l.unitPrice) }));
const trackQty = async (itemId: string) => (await prisma.jobLineItem.findMany({ where: { takeoffItemId: itemId, isDeleted: false, description: { contains: "runner track" } }, select: { quantity: true } })).map((l) => Number(l.quantity));
const w2Runs = [{ x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.1 }, { x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.2 }];
/** Live takeoff lines nobody can see a reason for: unlinked, never typed by hand. */
const orphans = (jobId: string) => prisma.jobLineItem.count({ where: { jobId, isDeleted: false, takeoffItemId: null, unitPrice: null, budgetedUnitCost: null } });

beforeEach(async () => {
  s = await setUp();
});

describe("A1: a sync never retires a line priced by hand", () => {
  it("the control: the fixture put W2 on the estimate at 30 ft, priced $7", async () => {
    expect(await line(s.track)).toEqual({ isDeleted: false, takeoffItemId: s.w2, quantity: 30, unitPrice: 7 });
  });

  it("Clear type: the $7 line is kept, linked, at 0 ft with its price (on main it was retired)", async () => {
    const done = await clearWallGroupType(s.jobId, { planId: s.planId, pageNumber: 1, runs: w2Runs });
    expect(done.ok).toBe(true);
    expect(await line(s.track)).toEqual({ isDeleted: false, takeoffItemId: s.w2, quantity: 0, unitPrice: 7 });
  });

  it("an unpriced line still retires exactly as before (W2's studs)", async () => {
    const studs = (await prisma.jobLineItem.findFirstOrThrow({ where: { takeoffItemId: s.w2, description: { contains: "studs" } } })).id;
    await clearWallGroupType(s.jobId, { planId: s.planId, pageNumber: 1, runs: w2Runs });
    expect((await line(studs)).isDeleted).toBe(true);
  });

  it("when the walls come back, the SAME line takes their feet with its price, and no second line appears", async () => {
    await clearWallGroupType(s.jobId, { planId: s.planId, pageNumber: 1, runs: w2Runs });
    await prisma.takeoffMeasurement.updateMany({ where: { id: { in: [s.runA, s.runB] } }, data: { itemId: s.w2 } });
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, s.companyId, s.jobId, new Set([s.w2])));
    expect(await line(s.track)).toEqual({ isDeleted: false, takeoffItemId: s.w2, quantity: 30, unitPrice: 7 });
    expect(await trackQty(s.w2)).toEqual([30]);
  });
});

describe("A2: told, every time", () => {
  it("the sync's summary names the line it zeroed, with its price, and only on the sync that zeroed it", async () => {
    await prisma.takeoffMeasurement.updateMany({ where: { id: { in: [s.runA, s.runB] } }, data: { itemId: null } });
    const first = await prisma.$transaction((tx) => syncTakeoffItemLines(tx, s.companyId, s.jobId));
    expect((first as { zeroed?: unknown }).zeroed).toEqual([{ id: s.track, description: expect.stringContaining("runner track"), unitPrice: "7" }]);
    const again = await prisma.$transaction((tx) => syncTakeoffItemLines(tx, s.companyId, s.jobId));
    expect((again as { zeroed?: unknown }).zeroed).toEqual([]);
  });

  it("Send returns what it zeroed", async () => {
    await prisma.takeoffMeasurement.updateMany({ where: { id: { in: [s.runA, s.runB] } }, data: { itemId: null } });
    const sent = await items.sendTakeoffItemsToEstimate(s.jobId);
    if (!sent.ok) throw new Error(sent.error);
    expect((sent.value as { zeroed?: { id: string }[] }).zeroed?.map((l) => l.id)).toEqual([s.track]);
  });

  it("the derived notice lists every zeroed priced line on the job, whichever action zeroed it", async () => {
    const { zeroedPricedLines } = (await import("@/lib/estimating/zeroedLines")) as { zeroedPricedLines: (jobId: string) => Promise<{ id: string; description: string; unitPrice: string | null }[]> };
    expect(await zeroedPricedLines(s.jobId)).toEqual([]);
    await clearWallGroupType(s.jobId, { planId: s.planId, pageNumber: 1, runs: w2Runs });
    expect((await zeroedPricedLines(s.jobId)).map((l) => l.id)).toEqual([s.track]);
  });
});

describe("A4: a GC never sees a zeroed line", () => {
  it("the lines a GC is shown leave out takeoff lines at 0, and keep a line typed at 0 by hand", async () => {
    const { gcLines } = (await import("@/lib/estimating/zeroedLines")) as { gcLines: (jobId: string) => Promise<{ id: string }[]> };
    const typedZero = await prisma.jobLineItem.create({ data: { jobId: s.jobId, description: "Allowance — TBD", quantity: "0", unitPrice: "100" } });
    await clearWallGroupType(s.jobId, { planId: s.planId, pageNumber: 1, runs: w2Runs });
    const shown = (await gcLines(s.jobId)).map((l) => l.id);
    expect(shown).not.toContain(s.track);
    expect(shown).toContain(typedZero.id);
  });
});

describe("B1: changing a run updates its estimate line in the same action", () => {
  it("deleting one run drops the line to the remaining feet (30 -> 10)", async () => {
    expect((await takeoff.deleteTakeoffMeasurement(s.jobId, s.runA)).ok).toBe(true);
    expect(await trackQty(s.w2)).toEqual([10]);
  });

  it("deleting the last run zeroes the priced line and keeps it, not loses it", async () => {
    await takeoff.deleteTakeoffMeasurement(s.jobId, s.runA);
    await takeoff.deleteTakeoffMeasurement(s.jobId, s.runB);
    expect(await line(s.track)).toEqual({ isDeleted: false, takeoffItemId: s.w2, quantity: 0, unitPrice: 7 });
  });

  it("moving a run to another item moves its feet on the estimate (W4 50 -> 70, W2 30 -> 10)", async () => {
    expect((await items.assignMeasurementsToItem(s.jobId, s.w4, [s.runA])).ok).toBe(true);
    expect(await trackQty(s.w2)).toEqual([10]);
    expect(await trackQty(s.w4)).toEqual([70]);
  });

  it("editing a run's points re-measures its line (runB 10 ft -> 40 ft: W2 30 -> 60)", async () => {
    expect((await items.updateMeasurementGeometry(s.jobId, s.runB, [0.1, 0.5], [0.2, 0.2])).ok).toBe(true);
    expect(await trackQty(s.w2)).toEqual([60]);
  });

  it("an opening cut from a ceiling takes its area off the ceiling's line (100 -> 75 sq ft)", async () => {
    const ceilingQty = async () => (await prisma.jobLineItem.findMany({ where: { takeoffItemId: s.ceiling, isDeleted: false }, select: { quantity: true } })).map((l) => Number(l.quantity));
    expect(await ceilingQty()).toEqual([100]);
    expect((await items.addMeasurementCutout(s.jobId, s.pageId, { xs: [0.5, 0.55, 0.55, 0.5], ys: [0.5, 0.5, 0.55, 0.55] })).ok).toBe(true);
    expect(await ceilingQty()).toEqual([75]);
  });
});

type DeleteItem = (jobId: string, itemId: string, withMeasurements?: boolean, options?: { keepHandPriced?: boolean }) => Promise<{ ok: boolean }>;
const deleteItem = items.deleteTakeoffItem as unknown as DeleteItem;

describe("C: deleting an item leaves nothing live, unlinked and silent", () => {
  it("C1: its unpriced lines retire (on main they stayed live, unlinked, still charged)", async () => {
    const w4Lines = (await prisma.jobLineItem.findMany({ where: { takeoffItemId: s.w4 }, select: { id: true } })).map((l) => l.id);
    expect(w4Lines.length).toBeGreaterThan(0);
    expect((await deleteItem(s.jobId, s.w4, true)).ok).toBe(true);
    for (const id of w4Lines) expect((await line(id)).isDeleted).toBe(true);
    expect(await orphans(s.jobId)).toBe(0);
  });

  it("C1: the same when its runs are kept and go to no item", async () => {
    expect((await deleteItem(s.jobId, s.w4, false)).ok).toBe(true);
    expect(await orphans(s.jobId)).toBe(0);
  });

  it("C2: a line priced by hand is kept as a typed line by default, at its quantity and price", async () => {
    expect((await deleteItem(s.jobId, s.w2, true)).ok).toBe(true);
    expect(await line(s.track)).toEqual({ isDeleted: false, takeoffItemId: null, quantity: 30, unitPrice: 7 });
  });

  it("C2: ...and retired when the person unticks it", async () => {
    expect((await deleteItem(s.jobId, s.w2, true, { keepHandPriced: false })).ok).toBe(true);
    expect((await line(s.track)).isDeleted).toBe(true);
  });
});
