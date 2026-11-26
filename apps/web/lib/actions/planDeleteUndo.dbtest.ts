import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * ── A PLAN DELETE CAN BE UNDONE FOR 10 MINUTES (Diego, 2026-11-26; coordination/plan-delete-undo.md U1-U6) ──
 *
 * Written before the code; each case failed on main 049b6517 (a hard delete). Real Postgres, the real actions. The
 * fixture is #1257's (planDelete.dbtest.ts): plan A holds W1 30 ft, an untyped 40 ft run and 3 doors; plan B holds W1 20 ft.
 */
const context = { company: { id: "" }, companyId: "", id: "", role: "OWNER" as string, jobFunction: null as string | null };
const deleted = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/blob", async (actual) => ({ ...(await actual<typeof import("@/lib/blob")>()), deleteDocument: async (url: string) => void deleted.push(url) }));
const takeoff = await import("./takeoff");
const { sendTakeoffItemsToEstimate } = await import("./takeoffItems");
const { AUTO_DOORS_ITEM, AUTO_DOORS_LABEL } = await import("@/lib/takeoff/autoPost");
const { HELD_ITEM, HELD_LABEL } = await import("@/lib/takeoff/estimateHold");

type Result = { ok: true; value?: unknown } | { ok: false; error: string };
const remove = takeoff.deleteTakeoffPlan as unknown as (jobId: string, planId: string, options?: { keepHandPriced?: boolean }) => Promise<Result>;
const undo = (jobId: string, planId: string) => (takeoff as unknown as { undoTakeoffPlanDelete: (j: string, p: string) => Promise<Result> }).undoTakeoffPlanDelete(jobId, planId);
const purge = async (now: Date) =>
  ((await import("@/lib/takeoff/planPurge")) as { purgeDeletedPlans: (o: { companyId?: string; now?: Date }) => Promise<number> }).purgeDeletedPlans({ companyId: context.companyId, now });
type PlanRow = { id: string; jobId: string | null; deletedAt: Date | null; deleteUndo: unknown };
const planRow = (id: string) => prisma.takeoffPlan.findUnique({ where: { id } }) as unknown as Promise<PlanRow | null>;

const made: string[] = [];
afterAll(async () => {
  for (const companyId of made) {
    await prisma.jobLineItem.deleteMany({ where: { job: { companyId } } });
    await prisma.takeoffPlan.deleteMany({ where: { companyId } });
    await prisma.takeoffItem.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.wallType.deleteMany({ where: { companyId } });
    await prisma.companyTradeScope.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
});

type Setup = { jobId: string; planA: string; planB: string; w1: string; untyped: string; doors: string; pageA: string; calA: string; fileA: string };
let s: Setup;

async function setUp(): Promise<Setup> {
  const companyId = (await prisma.company.create({ data: { name: "Plan Undo Co", doorScope: "DOORS_AND_FRAMES" } })).id;
  made.push(companyId);
  Object.assign(context, { companyId, company: { id: companyId } });
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `pu_${Date.now()}_${Math.random()}`, email: `pu_${Date.now()}_${Math.random()}@example.test`, role: "OWNER" } })).id;
  await prisma.companyTradeScope.create({ data: { companyId, tradeScope: "METAL_FRAMING_DRYWALL", isPrimary: true, activeSince: new Date() } });
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Plan Undo Job", status: "ESTIMATE" } })).id;
  const sheet = async (name: string, label: string) => {
    const fileUrl = `https://store.public.blob.vercel-storage.com/takeoff/${name}-${Math.random()}.pdf`;
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl, fileName: `${name}.pdf` } });
    const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label } });
    const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
    return { planId: plan.id, pageId: page.id, calId: cal.id, fileUrl };
  };
  const a = await sheet("A", "A-201");
  const b = await sheet("B", "A-202");
  const type = await prisma.wallType.create({ data: { companyId, code: "W1", name: "W1", isDefaultPartition: true, defaultHeightFt: 10, sides: 2, components: { create: [{ description: "runner track", basis: "LINEAR_FT", unit: "lin ft", factor: 1 }, { description: "studs", basis: "STUDS", unit: "ea", factor: 1 }] } } });
  const w1 = (await prisma.takeoffItem.create({ data: { companyId, jobId, name: "W1 walls", type: "LINEAR", colorHex: "#111111", wallTypeId: type.id, heightFt: 10, sides: 2 } })).id;
  const untyped = (await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#999999" } })).id;
  const doors = (await prisma.takeoffItem.create({ data: { companyId, jobId, name: AUTO_DOORS_ITEM, type: "COUNT", colorHex: "#222222" } })).id;
  const run = (at: { pageId: string; calId: string }, itemId: string, y: number, len: number) =>
    prisma.takeoffMeasurement.create({ data: { pageId: at.pageId, calibrationId: at.calId, kind: "LINEAR", source: "DETECTED", xs: [0.1, 0.1 + len], ys: [y, y], itemId } });
  await run(a, w1, 0.1, 0.3);
  await run(b, w1, 0.1, 0.2);
  await run(a, untyped, 0.3, 0.4);
  await prisma.takeoffMeasurement.create({ data: { pageId: a.pageId, calibrationId: a.calId, kind: "COUNT", xs: [0.2, 0.3, 0.4], ys: [0.5, 0.5, 0.5], itemId: doors, label: AUTO_DOORS_LABEL } });
  const sent = await sendTakeoffItemsToEstimate(jobId);
  if (!sent.ok) throw new Error(sent.error);
  return { jobId, planA: a.planId, planB: b.planId, w1, untyped, doors, pageA: a.pageId, calA: a.calId, fileA: a.fileUrl };
}

