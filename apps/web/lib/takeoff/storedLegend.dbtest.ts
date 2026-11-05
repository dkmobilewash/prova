import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { legendProposalFrom } from "./legendProposalBuild";
import { storedLegendCodes } from "./planTextRead";

// A legend that spans pages is stored one proposal per page; the set's legend
// is every page of the newest read, not whichever page finished last.
let companyId = "";
let jobId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Stored Legend Co" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Stored Legend Job", status: "ESTIMATE" } })).id;
});

async function save(ingestJobId: string, planId: string, pageNumber: number, codes: string[]) {
  const read = { types: codes.map((code) => ({ code, name: null, lines: ["3 5/8\" METAL STUDS", "5/8\" GYP. BD. EACH SIDE"] })), uno: [], reason: "r", confidence: "HIGH" as const };
  await prisma.planLegendProposal.create({ data: { ingestJobId, planId, pageNumber, ...legendProposalFrom({ pageNumber, sheetTitle: null, model: "m", read, crops: [] }) } });
}

describe("the stored legend", () => {
  it("is every page of the newest read, merged by code", async () => {
    const planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
    const old = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 9 } });
    await save(old.id, planId, 2, ["Z"]);
    const run = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 9 } });
    await save(run.id, planId, 7, ["B", "C"]);
    await save(run.id, planId, 3, ["A", "B"]);
    expect(await storedLegendCodes(planId)).toEqual(["A", "B", "C"]);
  });
});
