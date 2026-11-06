import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * "Accept all suggestions on A101" from Ask, against a real Postgres, on
 * accept-sheet.spec.ts's fixture (#1020): ZA1 and ZA2 tagged on A101, and a
 * third group nothing names. The card takes the two the drawing names, at the
 * heights the queue pre-fills; the tap types both through
 * `confirmSheetSuggestions`, writes ZA1's line, and leaves the third.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { acceptSheetSuggestionsCommand } = await import("./takeoff");
const { loadReviewQueue } = await import("@/lib/takeoff/reviewQueueQuery");

let companyId = "", jobId = "", planId = "";
const ctx = () => ({ companyId, userId: context.id, principal: { role: "OWNER" as const, jobFunction: null }, today: "2026-11-06" });
const GROUPS = {
  one: { tag: "ZA1", inches: 4.875, runs: [{ x1: 0.1, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.5 }] },
  two: { tag: "ZA2", inches: 3.625, runs: [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6 }] },
  three: { tag: null, inches: 6.125, runs: [{ x1: 0.6, y1: 0.2, x2: 0.7, y2: 0.2 }] },
};

beforeAll(async () => {
  companyId = context.company.id = (await prisma.company.create({ data: { name: "ASK-ACCEPT-SHEET Co" } })).id;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `aas_${Date.now()}`, email: `aas_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const gc = await prisma.contact.create({ data: { companyId, name: "ASK-ACCEPT-SHEET GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: gc.id, name: "ASK-ACCEPT-SHEET Baker", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:S02.pdf", fileName: "S02.pdf" } })).id;
  const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 1, startedAt: new Date(), finishedAt: new Date() }, select: { id: true } });
  await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
  await prisma.planSheetProposal.create({
    data: { ingestJobId: ingest.id, planId, pageNumber: 1, proposedSheetNumber: "A101", proposedTitle: "FIRST FLOOR PLAN", proposedPageType: "PLAN", proposedScale: '1/4" = 1\'-0"', proposedReason: "seeded", proposedConfidence: "HIGH", model: "seed", promptVersion: "n/a" },
  });
  await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: ["ZA1", "ZA2"], proposals: [], reason: "seeded", confidence: "HIGH" } } });
  await prisma.wallType.create({ data: { companyId, code: "ZA1", name: "Partition to deck", defaultHeightFt: "15", sides: 2, components: { create: [{ description: "hang and finish", unit: "sq ft", basis: "BOARDED_SQFT" }] } } });
  await prisma.wallType.create({ data: { companyId, code: "ZA2", name: "Partition to ceiling", sides: 2 } });
  const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
  const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
  const at = new Date();
  for (const g of Object.values(GROUPS)) {
    await prisma.takeoffWallProposal.create({
      data: {
        pageId: sheet.id,
        calibrationId: calibration.id,
        thicknessInches: g.inches,
        createdAt: at,
        ...(g.tag === null ? { source: "REMAINDER" as const } : { source: "TAG" as const, sourceLabel: g.tag, namedCode: g.tag }),
        runs: g.runs.map((r) => ({ ...r, thicknessFeet: g.inches / 12 })),
      },
    });
  }
  const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" }, select: { id: true } });
  for (const g of Object.values(GROUPS)) {
    for (const r of g.runs) {
      await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: untyped.id, label: "wall, untyped" } });
    }
  }
});

afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffWallProposal.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { planId } });
  await prisma.takeoffPlanTextRead.deleteMany({ where: { planId } });
  await prisma.planSheetProposal.deleteMany({ where: { planId } });
  await prisma.planSheetText.deleteMany({ where: { planId } });
  await prisma.planIngestJob.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("accept all suggestions on A101, from Ask", () => {
  it("the card lists the two groups the drawing names, at the queue's heights, and writes nothing", async () => {
    const card = await acceptSheetSuggestionsCommand.resolve(ctx(), { jobName: "accept-sheet baker", sheet: "A101" });
    if (card.kind !== "ready") throw new Error(`expected ready, got ${JSON.stringify(card)}`);
    const groups = card.resolved.groups as { code: string; heightFt: number | null }[];
    expect(groups.map((g) => [g.code, g.heightFt])).toEqual([["ZA1", 15], ["ZA2", null]]);
    expect(card.preview.find((l) => l.label === "Left in the queue")?.value).toBe("1 group the drawing does not name");
    expect(await prisma.takeoffItem.count({ where: { jobId, wallType: { code: { in: ["ZA1", "ZA2"] } } } })).toBe(0);
  });

  it("the tap types both through the queue's action, writes ZA1's line, and leaves the third group in the queue", async () => {
    const card = await acceptSheetSuggestionsCommand.resolve(ctx(), { jobName: "accept-sheet baker", sheet: "A101" });
    if (card.kind !== "ready") throw new Error("expected ready");
    const done = await acceptSheetSuggestionsCommand.execute(ctx(), card.resolved);
    expect(done).toMatchObject({ ok: true, message: expect.stringMatching(/^Accepted 2 groups on A101\./) });
    expect(Number((await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, wallType: { code: "ZA1" } } })).heightFt)).toBe(15);
    expect(await prisma.jobLineItem.count({ where: { jobId, isDeleted: false, takeoffItem: { wallType: { code: "ZA1" } } } })).toBeGreaterThan(0);
    const types = (await loadReviewQueue(companyId, jobId)).items.filter((i) => i.kind === "type");
    expect(types).toHaveLength(1);
    // Nothing left that the drawing names, so asking again is refused with the queue to go to.
    expect(await acceptSheetSuggestionsCommand.resolve(ctx(), { jobName: "accept-sheet baker", sheet: "A101" })).toMatchObject({ kind: "refuse" });
  });
});
