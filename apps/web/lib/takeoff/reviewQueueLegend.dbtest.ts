import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { legendProposalFrom } from "@/lib/takeoff/legendProposalBuild";
import { loadReviewQueue } from "./reviewQueueQuery";

// The queue knows whether the set's legend was read, so a missing height can say why.
let companyId = "", jobId = "", planId = "";
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Legend State Co" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Legend", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
});
afterAll(async () => {
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.companyAiSettings.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("the review queue's legend state", () => {
  it("is off with no legend read and plan reading not opted into (Baker on the local answer-key company)", async () => {
    expect((await loadReviewQueue(companyId, jobId)).legend).toBe("off");
  });

  it("is unread once plan reading is on and the legend has not been read", async () => {
    await prisma.companyAiSettings.create({ data: { companyId, optedInFeatures: ["PLAN_TEXT_READ"] } });
    expect((await loadReviewQueue(companyId, jobId)).legend).toBe("unread");
  });

  it("is read once the set has a legend read", async () => {
    const run = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 9 } });
    const read = { types: [{ code: "S1", name: "S1", lines: ["TO DECK"] }], uno: [], reason: "r", confidence: "HIGH" as const };
    await prisma.planLegendProposal.create({ data: { ingestJobId: run.id, planId, pageNumber: 9, ...legendProposalFrom({ pageNumber: 9, sheetTitle: null, model: "m", read, crops: [] }) } });
    expect((await loadReviewQueue(companyId, jobId)).legend).toBe("read");
  });
});
