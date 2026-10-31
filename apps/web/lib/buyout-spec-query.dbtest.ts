import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { loadJobSpecFindings } from "./buyout-spec-query";

/** The newest reading only, through the winning bid only, inside the company. */
let companyId = "", otherCompanyId = "", jobId = "", lostJobId = "", sectionId = "", bidId = "";
const row = (label: string) => ({ ordinal: 1, kind: "NAMED_PRODUCT", label, requirement: "r", whyItCosts: "w", confidence: "HIGH", quote: label, sourcePageLabel: null });

describe("a job's spec findings", () => {
  beforeAll(async () => {
    companyId = (await prisma.company.create({ data: { name: "Finding Co" } })).id;
    otherCompanyId = (await prisma.company.create({ data: { name: "Other" } })).id;
    const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
    jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Won", status: "CONTRACTED" } })).id;
    lostJobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Other", status: "CONTRACTED" } })).id;
    bidId = (await prisma.bidInvitation.create({ data: { companyId, contactId: contact.id, projectName: "Bid", wonJobId: jobId } })).id;
    sectionId = (await prisma.bidSpecSection.create({ data: { bidInvitationId: bidId, sectionNumber: "09 21 16" } })).id;
    const base = { bidSpecSectionId: sectionId, bidInvitationId: bidId, readingReason: "r", pagesCharged: 1, model: "m", promptVersion: "1" };
    await prisma.bidSpecReading.create({ data: { ...base, findings: [row("Old")], createdAt: new Date("2026-01-01T00:00:00Z") } });
    await prisma.bidSpecReading.create({ data: { ...base, findings: [row("New")], createdAt: new Date("2026-02-01T00:00:00Z") } });
    await prisma.bidSpecSection.create({ data: { bidInvitationId: bidId, sectionNumber: "09 29 00" } });
  });

  afterAll(async () => {
    await prisma.bidInvitation.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await prisma.$disconnect();
  });

  it("reads the newest reading and skips a section nobody read", async () => {
    const sections = await loadJobSpecFindings(jobId, companyId);
    expect(sections.map((s) => [s.sectionNumber, s.findings.map((f) => f.label)])).toEqual([["09 21 16", ["New"]]]);
  });

  it("finds nothing for another job or another company", async () => {
    expect(await loadJobSpecFindings(lostJobId, companyId)).toEqual([]);
    expect(await loadJobSpecFindings(jobId, otherCompanyId)).toEqual([]);
  });
});