/** Every live line, in order, as the GC would price it: what Undo must give back to the cent. */
const estimate = async (jobId: string) =>
  (await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, orderBy: { createdAt: "asc" }, select: { id: true, description: true, quantity: true, unitPrice: true, takeoffItemId: true } })).map((l) => ({ ...l, quantity: Number(l.quantity), unitPrice: l.unitPrice === null ? null : Number(l.unitPrice) }));
const qty = async (itemId: string) => (await prisma.jobLineItem.findMany({ where: { takeoffItemId: itemId, isDeleted: false, description: { contains: "runner track" } }, select: { quantity: true } })).map((l) => Number(l.quantity));

beforeEach(async () => {
  deleted.length = 0;
  s = await setUp();
});

describe("U1: a plan delete is soft", () => {
  it("the plan stays, off the job, marked deleted, with what it changed recorded; its runs leave their items", async () => {
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    const row = await planRow(s.planA);
    expect(row).not.toBeNull();
    expect(row!.deletedAt).toBeInstanceOf(Date);
    expect(row!.jobId).toBeNull();
    expect((row!.deleteUndo as { jobId?: string }).jobId).toBe(s.jobId);
    const runs = await prisma.takeoffMeasurement.findMany({ where: { page: { planId: s.planA } }, select: { itemId: true } });
    expect(runs.length).toBe(3);
    expect(runs.every((r) => r.itemId === null)).toBe(true);
    // The file is not touched until the purge.
    expect(deleted).toEqual([]);
  });

  it("the estimate moves exactly as #1257's delete moved it (W1 50 -> 20; the untyped and door lines gone)", async () => {
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    expect(await qty(s.w1)).toEqual([20]);
    expect(await prisma.jobLineItem.count({ where: { takeoffItemId: { in: [s.untyped, s.doors] }, isDeleted: false } })).toBe(0);
    // The job no longer lists it.
    expect(await prisma.takeoffPlan.count({ where: { jobId: s.jobId } })).toBe(1);
  });
});

describe("U4: Undo, inside the window, puts everything back", () => {
  it("the plan on the job, every run on its item, every line as it was, to the cent", async () => {
    const line = await prisma.jobLineItem.findFirstOrThrow({ where: { takeoffItemId: s.untyped, isDeleted: false, description: { contains: "runner track" } } });
    await prisma.jobLineItem.update({ where: { id: line.id }, data: { unitPrice: "9.00" } });
    const before = await estimate(s.jobId);
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    expect(await estimate(s.jobId)).not.toEqual(before);
    const done = await undo(s.jobId, s.planA);
    expect(done.ok).toBe(true);
    const row = await planRow(s.planA);
    expect({ jobId: row!.jobId, deletedAt: row!.deletedAt }).toEqual({ jobId: s.jobId, deletedAt: null });
    const items = (await prisma.takeoffMeasurement.findMany({ where: { page: { planId: s.planA } }, select: { itemId: true } })).map((r) => r.itemId).sort();
    expect(items).toEqual([s.w1, s.untyped, s.doors].sort());
    expect(await estimate(s.jobId)).toEqual(before);
  });
});

