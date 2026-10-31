import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { loadLowerTierWaiverInputs } from "./lien-waiver-query";
import { missingLowerTierWaivers } from "./lien-waiver-followups";

/**
 * The lower-tier read, against a real Postgres: the parties are the vendors
 * with a material order on the job PLUS anyone who has ever sent a lien
 * waiver on it, and the inbound rows carry the period and status the pure
 * check reads. Composed once here the way the Billing tab composes it, so
 * the join is exercised end to end rather than mocked.
 */

let companyId = "";
let jobId = "";

describe("the lower-tier waiver inputs", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Lower Tier Co" } });
    companyId = company.id;
    const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
    const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "LT Job", status: "CONTRACTED" } });
    jobId = job.id;
    const foundation = await prisma.vendor.create({ data: { companyId, name: "Foundation Supply" } });
    const abc = await prisma.vendor.create({ data: { companyId, name: "ABC Insulation" } });
    await prisma.materialOrderCounter.create({ data: { jobId, lastNumber: 2 } });
    await prisma.materialOrder.createMany({
      data: [
        { companyId, jobId, number: 1, vendorId: foundation.id, description: "Board", orderedOn: new Date("2026-09-03T00:00:00Z") },
        { companyId, jobId, number: 2, vendorId: abc.id, description: "Batts", orderedOn: new Date("2026-09-12T00:00:00Z") },
      ],
    });
    await prisma.complianceDocument.createMany({
      data: [
        // Received, runs through September: covers the previous period.
        { companyId, jobId, type: "LIEN_WAIVER", partyName: "Foundation Supply", status: "RECEIVED", periodEnd: new Date("2026-09-30T00:00:00Z") },
        // A sub with no material order, who sent one for August only.
        { companyId, jobId, type: "LIEN_WAIVER", partyName: "Acme Scaffold", status: "RECEIVED", periodEnd: new Date("2026-08-31T00:00:00Z") },
        // Not a lien waiver: must not become a party.
        { companyId, jobId, type: "CERTIFICATE_OF_INSURANCE", partyName: "Insurer", status: "RECEIVED" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.complianceDocument.deleteMany({ where: { companyId } });
    await prisma.materialOrder.deleteMany({ where: { jobId } });
    await prisma.materialOrderCounter.deleteMany({ where: { jobId } });
    await prisma.vendor.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("names the vendors with orders and anyone who has sent a waiver, and only lien waivers as inbound", async () => {
    const inputs = await loadLowerTierWaiverInputs(jobId);
    expect([...inputs.parties].sort()).toEqual(["ABC Insulation", "Acme Scaffold", "Foundation Supply"]);
    expect(inputs.inbound.map((w) => w.partyName).sort()).toEqual(["Acme Scaffold", "Foundation Supply"]);
  });

  it("composed against September's period, names the two with nothing received through it", async () => {
    const check = missingLowerTierWaivers({
      previousPeriodTo: new Date("2026-09-30T00:00:00Z"),
      ...(await loadLowerTierWaiverInputs(jobId)),
    });
    expect(check.covered).toEqual(["Foundation Supply"]);
    expect(check.missing.sort()).toEqual(["ABC Insulation", "Acme Scaffold"]);
    expect(check.warning).toContain("no lower-tier lien waiver received through 2026-09-30 from");
  });
});
