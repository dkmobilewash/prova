import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { FIXTURE_JOB, removeBillingClickFixture, seedBillingClickFixture } from "../scripts/billingClickFixture";
import { loadPayApplication } from "./pay-application-query";

/** The click-list's figures hold on these rows, a re-run replaces the fixture
 * without doubling it, and removal leaves the company's other work alone. */
let companyId = "";
let otherJobId = "";

describe("the billing click fixture", () => {
  beforeAll(async () => {
    companyId = (await prisma.company.create({ data: { name: "Click Fixture Co" } })).id;
    const contact = await prisma.contact.create({ data: { companyId, name: "A real GC" } });
    otherJobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "A real job" } })).id;
  });

  afterAll(async () => {
    await removeBillingClickFixture(prisma, companyId);
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("produces the certificate the click-list expects, and a re-run replaces it", async () => {
    await seedBillingClickFixture(prisma, companyId);
    const { jobId, invoiceIds } = await seedBillingClickFixture(prisma, companyId);
    expect(await prisma.job.count({ where: { companyId, name: FIXTURE_JOB } })).toBe(1);
    const view = await loadPayApplication(jobId, invoiceIds[1], companyId);
    expect(view?.netChangeByChangeOrders).toBe(5000);
    expect(view?.summary).toMatchObject({
      contractSumToDate: 105000,
      totalCompletedAndStoredToDate: 47000,
      retainageToDate: 4700,
      previousCertificatesForPayment: 22500,
      currentPaymentDue: 19800,
      balanceToFinishIncludingRetainage: 62700,
    });
  });

  it("logs hours against a worker of its own, so it needs no user on the company", async () => {
    expect(await prisma.user.count({ where: { companyId } })).toBe(0);
    const job = await prisma.job.findFirstOrThrow({ where: { companyId, name: FIXTURE_JOB } });
    const entries = await prisma.timeEntry.findMany({ where: { jobId: job.id }, orderBy: { date: "asc" } });
    expect(entries.map((entry) => Number(entry.hours))).toEqual([100, 40, 60]);
    expect(await prisma.crewMember.count({ where: { companyId } })).toBe(1);
  });

  it("gives Buyout two read sections through the winning bid", async () => {
    const job = await prisma.job.findFirstOrThrow({ where: { companyId, name: FIXTURE_JOB } });
    const sections = await prisma.bidSpecSection.findMany({ where: { bidInvitation: { wonJobId: job.id } }, include: { readings: true } });
    expect(sections.map((s) => s.readings.length)).toEqual([1, 1]);
    const board = await prisma.jobLineItem.findFirstOrThrow({ where: { jobId: job.id, description: "5/8 type X board" } });
    expect(board.tradeScope).toBe("METAL_FRAMING_DRYWALL");
  });

  it("removes its own rows and nothing else", async () => {
    await removeBillingClickFixture(prisma, companyId);
    expect(await prisma.job.count({ where: { companyId, name: FIXTURE_JOB } })).toBe(0);
    expect(await prisma.vendor.count({ where: { companyId } })).toBe(0);
    expect(await prisma.crewMember.count({ where: { companyId } })).toBe(0);
    expect(await prisma.bidInvitation.count({ where: { companyId } })).toBe(0);
    expect(await prisma.job.findUnique({ where: { id: otherJobId } })).not.toBeNull();
    expect(await prisma.contact.count({ where: { companyId } })).toBe(1);
  });
});
