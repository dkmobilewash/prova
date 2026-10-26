import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * `loadBidLog` against a real Postgres.
 *
 * The pure module's tests own the definitions. These own the conversion the
 * unit suite never executes: `bidAmount` and the line items' quantity and unit
 * price arriving as Prisma Decimals, `dueDate` as a Date, a deleted line still
 * being in the table, and — the case worth the file — a LOST bid linked to the
 * job it was priced on, whose job must not become a "contract".
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadBidLog } = await import("./bid-pipeline-query");

const TODAY = "2026-10-25";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let companyId = "";
let otherCompanyId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Bid Log Test Co" } });
  companyId = company.id;
  const other = await prisma.company.create({ data: { name: "Someone Else's Bids" } });
  otherCompanyId = other.id;
  const gc = await prisma.contact.create({ data: { companyId, name: "Acme Builders" } });
  const otherGc = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "Not Ours" } });

  // A won job worth 2 × $45,000.25 + 1 × $10,000 = $100,000.50, plus a DELETED
  // line that must not count.
  const wonJob = await prisma.job.create({ data: { companyId, contactId: gc.id, name: "Won job", status: "CONTRACTED" } });
  await prisma.jobLineItem.createMany({
    data: [
      { jobId: wonJob.id, description: "Board", quantity: "2", unitPrice: "45000.25" },
      { jobId: wonJob.id, description: "Tape", quantity: "1", unitPrice: "10000" },
      { jobId: wonJob.id, description: "Removed", quantity: "1", unitPrice: "999999", isDeleted: true },
    ],
  });
  // The estimate a LOST bid was priced on, linked as "same piece of work".
  const lostEstimate = await prisma.job.create({ data: { companyId, contactId: gc.id, name: "Lost estimate", status: "ESTIMATE" } });
  await prisma.jobLineItem.create({ data: { jobId: lostEstimate.id, description: "Board", quantity: "1", unitPrice: "500000" } });

  await prisma.bidInvitation.createMany({
    data: [
      { companyId, contactId: gc.id, projectName: "Won", status: "WON", bidAmount: "95000.50", dueDate: day("2026-10-02"), wonJobId: wonJob.id },
      { companyId, contactId: gc.id, projectName: "Lost", status: "LOST", bidAmount: "480000", dueDate: day("2026-09-15"), wonJobId: lostEstimate.id },
      { companyId, contactId: gc.id, projectName: "Won, no job", status: "WON", bidAmount: "20000", dueDate: day("2026-03-01") },
      { companyId, contactId: gc.id, projectName: "Waiting", status: "SUBMITTED", dueDate: day("2025-09-01") },
      { companyId, contactId: gc.id, projectName: "Not bid", status: "INVITED", bidAmount: "1", dueDate: day("2026-10-01") },
      { companyId, contactId: gc.id, projectName: "Declined", status: "DECLINED", dueDate: day("2026-10-01") },
      { companyId: otherCompanyId, contactId: otherGc.id, projectName: "Theirs", status: "WON", bidAmount: "1", dueDate: day("2026-10-01") },
    ],
  });
});

afterAll(async () => {
  for (const id of [companyId, otherCompanyId]) {
    await prisma.bidInvitation.deleteMany({ where: { companyId: id } });
    await prisma.jobLineItem.deleteMany({ where: { job: { companyId: id } } });
    await prisma.job.deleteMany({ where: { companyId: id } });
    await prisma.contact.deleteMany({ where: { companyId: id } });
    await prisma.company.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("loadBidLog", () => {
  it("counts this company's priced bids only — not invited, not declined, not another company's", async () => {
    const log = await loadBidLog(companyId, TODAY);
    expect(log.allTime.bids).toBe(4);
    expect(log.allTime.won).toBe(2);
    expect(log.allTime.lost).toBe(1);
    expect(log.allTime.unpricedBids).toBe(1);
    // (95,000.50 + 480,000 + 20,000) / 3, from Decimals.
    expect(log.allTime.averageBid).toBeCloseTo(198_333.5, 2);
  });

  it("values a contract from its job's live lines, and never a lost bid's linked estimate", async () => {
    const log = await loadBidLog(companyId, TODAY);
    // The won job only: $100,000.50. Not the deleted line, and not the $500,000
    // estimate the lost bid is linked to.
    expect(log.allTime.averageContract).toBeCloseTo(100_000.5, 2);
    expect(log.allTime.wonWithoutContract).toBe(1);
  });

  it("puts each bid in its due date's month", async () => {
    const log = await loadBidLog(companyId, TODAY);
    expect(log.byMonth.find((m) => m.month === "2026-10")?.record.bids).toBe(1);
    expect(log.byMonth.find((m) => m.month === "2026-09")?.record.bids).toBe(1);
    expect(log.thisYear.bids).toBe(3);
    // September 2025 is thirteen months back: all time only.
    expect(log.last12Months.bids).toBe(3);
  });
});
