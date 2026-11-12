import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { STARTER_TYPES } from "@/lib/wall-type-starters";
import { RECAP_RATE_KEYS, unitPriceFromCost, type RecapRates } from "@/lib/bid-recap";

/**
 * Posted doors reach the bid, against a real Postgres: by others writes nothing; frames and doors add
 * their labor at the company's production rates, and a framing trade's opening framing from its
 * partition's own studs and track, priced off the supplier list those parts are linked to.
 */
const context = { company: { id: "" }, companyId: "", id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { syncTakeoffItemLines } = await import("./takeoff-item-lines");
const { saveDoorScope } = await import("@/lib/actions/company");
const { postAutoDoors } = await import("@/lib/plan-ingest/autoDoors");
const { AUTO_DOORS_ITEM, AUTO_DOORS_LABEL } = await import("@/lib/takeoff/autoPost");
const { applyTradePreset } = await import("@/lib/actions/tradePresets");

const MARKUP = { materialMarkupPercent: 10, laborMarkupPercent: 15, overheadPercent: 8, profitPercent: 10 };
const RATES = Object.fromEntries(RECAP_RATE_KEYS.map((k) => [k, (MARKUP as Record<string, number>)[k] ?? null])) as RecapRates;
const PRODUCTION = { crewRatePerHr: 85, doorFramesPerHr: 2, doorsPerHr: 1.5 };
const made: string[] = [];

/** A company of `trade`, its W1 the default partition with studs and track on a supplier list, and a job with `doors` posted. */
async function setUp(trade: "METAL_FRAMING_DRYWALL" | "ACOUSTICAL_CEILINGS", doors: number, defaultPartition = true) {
  const companyId = (await prisma.company.create({ data: { name: `Doors ${trade}`, autoPostOn: true } })).id;
  made.push(companyId);
  await prisma.companyTradeScope.create({ data: { companyId, tradeScope: trade, isPrimary: true, activeSince: new Date() } });
  await prisma.companyBidDefaults.create({ data: { companyId, ...MARKUP, productionRates: PRODUCTION } });
  const w1 = STARTER_TYPES.find((t) => t.code === "W1")!;
  const w1Id = (await prisma.wallType.create({ data: { companyId, code: "W1", name: w1.name, isDefaultPartition: defaultPartition, components: { create: w1.parts.map((p, i) => ({ ...p, sortOrder: i })) } } })).id;
  const vendor = await prisma.vendor.create({ data: { companyId, name: "Northgate Supply" } });
  for (const [description, unit, cost] of [['3-5/8" 20ga steel stud', "EA", "4.10"], ['3-5/8" 20ga track', "LF", "0.95"]] as const) {
    const entry = await prisma.lineItemCatalogEntry.create({ data: { companyId, description, unit, defaultBudgetedUnitCost: cost } });
    await prisma.vendorPriceQuote.create({ data: { companyId, vendorId: vendor.id, catalogEntryId: entry.id, description, unit, unitPrice: cost, quotedOn: new Date(), source: "PRICE_LIST" } });
  }
  const gc = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: gc.id, name: "Doors job", status: "ESTIMATE" } });
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId: job.id, fileUrl: "local:none.pdf", fileName: "none.pdf" } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
  const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "100" } });
  let item = "";
  if (doors > 0) {
    item = (await prisma.takeoffItem.create({ data: { companyId, jobId: job.id, name: AUTO_DOORS_ITEM, type: "COUNT", colorHex: "#111111" } })).id;
    const xs = Array.from({ length: doors }, (_, i) => 0.1 + i * 0.05);
    await prisma.takeoffMeasurement.create({ data: { itemId: item, pageId: page.id, calibrationId: calibration.id, kind: "COUNT", xs, ys: xs.map(() => 0.4), label: AUTO_DOORS_LABEL } });
  }
  context.company.id = companyId;
  context.companyId = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `door_${Date.now()}_${Math.random()}`, email: `door_${Date.now()}_${Math.random()}@example.test`, role: "OWNER" } })).id;
  return { companyId, jobId: job.id, planId: plan.id, page, calibration, item, w1Id };
}
const doorLines = (jobId: string) =>
  prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false, description: { contains: "Doors" } }, orderBy: { description: "asc" } });
