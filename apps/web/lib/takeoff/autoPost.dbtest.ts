import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Auto-post end to end on a scratch database, with the "printed tag" source
 * switched ON here (it is off in the product: no source clears the bar yet):
 * the WALLS stage posts the tagged group itself, labelled with its source; the
 * queue counts its feet; Undo puts it back in the queue; and a company with
 * the setting off posts nothing itself.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("./autoPost", async (actual) => ({ ...(await actual<typeof import("./autoPost")>()), autoPosts: (source: string) => source === "tag" }));
const { wallItemsForSheet, UNTYPED_ITEM } = await import("@/lib/plan-ingest/wallItems");
const { loadReviewQueue } = await import("./reviewQueueQuery");
const { undoAutoPost } = await import("@/lib/actions/wallGroupType");

let companyId = "";
let jobId = "";
let planId = "";
const tagged = [{ x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.2, thicknessFeet: 0.5 }];
const loose = [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6, thicknessFeet: 4 / 12 }];

async function sheet(pageNumber: number) {
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  await prisma.takeoffWallProposal.createMany({ data: [
    { pageId: page.id, calibrationId: cal.id, thicknessInches: 6, source: "TAG", sourceLabel: "A1", namedCode: "A1", runs: tagged },
    { pageId: page.id, calibrationId: cal.id, thicknessInches: 4, source: "REMAINDER", runs: loose },
  ] });
  return page.id;
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Auto Post Co", autoPostOn: true } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `autopost_${Date.now()}`, email: `autopost_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Auto Post Job", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
  await prisma.wallType.create({ data: { companyId, code: "A1", name: "Partition A1", thicknessIn: 6, defaultHeightFt: 10, sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
});

describe("auto-post proven items", () => {
  it("posts the proven source's group itself, labelled with its source; the queue counts it; Undo puts it back in the queue", async () => {
    const pageId = await sheet(1);
    const outcome = await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null });
    expect(outcome.kind, JSON.stringify(outcome)).toBe("written");
    if (outcome.kind !== "written") return;
    expect(Math.round(outcome.typedFeet)).toBe(30);
    expect(Math.round(outcome.untypedFeet)).toBe(30);
    const auto = await prisma.takeoffMeasurement.findFirstOrThrow({ where: { pageId, item: { wallType: { code: "A1" } } }, select: { label: true } });
    expect(auto.label).toBe("A1 wall (auto, from printed tag)");

    const before = await loadReviewQueue(companyId, jobId);
    expect(before.autoPosted?.map((a) => [a.pageNumber, Math.round(a.feet)])).toEqual([[1, 30]]);

    expect(await undoAutoPost(jobId, planId, 1)).toEqual({ ok: true, value: { runs: 1 } });
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId }, select: { label: true, item: { select: { name: true } } } });
    expect(rows.map((r) => [r.item?.name, r.label])).toEqual([[UNTYPED_ITEM, "wall, untyped"], [UNTYPED_ITEM, "wall, untyped"]]);
    const after = await loadReviewQueue(companyId, jobId);
    expect(after.autoPosted).toEqual([]);
    // Back in the queue, with the tag still suggesting A1.
    const groups = after.items.filter((i) => i.kind === "type" && i.pageNumber === 1);
    expect(groups.length).toBe(2);
    // A second Undo finds nothing to take back.
    expect(await undoAutoPost(jobId, planId, 1)).toEqual({ ok: true, value: { runs: 0 } });
  });

  it("with the company's setting OFF, nothing posts itself", async () => {
    await prisma.company.update({ where: { id: companyId }, data: { autoPostOn: false } });
    const pageId = await sheet(2);
    const outcome = await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 2, userId: null });
    expect(outcome.kind === "written" && Math.round(outcome.typedFeet)).toBe(0);
    expect(await prisma.takeoffMeasurement.count({ where: { pageId, label: { contains: "(auto, from " } } })).toBe(0);
  });

  it("refuses a sheet that is not on the job", async () => {
    expect((await undoAutoPost(jobId, planId, 99)).ok).toBe(false);
  });
});
