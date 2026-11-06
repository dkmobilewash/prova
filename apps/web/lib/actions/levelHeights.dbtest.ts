import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { legendProposalFrom } from "@/lib/takeoff/legendProposalBuild";

// By level is automatic (Diego, 2026-11-05): a group drawn on two plans of one
// sheet — Crosslines A100's 1st floor and floors 2–9 — is two queue items, each
// pre-filled with its level's floor-to-floor, and confirms into its own item.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { confirmSheetSuggestions } = await import("./wallGroupType");
const { loadReviewQueue } = await import("@/lib/takeoff/reviewQueueQuery");
const { wallItemsForSheet } = await import("@/lib/plan-ingest/wallItems");
const { LEVEL_MARKS, PLAN_CAPTIONS } = await import("@/lib/takeoff/levelReads");

let companyId = "", jobId = "", planId = "";
// 100 ft per page width; two plans 21 ft apart.
const box = (x: number) => [
  { x1: x, y1: 0.1, x2: x + 0.3, y2: 0.1 }, { x1: x + 0.3, y1: 0.1, x2: x + 0.3, y2: 0.4 },
  { x1: x + 0.3, y1: 0.4, x2: x, y2: 0.4 }, { x1: x, y1: 0.4, x2: x, y2: 0.1 },
];
const runs = [...box(0.05), ...box(0.56)];
const mark = (level: number | null, name: string, feet: number) => ({ level, name, feet, sheet: "A300", phrase: `${name} ${feet}` });

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Level Heights Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `lvl_${Date.now()}`, email: `lvl_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Levels", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
  const run = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 9 } });
  const read = { types: [{ code: "A", name: "Partition A", lines: ['3 5/8" METAL STUDS @ 16" O.C.', "EXTEND TO BOTTOM OF STRUCTURE"] }], uno: [], reason: "r", confidence: "HIGH" as const };
  await prisma.planLegendProposal.create({ data: { ingestJobId: run.id, planId, pageNumber: 9, ...legendProposalFrom({ pageNumber: 9, sheetTitle: null, model: "m", read, crops: [] }) } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 10 } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  await prisma.takeoffWallProposal.create({ data: { pageId: page.id, calibrationId: cal.id, thicknessInches: 5, source: "REMAINDER", runs: runs.map((r) => ({ ...r, thicknessFeet: 5 / 12 })) } });
  await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: LEVEL_MARKS, value: { marks: [mark(1, "1st Floor", 754), mark(2, "2nd Floor", 763 + 8 / 12), mark(3, "3rd Floor", 772.25), mark(null, "Roof Plan", 780 + 10 / 12)] } } });
  await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 10, kind: PLAN_CAPTIONS, value: { captions: [{ name: "1st Floor Plan (P2)", captionX: 0.05, captionY: 0.45 }, { name: "2nd - 3rd Floor Plan (P2)", captionX: 0.56, captionY: 0.45 }] } } });
  expect((await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 10, userId: null })).kind).toBe("written");
});
afterAll(async () => {
  // Confirming a group writes its estimate lines at once (#1010, `syncDecidedItems`),
  // so they go before the items and the job they hang off.
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("a wall's height follows its plan's level", () => {
  it("splits the group by the plan its walls are drawn on, each with its level's floor-to-floor", async () => {
    const types = (await loadReviewQueue(companyId, jobId)).items.filter((i) => i.kind === "type");
    expect(types.map((i) => i.kind === "type" && [i.level?.label, i.runs.length, i.level?.height?.feet.toFixed(3), i.level?.codes])).toEqual([
      ["level 1", 4, "9.667", ["A"]],
      ["levels 2–3", 4, "8.583", ["A"]],
    ]);
    expect(types[0]!.kind === "type" && types[0]!.level?.height?.from).toMatch(/^floor to floor, 1st Floor: 1st Floor 754 to 2nd Floor/);
  });

  it("confirms each level into its own item at its own height", async () => {
    for (const [i, level, feet] of [[0, "level 1", 9 + 8 / 12], [1, "levels 2–3", 8 + 7 / 12]] as const) {
      const r = await confirmSheetSuggestions(jobId, [{ planId, pageNumber: 10, code: "A", inches: 5, runs: runs.slice(i * 4, i * 4 + 4), heightFt: feet, level }]);
      expect(r.ok && r.value.accepted).toBe(1);
    }
    const items = await prisma.takeoffItem.findMany({ where: { jobId, wallTypeId: { not: null } }, select: { name: true, heightFt: true, _count: { select: { measurements: true } } }, orderBy: { name: "asc" } });
    expect(items.map((i) => [i.name, Number(i.heightFt).toFixed(2), i._count.measurements])).toEqual([
      ["A walls · level 1", "9.67", 4],
      ["A walls · levels 2–3", "8.58", 4],
    ]);
    expect((await loadReviewQueue(companyId, jobId)).items.some((i) => i.kind === "type")).toBe(false);
  });

  it("refuses a level that is not one, and types into the plain item without one", async () => {
    const r = await confirmSheetSuggestions(jobId, [{ planId, pageNumber: 10, code: "A", inches: 5, runs: runs.slice(0, 1), heightFt: null, level: "levels; drop" }]);
    expect(r.ok && r.value.accepted).toBe(1);
    expect(await prisma.takeoffItem.count({ where: { jobId, name: "A walls" } })).toBe(1);
  });
});