const total = async (jobId: string) => (await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } })).reduce((n, l) => n + Number(l.quantity) * Number(l.unitPrice ?? 0), 0);
const setScope = (doorScope: string) => {
  const form = new FormData();
  form.set("doorScope", doorScope);
  return saveDoorScope(form);
};

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
    await prisma.vendorPriceQuote.deleteMany({ where: { companyId } });
    await prisma.vendor.deleteMany({ where: { companyId } });
    await prisma.lineItemCatalogEntry.deleteMany({ where: { companyId } });
    await prisma.companyBidDefaults.deleteMany({ where: { companyId } });
    await prisma.companyTradeScope.deleteMany({ where: { companyId } });
    await prisma.proposalClause.deleteMany({ where: { companyId } });
    await prisma.estimateTemplateItem.deleteMany({ where: { template: { companyId } } });
    await prisma.estimateTemplate.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
});

describe("posted doors on a framing company's bid", () => {
  let s: Awaited<ReturnType<typeof setUp>>;
  let before = 0;
  beforeAll(async () => {
    s = await setUp("METAL_FRAMING_DRYWALL", 3);
  });

  it("by others (the default): 3 posted doors add no line and change nothing", async () => {
    expect((await prisma.company.findUniqueOrThrow({ where: { id: s.companyId } })).doorScope).toBe("BY_OTHERS");
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, s.companyId, s.jobId));
    expect(await doorLines(s.jobId)).toEqual([]);
    before = await total(s.jobId);
  });

  it("frames: each door adds its frame install at the production rate, and the opening's studs and header off the supplier list", async () => {
    expect(await setScope("FRAMES")).toEqual({ ok: true });
    const lines = await doorLines(s.jobId);
    expect(lines.map((l) => [l.description, Number(l.quantity), l.unit, Number(l.budgetedUnitCost), l.costCategory])).toEqual([
      ["Doors — opening framing, header, 4 lin ft per door — 3⅝″ 20ga track, top and bottom", 12, "lin ft", 0.95, "MATERIAL"],
      ["Doors — opening framing, king and jack studs, 4 per door — 3⅝″ 20ga studs", 12, "ea", 4.1, "MATERIAL"],
      ["Labor — Doors — set hollow-metal frames", 3, "EA", 42.5, "LABOR"],
    ]);
    // Priced like every other line: the framing from the supplier list it is linked to, the labor at the crew rate, each through the markup.
    for (const l of lines) {
      expect(Number(l.unitPrice), l.description).toBe(Number(unitPriceFromCost({ quantity: Number(l.quantity), unitCost: Number(l.budgetedUnitCost), costCategory: l.costCategory! }, RATES)));
      if (l.costCategory === "MATERIAL") expect(l.sourceCatalogEntryId, l.description).not.toBeNull();
    }
    expect(Number(lines[2].laborHours)).toBe(1.5);
    const added = lines.reduce((n, l) => n + Number(l.quantity) * Number(l.unitPrice), 0);
    expect(await total(s.jobId)).toBeCloseTo(before + added, 2);
  });

  it("doors and frames: the doors are hung too", async () => {
    expect(await setScope("DOORS_AND_FRAMES")).toEqual({ ok: true });
    const hang = (await doorLines(s.jobId)).find((l) => l.description === "Labor — Doors — hang doors, with hardware")!;
    expect([Number(hang.quantity), hang.unit, Number(hang.laborHours), Number(hang.budgetedUnitCost)]).toEqual([3, "EA", 2, 56.67]);
  });

  it("back to by others: every door line goes, and the total is what it was", async () => {
    expect(await setScope("BY_OTHERS")).toEqual({ ok: true });
    expect(await doorLines(s.jobId)).toEqual([]);
    expect(await total(s.jobId)).toBeCloseTo(before, 2);
  });

  it("refuses an answer that is not one of the three, and a non-owner", async () => {
    expect(await setScope("ALL")).toMatchObject({ ok: false });
    context.role = "MEMBER";
    expect(await setScope("FRAMES")).toMatchObject({ ok: false, error: expect.stringContaining("owner") });
    context.role = "OWNER";
  });
});

