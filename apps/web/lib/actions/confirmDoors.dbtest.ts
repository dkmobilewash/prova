import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

// Found doors with no printed mark: on the queue until confirmed (≈93.5% < 97%, never posted alone);
// the kept ones join the job's "Doors" count, the one the marked doors post to.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { confirmDoors, undoConfirmDoors } = await import("./symbolCount");
const { loadReviewQueue } = await import("@/lib/takeoff/reviewQueueQuery");
const { DOORS_SUGGESTED, CONFIRMED_DOORS_LABEL } = await import("@/lib/takeoff/doorSuggestions");

let companyId = "", jobId = "", planId = "";
const d = (x: number) => ({ x1: x, y1: 0.2, x2: x + 0.01, y2: 0.2 });
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Doors Confirm Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({ data: { companyId, clerkId: `doorc_${Date.now()}`, email: `doorc_${Date.now()}@example.test`, role: "OWNER" } });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Doors", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:none.pdf", fileName: "none.pdf" } })).id;
  await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 4, kind: DOORS_SUGGESTED, value: { doors: [d(0.1), d(0.2), d(0.3)] } } });
});
afterAll(async () => {
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("confirming a sheet's found doors with no printed mark", () => {
  it("is one item on the queue, and nothing is counted before it is confirmed", async () => {
    const queue = await loadReviewQueue(companyId, jobId);
    expect(queue.items.filter((i) => i.kind === "doors").map((i) => [i.key, i.kind === "doors" ? i.runs.length : 0])).toEqual([["doors:4", 3]]);
    expect(await prisma.takeoffItem.count({ where: { jobId } })).toBe(0);
  });

  it("posts only the kept doors, as one count on the job's Doors item, and leaves the queue; again adds nothing", async () => {
    const confirmed = await confirmDoors(jobId, planId, 4, [0, 2]);
    if (!confirmed.ok) throw new Error(confirmed.error);
    const counts = await prisma.takeoffMeasurement.findMany({ where: { kind: "COUNT", page: { planId } }, select: { label: true, xs: true, item: { select: { name: true, type: true } } } });
    expect(counts.map((c) => [c.label, c.xs.length, c.item?.name, c.item?.type])).toEqual([[CONFIRMED_DOORS_LABEL, 2, "Doors", "COUNT"]]);
    expect((await loadReviewQueue(companyId, jobId)).items.some((i) => i.kind === "doors")).toBe(false);
    expect(await confirmDoors(jobId, planId, 4, [0, 1, 2])).toMatchObject({ ok: true });
    expect(await prisma.takeoffMeasurement.count({ where: { kind: "COUNT", page: { planId } } })).toBe(1);
    // Undo takes the count and the item it made back, and the doors are offered again.
    expect(await undoConfirmDoors(jobId, planId, 4, confirmed.value.undo)).toEqual({ ok: true });
    expect(await prisma.takeoffMeasurement.count({ where: { kind: "COUNT", page: { planId } } })).toBe(0);
    expect(await prisma.takeoffItem.count({ where: { jobId } })).toBe(0);
    expect((await loadReviewQueue(companyId, jobId)).items.filter((i) => i.kind === "doors").map((i) => i.key)).toEqual(["doors:4"]);
  });

  it("an index that is not a door is refused", async () => {
    expect(await confirmDoors(jobId, planId, 4, [7])).toMatchObject({ ok: false });
  });
});
