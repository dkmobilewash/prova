import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { heightBasis } from "@/lib/takeoff/wallHeights";

/**
 * ── A WALL TYPE'S HEIGHT, ANSWERED ONCE (coordination/type-height-once.md H1-H3, REVIEWED by the original 2026-11-28) ──
 *
 * A type split over level items ("W1 walls · levels 2–4", "· levels 5–9") cost one answer per item. H1: answering one
 * fills the type's OTHER items on the job whose height is still NULL (NULL-only, by decision: nothing records a person's
 * answer per item, so a defaulted or set height is never overwritten). H2: never for a type whose walls run to the
 * structure — its floor-to-floor differs by level. H3: a level item created later starts from the answer, when the
 * schedule gives the type no default and the job's items of that type agree.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Which items the sync was handed (Amendment 1): the line arithmetic is the sync's own, tested elsewhere.
const synced: string[] = [];
vi.mock("@/lib/estimating/takeoff-item-lines", async (actual) => {
  const real = await actual<typeof import("@/lib/estimating/takeoff-item-lines")>();
  return { ...real, syncDecidedItems: async (...args: Parameters<typeof real.syncDecidedItems>) => (synced.push(...args[3].filter((id): id is string => id !== null)), real.syncDecidedItems(...args)) };
});
const { setWallGroupHeight } = await import("./takeoffItems");
const { itemForType } = await import("@/lib/plan-ingest/wallItems");

const TO_STRUCTURE_NOTE = "ALL WALLS TO DECK ABOVE U.N.O.";
let companyId = "", jobId = "", pageId = "", calId = "";
let W1 = { id: "", code: "W1" }, S1 = { id: "", code: "S1" };

async function item(name: string, wallTypeId: string, heightFt: number | null, feet = 30) {
  const id = (await prisma.takeoffItem.create({ data: { companyId, jobId, name, type: "LINEAR", colorHex: "#888888", wallTypeId, heightFt, sides: 2 } })).id;
  // One run of `feet` at 100 ft per page width, so the line has board to price.
  await prisma.takeoffMeasurement.create({ data: { pageId, calibrationId: calId, kind: "LINEAR", xs: [0, feet / 100], ys: [0.5, 0.5], label: name, source: "DETECTED", itemId: id } });
  return id;
}
const heightOf = async (id: string) => {
  const h = (await prisma.takeoffItem.findUniqueOrThrow({ where: { id }, select: { heightFt: true } })).heightFt;
  return h === null ? null : Number(h);
};

beforeAll(async () => {
  // The fixture's premise, checked rather than assumed: the note IS a to-structure line.
  expect(heightBasis(TO_STRUCTURE_NOTE)?.kind).toBe("to-structure");
  companyId = (await prisma.company.create({ data: { name: "Type Height Once Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `tho_${Date.now()}`, email: `tho_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Type Height Once", status: "ESTIMATE" } })).id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } });
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } })).id;
  calId = (await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } })).id;
  W1 = { id: (await prisma.wallType.create({ data: { companyId, code: "W1", name: "Partition W1" } })).id, code: "W1" };
  S1 = { id: (await prisma.wallType.create({ data: { companyId, code: "S1", name: "Shaft S1", notes: TO_STRUCTURE_NOTE } })).id, code: "S1" };
});

describe("H1: one answer fills the type's other NULL items on the job", () => {
  it("answering levels 2–4 sets levels 5–9 too, and hands it to the same estimate sync as the answered item", async () => {
    const low = await item("W1 walls · levels 2–4", W1.id, null);
    const high = await item("W1 walls · levels 5–9", W1.id, null, 40);
    synced.length = 0;
    expect((await setWallGroupHeight(jobId, low, 9)).ok).toBe(true);
    expect(await heightOf(high)).toBe(9);
    expect(synced).toEqual(expect.arrayContaining([low, high]));
  });

  it("H1 never overwrites a height already on an item (a person's, or the schedule's default)", async () => {
    const a = await item("W1 walls · level 10", W1.id, null);
    const set = await item("W1 walls · level 11", W1.id, 8);
    expect((await setWallGroupHeight(jobId, a, 12)).ok).toBe(true);
    expect(await heightOf(set)).toBe(8);
  });
});

describe("H2: a type whose walls run to the structure is answered per level, as today", () => {
  it("answering one S1 level item leaves its other level items NULL", async () => {
    const low = await item("S1 walls · levels 2–4", S1.id, null);
    const high = await item("S1 walls · levels 5–9", S1.id, null);
    expect((await setWallGroupHeight(jobId, low, 11)).ok).toBe(true);
    expect(await heightOf(high)).toBeNull();
  });
});

describe("H3: a level item created later starts from the type's answer", () => {
  it("with no schedule default, a new W2 level takes the height its existing items agree on", async () => {
    const W2 = await prisma.wallType.create({ data: { companyId, code: "W2", name: "Partition W2" } });
    const first = await item("W2 walls · levels 2–4", W2.id, null);
    expect((await setWallGroupHeight(jobId, first, 10)).ok).toBe(true);
    const created = await prisma.$transaction((tx) => itemForType(tx, companyId, jobId, { id: W2.id, code: "W2" } as never, { defaultHeightFt: null, sides: 2 }, "levels 5–9"));
    expect(await heightOf(created)).toBe(10);
  });
  it("with a schedule default, a new level item takes the default (NULL-only: the answer does not reach defaults)", async () => {
    const W3 = await prisma.wallType.create({ data: { companyId, code: "W3", name: "Partition W3", defaultHeightFt: "9" } });
    const first = await item("W3 walls · levels 2–4", W3.id, null);
    expect((await setWallGroupHeight(jobId, first, 12)).ok).toBe(true);
    const created = await prisma.$transaction((tx) => itemForType(tx, companyId, jobId, { id: W3.id, code: "W3" } as never, { defaultHeightFt: "9", sides: 2 }, "levels 5–9"));
    expect(await heightOf(created)).toBe(9);
  });
  it("when the job's items of the type disagree, a new level item takes nothing", async () => {
    const W4 = await prisma.wallType.create({ data: { companyId, code: "W4", name: "Partition W4" } });
    await item("W4 walls · level 2", W4.id, 9);
    await item("W4 walls · level 3", W4.id, 10);
    const created = await prisma.$transaction((tx) => itemForType(tx, companyId, jobId, { id: W4.id, code: "W4" } as never, { defaultHeightFt: null, sides: 2 }, "level 4"));
    expect(await heightOf(created)).toBeNull();
  });
  it("a to-structure type's new level item takes nothing from its other levels", async () => {
    const created = await prisma.$transaction((tx) => itemForType(tx, companyId, jobId, { id: S1.id, code: "S1" } as never, { defaultHeightFt: null, sides: 2 }, "level 12"));
    expect(await heightOf(created)).toBeNull();
  });
});

describe("H4: the queue's Undo puts back everything one answer did", () => {
  it("restores the answered item AND the items it filled, using the payload the queue sends", async () => {
    const { undoSheetSuggestions } = await import("./wallGroupType");
    const { heightUndoItems } = await import("@/lib/takeoff/typeHeightOnce");
    const W5 = await prisma.wallType.create({ data: { companyId, code: "W5", name: "Partition W5" } });
    const low = await item("W5 walls · levels 2–4", W5.id, null);
    const high = await item("W5 walls · levels 5–9", W5.id, null);
    const saved = await setWallGroupHeight(jobId, low, 9);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.was.filled.map((f) => f.id)).toEqual([high]);
    expect((await undoSheetSuggestions(jobId, { moved: [], created: [], items: heightUndoItems(low, saved.value.was) })).ok).toBe(true);
    expect([await heightOf(low), await heightOf(high)]).toEqual([null, null]);
  });
});
