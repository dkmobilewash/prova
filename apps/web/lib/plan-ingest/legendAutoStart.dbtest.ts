import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { queueLegendRead } from "./legendAutoStart";
import { closeIfSettled } from "./claim";

// The legend read starts itself once per set, with the company's plan-reading
// AI on — see `legendAutoStart.ts`. Nothing here calls a model: queuing a run
// is the whole of what is tested; the cron drain reads it.
let companyId = "";
let jobId = "";

async function planWithInventory(pages: number, finished: boolean) {
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } });
  const inventory = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId, stage: "PAGE_INVENTORY", pageCount: pages, ...(finished ? { finishedAt: new Date() } : {}) } });
  return { planId: plan.id, inventoryId: inventory.id };
}
const legendRuns = (planId: string) => prisma.planIngestJob.findMany({ where: { planId, stage: "WALL_LEGEND" }, select: { id: true, pageCount: true, _count: { select: { tasks: true } } } });

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Legend Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Legend Job", status: "ESTIMATE" } })).id;
});

describe("the legend read queues itself", () => {
  it("not with the company's plan-reading AI off", async () => {
    await prisma.companyAiSettings.upsert({ where: { companyId }, create: { companyId, aiEnabled: false, disabledFeatures: [], optedInFeatures: [], modelOverride: null }, update: { aiEnabled: false, optedInFeatures: [] } });
    const { planId } = await planWithInventory(12, true);
    expect(await queueLegendRead({ planId, companyId, startedByUserId: null })).toBe("ai-off");
    expect(await legendRuns(planId)).toHaveLength(0);
  });

  it("with it on: one run, a task per page — and never a second", async () => {
    await prisma.companyAiSettings.update({ where: { companyId }, data: { aiEnabled: true, optedInFeatures: ["PLAN_TEXT_READ"] } });
    const { planId } = await planWithInventory(12, true);
    expect(await queueLegendRead({ planId, companyId, startedByUserId: null })).toBe("queued");
    const runs = await legendRuns(planId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!._count.tasks).toBe(12);
    expect(await queueLegendRead({ planId, companyId, startedByUserId: null })).toBe("already");
    expect(await legendRuns(planId)).toHaveLength(1);
  });

  it("not before the set has been inventoried", async () => {
    const { planId } = await planWithInventory(5, false);
    expect(await queueLegendRead({ planId, companyId, startedByUserId: null })).toBe("not-inventoried");
  });

  it("when the inventory run closes, by itself", async () => {
    const { planId, inventoryId } = await planWithInventory(3, false);
    await prisma.planIngestTask.createMany({ data: [1, 2, 3].map((pageNumber) => ({ jobId: inventoryId, pageNumber, stage: "PAGE_INVENTORY" as const, finishedAt: new Date() })) });
    expect(await closeIfSettled(inventoryId)).toBe(true);
    const runs = await legendRuns(planId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!._count.tasks).toBe(3);
  });
});
