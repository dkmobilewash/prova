import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * ── DELETING A PLAN UPDATES THE ESTIMATE (Diego, 2026-11-25; coordination/plan-delete-sync.md) ──
 *
 * On main a plan delete cascaded its runs away and left every estimate line as it was: the reproduction kept
 * $1,022.50 on the estimate with the plan gone, and a later Send then retired a hand-priced line without a word.
 * Real Postgres, the real actions. Each case is one pre-registered rule (R1-R8).
 */
const context = { company: { id: "" }, companyId: "", id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/blob", async (actual) => ({ ...(await actual<typeof import("@/lib/blob")>()), deleteDocument: async () => {} }));
const takeoff = await import("./takeoff");
const { sendTakeoffItemsToEstimate } = await import("./takeoffItems");
const { AUTO_DOORS_ITEM, AUTO_DOORS_LABEL } = await import("@/lib/takeoff/autoPost");
type Impact = {
  estimateUpdates: boolean;
  wallFeet: number;
  counts: number;
  linesRetired: number;
  linesChanged: { description: string; from: string; to: string }[];
  handPriced: { description: string }[];
  totalBefore: number;
  totalAfter: number;
  signingLink: { status: string } | null;
};
type Preview = (jobId: string, planId: string) => Promise<{ ok: true; value: Impact } | { ok: false; error: string }>;
type Delete = (jobId: string, planId: string, options?: { keepHandPriced?: boolean }) => Promise<{ ok: true; value?: Impact } | { ok: false; error: string }>;
const preview = (jobId: string, planId: string) => (takeoff as unknown as { previewDeleteTakeoffPlan: Preview }).previewDeleteTakeoffPlan(jobId, planId);
const remove = takeoff.deleteTakeoffPlan as unknown as Delete;

const made: string[] = [];
afterAll(async () => {
  for (const companyId of made) {
    await prisma.signatureRequest.deleteMany({ where: { job: { companyId } } });
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

type Setup = { jobId: string; planA: string; planB: string; w1: string; untyped: string; doors: string };
let s: Setup;

/** Plan A: W1 30 ft, an untyped 40 ft run and 3 marked doors. Plan B: W1 20 ft. Sent to the estimate. */
async function setUp(status: "ESTIMATE" | "CONTRACTED" = "ESTIMATE"): Promise<Setup> {
  const companyId = (await prisma.company.create({ data: { name: "Plan Delete Co", doorScope: "DOORS_AND_FRAMES" } })).id;
  made.push(companyId);
  Object.assign(context, { companyId, company: { id: companyId } });
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `pd_${Date.now()}_${Math.random()}`, email: `pd_${Date.now()}_${Math.random()}@example.test`, role: "OWNER" } })).id;
  // Door lines need a framing trade and an assembly with a track part (`framesOpenings`, `openingFraming`).
  await prisma.companyTradeScope.create({ data: { companyId, tradeScope: "METAL_FRAMING_DRYWALL", isPrimary: true, activeSince: new Date() } });
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Plan Delete Job", status: "ESTIMATE" } })).id;
  const sheet = async (name: string, label: string) => {
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: `local:${name}.pdf`, fileName: `${name}.pdf` } });
    const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label } });
    const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
    return { planId: plan.id, pageId: page.id, calId: cal.id };
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
  if (status !== "ESTIMATE") await prisma.job.update({ where: { id: jobId }, data: { status } });
  return { jobId, planA: a.planId, planB: b.planId, w1, untyped, doors };
}

const live = (jobId: string) => prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, select: { description: true, quantity: true, unitPrice: true, takeoffItemId: true }, orderBy: { createdAt: "asc" } });
/** A wall item's track line (lin ft = the walls' feet); for any other item, all its lines. */
const qty = async (itemId: string, track = true) =>
  (await prisma.jobLineItem.findMany({ where: { takeoffItemId: itemId, isDeleted: false, ...(track ? { description: { contains: "runner track" } } : {}) }, select: { quantity: true } })).map((l) => Number(l.quantity));

