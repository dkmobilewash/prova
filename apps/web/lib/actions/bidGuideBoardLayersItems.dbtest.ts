import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { STARTER_TYPES } from "@/lib/wall-type-starters";

/**
 * The board-layer tap answer with TRACED WALLS on the job, against a real
 * Postgres, through `runGuideAction` — the real `updateWallType`,
 * `refreshWallSchedule` and `syncTakeoffItemLines` do the writing.
 *
 * THE DEFECT IT PINS: the answer re-ran only the wall schedule's sync. A job
 * with W1 RUNS and a traced W1 TAKEOFF ITEM, both on the estimate, answered
 * "2 layers each side": the run lines doubled their board and the item lines
 * did not — until an unrelated Send of the takeoff doubled them silently.
 *
 * Also: a type used ONLY through a takeoff item is asked about, with the
 * item's traced footage, and answering it creates no item lines that nobody
 * sent. SCRATCH database only (vitest.db.setup.mts).
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { runGuideAction } = await import("@/lib/actions/bidGuide");
const { refreshWallSchedule } = await import("@/lib/actions/wallTypes");
const { sendTakeoffItemsToEstimate } = await import("@/lib/actions/takeoffItems");
const { loadJobGuideFacts } = await import("@/lib/bid/guide/facts");
const { buildJobGuide } = await import("@/lib/bid/guide/buildJobGuide");

const t = `bli_${Date.now()}`;
const W1 = `W1${t}`.toUpperCase();
const T1 = `T1${t}`.toUpperCase();
const NOW = new Date("2026-10-26T15:00:00.000Z");
const SHEETS = "⅝″ Type X board, 4x8 sheets";
const FINISH = "Hang, tape and finish ⅝″ board";
let companyId = "";
let jobId = "";
let w1 = "";
let t1 = "";
let pageId = "";
let calibrationId = "";

/** The W1 starter's parts, as `addStarterWallTypes` writes them. */
const starterParts = () => STARTER_TYPES.find((type) => type.code === "W1")!.parts.map((part, sortOrder) => ({ ...part, sortOrder }));

/** Live wall lines by `run: <part>` or `<item name>: <part>`, so every line has its own key. */
async function lines(): Promise<Record<string, number>> {
  const rows = await prisma.jobLineItem.findMany({
    where: { jobId, isDeleted: false, wallTypeComponentId: { not: null } },
    select: { description: true, quantity: true, takeoffItemId: true },
  });
  return Object.fromEntries(
    rows.map((row) => {
      const [owner, part] = row.description.split(" — ");
      return [`${row.takeoffItemId ? owner : "run"}: ${part}`, Number(row.quantity)];
    }),
  );
}

async function traceItem(name: string, wallTypeId: string, x2: number) {
  const item = await prisma.takeoffItem.create({
    data: { companyId, jobId, name, type: "LINEAR", colorHex: "#facc15", heightFt: "10", sides: 2, wallTypeId },
  });
  // The page is 100 ft across, so a trace from 0.1 to x2 is (x2 − 0.1) × 100 ft.
  await prisma.takeoffMeasurement.create({ data: { pageId, calibrationId, kind: "LINEAR", xs: [0.1, x2], ys: [0.3, 0.3], itemId: item.id } });
  return item.id;
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `BLI ${t}` } })).id;
  context.company.id = companyId;
  const gc = await prisma.contact.create({ data: { companyId, name: `GC ${t}` } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: gc.id, name: `Traced ${t}`, status: "ESTIMATE" } })).id;
  w1 = (await prisma.wallType.create({ data: { companyId, code: W1, name: "partition", defaultHeightFt: 10, components: { create: starterParts() } } })).id;
  t1 = (await prisma.wallType.create({ data: { companyId, code: T1, name: "traced only", components: { create: starterParts() } } })).id;

  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:bli.pdf", fileName: "bli.pdf" } });
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A-101", pageWidthPt: 200 } })).id;
  calibrationId = (
    await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.5, declaredDistanceFeet: "50" } })
  ).id;

  // W1: a 100 ft RUN at the type's 10 ft, and a 50 ft traced ITEM at 10 ft.
  await prisma.wallRun.create({ data: { companyId, jobId, wallTypeId: w1, label: "Corridor", lengthFt: 100 } });
  await traceItem("Lobby wall", w1, 0.6);

  // Both on the estimate, exactly as a person would have put them there.
  expect(await refreshWallSchedule(jobId)).toMatchObject({ ok: true });
  expect(await sendTakeoffItemsToEstimate(jobId)).toMatchObject({ ok: true });

  // T1: used ONLY through a 30 ft traced item, never sent to the estimate.
  await traceItem("Shaft wall", t1, 0.4);
});

afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { companyId } } } });
  await prisma.takeoffItem.deleteMany({ where: { companyId } });
  await prisma.wallRun.deleteMany({ where: { jobId } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { companyId } } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { plan: { companyId } } });
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.wallTypeComponent.deleteMany({ where: { wallType: { companyId } } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  context.company.id = companyId;
  context.role = "OWNER";
  context.jobFunction = null;
});