describe("U5: Undo refuses, and moves nothing", () => {
  it("after the 10 minutes", async () => {
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    await prisma.$executeRawUnsafe(`UPDATE "TakeoffPlan" SET "deletedAt" = now() - interval '11 minutes' WHERE id = $1`, s.planA);
    const after = await estimate(s.jobId);
    const done = await undo(s.jobId, s.planA);
    expect(done.ok).toBe(false);
    expect(await estimate(s.jobId)).toEqual(after);
    expect((await planRow(s.planA))!.jobId).toBeNull();
  });
  it("when a line the delete changed was edited since", async () => {
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    const w1Line = await prisma.jobLineItem.findFirstOrThrow({ where: { takeoffItemId: s.w1, isDeleted: false, description: { contains: "runner track" } } });
    await new Promise((r) => setTimeout(r, 20));
    await prisma.jobLineItem.update({ where: { id: w1Line.id }, data: { unitPrice: "4.00" } });
    const after = await estimate(s.jobId);
    const done = await undo(s.jobId, s.planA);
    expect(done.ok).toBe(false);
    expect(await estimate(s.jobId)).toEqual(after);
  });
});

describe("U6: the purge, after the window", () => {
  it("before the window: nothing; after: the plan, pages and runs gone, the emptied items too, the file deleted once", async () => {
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    expect(await purge(new Date(Date.now() + 5 * 60_000))).toBe(0);
    expect(await planRow(s.planA)).not.toBeNull();
    expect(await purge(new Date(Date.now() + 11 * 60_000))).toBe(1);
    expect(await planRow(s.planA)).toBeNull();
    expect(await prisma.takeoffPlanPage.count({ where: { planId: s.planA } })).toBe(0);
    // The untyped and door items had runs only on plan A: emptied, and gone. W1 keeps its plan-B run.
    expect(await prisma.takeoffItem.count({ where: { id: { in: [s.untyped, s.doors] } } })).toBe(0);
    expect(await prisma.takeoffItem.count({ where: { id: s.w1 } })).toBe(1);
    expect(deleted).toEqual([s.fileA]);
    expect(await purge(new Date(Date.now() + 20 * 60_000))).toBe(0);
    expect(deleted).toEqual([s.fileA]);
  });
});

describe("Item 1 pin (Diego, 2026-11-26): the dialog counts exactly the stored runs", () => {
  it("every LINEAR run stored on the plan, whatever item it is on or none, and nothing else", async () => {
    const held = await prisma.takeoffItem.create({ data: { companyId: context.companyId, jobId: s.jobId, name: HELD_ITEM, type: "LINEAR", colorHex: "#999999" } });
    await prisma.takeoffMeasurement.create({ data: { pageId: s.pageA, calibrationId: s.calA, kind: "LINEAR", source: "DETECTED", xs: [0.5, 0.6], ys: [0.7, 0.7], itemId: held.id, label: HELD_LABEL } });
    await prisma.takeoffMeasurement.create({ data: { pageId: s.pageA, calibrationId: s.calA, kind: "LINEAR", source: "MANUAL", xs: [0.5, 0.55], ys: [0.8, 0.8], itemId: null } });
    const stored = (await prisma.takeoffMeasurement.findMany({ where: { page: { planId: s.planA }, kind: "LINEAR" }, select: { xs: true, ys: true } })).reduce((n, m) => n + Math.hypot(m.xs[1]! - m.xs[0]!, m.ys[1]! - m.ys[0]!) * 100, 0);
    const shown = (await takeoff.previewDeleteTakeoffPlan(s.jobId, s.planA)) as { ok: true; value: { wallFeet: number } };
    expect(Math.round(stored)).toBe(85); // 30 + 40 + 10 held + 5 by hand
    expect(shown.value.wallFeet).toBe(Math.round(stored));
  });
});

describe("U2: a deleted plan is not read by the ingest runner", () => {
  it("its unfinished run is not picked while it is deleted, and is again after Undo", async () => {
    const { nextJobToDrain } = await import("@/lib/plan-ingest/claim");
    const run = await prisma.planIngestJob.create({ data: { planId: s.planA, companyId: context.companyId, stage: "PAGE_INVENTORY", pageCount: 1, tasks: { create: [{ pageNumber: 1, stage: "PAGE_INVENTORY" }] } } });
    expect(await nextJobToDrain(new Date(), [s.planA])).toBe(run.id);
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    expect(await nextJobToDrain(new Date(), [s.planA])).toBeNull();
    expect((await undo(s.jobId, s.planA)).ok).toBe(true);
    expect(await nextJobToDrain(new Date(), [s.planA])).toBe(run.id);
  });
});