describe("deleting a plan updates the estimate", () => {
  beforeEach(async () => {
    s = await setUp();
  });

  it("R1 + R3: the plan's walls and doors leave the estimate, and the items it emptied go (THE BUG)", async () => {
    // The control: the fixture really put the plan on the estimate.
    expect(await qty(s.untyped)).toEqual([40]);
    expect((await qty(s.doors, false)).length).toBeGreaterThan(0);
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    expect(await qty(s.untyped, false)).toEqual([]);
    expect(await qty(s.doors, false)).toEqual([]);
    // Since the Undo (2026-11-26, plan-delete-undo.md): the emptied items stay, empty, for the 10-minute window so Undo can
    // re-link to them; the purge removes them (planDeleteUndo.dbtest.ts U6). Empty means no run on them at all.
    expect(await prisma.takeoffMeasurement.count({ where: { itemId: { in: [s.untyped, s.doors] } } })).toBe(0);
  });

  it("R2: an item with runs on another plan keeps them, and its lines recompute (W1 50 ft -> 20 ft)", async () => {
    expect(await qty(s.w1)).toEqual([50]);
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    expect(await qty(s.w1)).toEqual([20]);
    expect(await prisma.takeoffItem.count({ where: { id: s.w1 } })).toBe(1);
  });

  it("R2: a hand-priced line of an item with runs on another plan stays on the takeoff and recomputes, keeping its price", async () => {
    const line = await prisma.jobLineItem.findFirstOrThrow({ where: { takeoffItemId: s.w1, isDeleted: false, description: { contains: "runner track" } } });
    await prisma.jobLineItem.update({ where: { id: line.id }, data: { unitPrice: "3.25" } });
    const shown = await preview(s.jobId, s.planA);
    if (!shown.ok) throw new Error(shown.error);
    expect(shown.value.handPriced.map((l) => l.description)).not.toContain(line.description);
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    const after = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: line.id } });
    expect({ takeoffItemId: after.takeoffItemId, quantity: Number(after.quantity), unitPrice: Number(after.unitPrice) }).toEqual({ takeoffItemId: s.w1, quantity: 20, unitPrice: 3.25 });
  });

  it("R4: a line priced by hand is KEPT as a typed line by default, at its quantity and price", async () => {
    const line = await prisma.jobLineItem.findFirstOrThrow({ where: { takeoffItemId: s.untyped, isDeleted: false, description: { contains: "runner track" } } });
    await prisma.jobLineItem.update({ where: { id: line.id }, data: { unitPrice: "9.00" } });
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    const kept = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: line.id } });
    expect({ isDeleted: kept.isDeleted, takeoffItemId: kept.takeoffItemId, quantity: Number(kept.quantity), unitPrice: Number(kept.unitPrice) }).toEqual({ isDeleted: false, takeoffItemId: null, quantity: 40, unitPrice: 9 });
  });

  it("R4: ...and retired when the person unticks it", async () => {
    const line = await prisma.jobLineItem.findFirstOrThrow({ where: { takeoffItemId: s.untyped, isDeleted: false, description: { contains: "runner track" } } });
    await prisma.jobLineItem.update({ where: { id: line.id }, data: { unitPrice: "9.00" } });
    expect((await remove(s.jobId, s.planA, { keepHandPriced: false })).ok).toBe(true);
    expect((await prisma.jobLineItem.findUniqueOrThrow({ where: { id: line.id } })).isDeleted).toBe(true);
  });

  it("R4: a line typed by hand from the start is never touched", async () => {
    const typed = await prisma.jobLineItem.create({ data: { jobId: s.jobId, description: "Mobilization", quantity: "1", unit: "ls", unitPrice: "500" } });
    expect((await remove(s.jobId, s.planA, { keepHandPriced: false })).ok).toBe(true);
    const after = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: typed.id } });
    expect({ isDeleted: after.isDeleted, quantity: Number(after.quantity), unitPrice: Number(after.unitPrice) }).toEqual({ isDeleted: false, quantity: 1, unitPrice: 500 });
  });

  it("R8: the preview reports exactly what the delete then does, and writes nothing", async () => {
    const line = await prisma.jobLineItem.findFirstOrThrow({ where: { takeoffItemId: s.untyped, isDeleted: false, description: { contains: "runner track" } } });
    await prisma.jobLineItem.update({ where: { id: line.id }, data: { unitPrice: "9.00" } });
    const before = JSON.stringify(await live(s.jobId));
    const shown = await preview(s.jobId, s.planA);
    if (!shown.ok) throw new Error(shown.error);
    // Nothing moved: the plan, its runs and every line are as they were.
    expect(JSON.stringify(await live(s.jobId))).toBe(before);
    expect(await prisma.takeoffPlan.count({ where: { id: s.planA } })).toBe(1);
    expect(shown.value).toMatchObject({ estimateUpdates: true, wallFeet: 70, counts: 3, handPriced: [{ description: expect.stringContaining("untyped") }] });
    expect(shown.value.linesChanged.filter((l) => l.description.includes("runner track"))).toEqual([{ description: expect.stringContaining("W1"), from: "50", to: "20" }]);
    const done = await remove(s.jobId, s.planA);
    if (!done.ok || !done.value) throw new Error("the delete returned no figures");
    // Everything but `undoUntil`: the preview's is the moment it ran, the delete's the moment it ran (plan-delete-undo.md).
    expect({ ...done.value, undoUntil: "" }).toEqual({ ...shown.value, undoUntil: "" });
    // And the figures are true: the live total moved by exactly what was shown.
    const total = (await live(s.jobId)).reduce((n, l) => n + Number(l.quantity) * Number(l.unitPrice ?? 0), 0);
    expect(total).toBeCloseTo(shown.value.totalAfter, 2);
  });

  it("R7: a signing link out with the GC is reported before the delete", async () => {
    await prisma.signatureRequest.create({ data: { jobId: s.jobId, token: `pd_${Date.now()}_${Math.random()}` } });
    const shown = await preview(s.jobId, s.planA);
    if (!shown.ok) throw new Error(shown.error);
    expect(shown.value.signingLink).toMatchObject({ status: "PENDING" });
  });
});

describe("R6: a job past estimate keeps its estimate", () => {
  it("deletes the plan and leaves every line as the contract has it", async () => {
    s = await setUp("CONTRACTED");
    const before = JSON.stringify(await live(s.jobId));
    const shown = await preview(s.jobId, s.planA);
    if (!shown.ok) throw new Error(shown.error);
    expect(shown.value.estimateUpdates).toBe(false);
    expect((await remove(s.jobId, s.planA)).ok).toBe(true);
    // Off the job, soft-deleted for the Undo window (plan-delete-undo.md U1); the purge removes the row.
    expect(await prisma.takeoffPlan.count({ where: { id: s.planA, jobId: s.jobId } })).toBe(0);
    expect(JSON.stringify(await live(s.jobId))).toBe(before);
  });
});