async function guide() {
  return buildJobGuide((await loadJobGuideFacts(companyId, jobId))!, NOW);
}

describe("the question counts traced takeoff items", () => {
  it("W1 is asked with its run AND its item, and the footage is both", async () => {
    const facts = (await loadJobGuideFacts(companyId, jobId))!;
    const byCode = Object.fromEntries(facts.wallTypes.map((type) => [type.code, type]));
    expect(byCode[W1]!.layersUnanswered).toMatchObject({ runCount: 1, itemCount: 1, sides: 2 });
    expect(byCode[W1]!.layersUnanswered!.lengthFt).toBeCloseTo(150, 6);
    // T1, used only through its item, is asked too — and counted as NOTHING else.
    expect(byCode[T1]).toMatchObject({ runCount: 0, lengthFt: 0, lineCount: 0, heightless: null });
    expect(byCode[T1]!.layersUnanswered).toMatchObject({ runCount: 0, itemCount: 1 });
    expect(byCode[T1]!.layersUnanswered!.lengthFt).toBeCloseTo(30, 6);
    expect(facts.measuredFootageFt).toBe(100); // the run only, as before
    const ask = (await guide()).ask!;
    expect(ask.id).toBe("board-layers");
    expect(ask.title).toContain(T1); // T1 sorts first
    expect(ask.body).toMatch(/^1 takeoff item of T1BLI_\d+ \(30 LF\) is counted at one layer each side/);
  });
});

describe("answering moves the run lines AND the item lines, in the same press", () => {
  it("before: one layer on both", async () => {
    expect(await lines()).toEqual({
      "run: 3⅝″ 20ga studs": 76,
      "run: 3⅝″ 20ga track, top and bottom": 200,
      // 100 × 10 × 2 = 2,000 sq ft; × 0.0313 × 1.10 → 69 sheets
      [`run: ${SHEETS}`]: 69,
      [`run: ${FINISH}`]: 2000,
      // 50 × 10 × 2 = 1,000 sq ft; × 0.0313 × 1.10 → 35 sheets (an item has no stud spacing of its own, so studs follow the assembly's)
      "Lobby wall: 3⅝″ 20ga studs": 39,
      "Lobby wall: 3⅝″ 20ga track, top and bottom": 100,
      [`Lobby wall: ${SHEETS}`]: 35,
      [`Lobby wall: ${FINISH}`]: 1000,
    });
  });

  it("T1 answered: the type is set, and no item line appears that nobody sent", async () => {
    const ask = (await guide()).ask!;
    const arg = ask.actions.find((action) => action.label === "2 layers each side")!.actionArg!;
    expect(arg.startsWith(`bl:${t1}:2:`)).toBe(true);
    const before = await lines();
    expect(await runGuideAction(jobId, "setBoardLayers", arg)).toEqual({ ok: true });
    expect((await prisma.wallType.findUniqueOrThrow({ where: { id: t1 } })).boardLayers).toBe(2);
    expect(await lines()).toEqual(before);
  });

  it("W1 answered '2 layers each side': BOTH sets of lines double their board immediately; nothing else moves", async () => {
    const ask = (await guide()).ask!;
    expect(ask.title).toContain(W1);
    const arg = ask.actions.find((action) => action.label === "2 layers each side")!.actionArg!;
    expect(await runGuideAction(jobId, "setBoardLayers", arg)).toEqual({ ok: true });

    expect(await lines()).toEqual({
      "run: 3⅝″ 20ga studs": 76,
      "run: 3⅝″ 20ga track, top and bottom": 200,
      // 2,000 × 0.0313 × 2 × 1.10 = 137.72 → 138
      [`run: ${SHEETS}`]: 138,
      [`run: ${FINISH}`]: 2000,
      "Lobby wall: 3⅝″ 20ga studs": 39,
      "Lobby wall: 3⅝″ 20ga track, top and bottom": 100,
      // 1,000 × 0.0313 × 2 × 1.10 = 68.86 → 69 — in the SAME press, not at the next Send
      [`Lobby wall: ${SHEETS}`]: 69,
      [`Lobby wall: ${FINISH}`]: 1000,
    });
    // (And T1's unsent "Shaft wall" is still not on the estimate — asserted by the equality above.)

    // A later Send of the takeoff moves nothing of W1's: there is no doubling
    // left to happen. It does bring T1's traced wall on — that is what Send is
    // for — priced at the 2 layers T1 was given above.
    const settled = await lines();
    expect(await sendTakeoffItemsToEstimate(jobId)).toMatchObject({ ok: true });
    const after = await lines();
    for (const [key, quantity] of Object.entries(settled)) expect(after[key], key).toBe(quantity);
    // 30 × 10 × 2 = 600 sq ft; × 0.0313 × 2 × 1.10 = 41.3 → 42
    expect(after[`Shaft wall: ${SHEETS}`]).toBe(42);
    expect(after[`Shaft wall: ${FINISH}`]).toBe(600);
  });
});