describe("posted doors elsewhere", () => {
  it("a trade that does not frame gets the install labor and no framing", async () => {
    const s = await setUp("ACOUSTICAL_CEILINGS", 2);
    expect(await setScope("FRAMES")).toEqual({ ok: true });
    expect((await doorLines(s.jobId)).map((l) => l.description)).toEqual(["Labor — Doors — set hollow-metal frames"]);
  });

  it("doors the takeoff posts itself reach the bid at once", async () => {
    const s = await setUp("METAL_FRAMING_DRYWALL", 0);
    expect(await setScope("FRAMES")).toEqual({ ok: true });
    const posted = await postAutoDoors({ planId: s.planId, pageNumber: 1, pageId: s.page.id, calibrationId: s.calibration.id, companyId: s.companyId, jobId: s.jobId, userId: null, points: [{ x: 0.2, y: 0.4 }, { x: 0.3, y: 0.4 }] });
    expect(posted).toBe(2);
    const labor = (await doorLines(s.jobId)).find((l) => l.description === "Labor — Doors — set hollow-metal frames");
    expect(Number(labor?.quantity)).toBe(2);
    expect((await doorLines(s.jobId)).filter((l) => l.description.startsWith("Doors — opening framing")).map((l) => Number(l.quantity))).toEqual([8, 8]);
  });
});

describe("doors posted before any wall has a type (the Baker walk's order)", () => {
  it("their framing arrives when a wall is typed, though only that wall's lines were synced", async () => {
    // A preset company has no default partition, and the set's doors post while it is read.
    const s = await setUp("METAL_FRAMING_DRYWALL", 0, false);
    expect(await setScope("FRAMES")).toEqual({ ok: true });
    await postAutoDoors({ planId: s.planId, pageNumber: 1, pageId: s.page.id, calibrationId: s.calibration.id, companyId: s.companyId, jobId: s.jobId, userId: null, points: [{ x: 0.2, y: 0.4 }] });
    expect((await doorLines(s.jobId)).map((l) => l.description)).toEqual(["Labor — Doors — set hollow-metal frames"]);
    // The review queue types a run of wall as W1 and syncs that item alone.
    const walls = await prisma.takeoffItem.create({ data: { companyId: s.companyId, jobId: s.jobId, name: "W1 walls", type: "LINEAR", colorHex: "#222222", wallTypeId: s.w1Id, heightFt: "10", sides: 2 } });
    await prisma.takeoffMeasurement.create({ data: { pageId: s.page.id, calibrationId: s.calibration.id, kind: "LINEAR", source: "DETECTED", xs: [0, 0.5], ys: [0.3, 0.3], itemId: walls.id } });
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, s.companyId, s.jobId, new Set([walls.id])));
    expect((await doorLines(s.jobId)).filter((l) => l.description.startsWith("Doors — opening framing")).map((l) => Number(l.quantity))).toEqual([4, 4]);
  });
});

describe("the same choice at the trade pick", () => {
  it("a new company's trade step writes its door answer, and by others when it gives none", async () => {
    for (const [answer, stored] of [["DOORS_AND_FRAMES", "DOORS_AND_FRAMES"], [undefined, "BY_OTHERS"]] as const) {
      const companyId = (await prisma.company.create({ data: { name: "Fresh doors" } })).id;
      made.push(companyId);
      context.company.id = companyId;
      context.companyId = companyId;
      expect(await applyTradePreset("FRAMING_DRYWALL", answer)).toEqual({ ok: true });
      expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { doorScope: true } })).doorScope).toBe(stored);
    }
    expect(await applyTradePreset("FRAMING_DRYWALL", "SOMETIMES")).toMatchObject({ ok: false });
  });
});
