import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * start_pay_application and bill_retainage against a fake Prisma. Both are
 * HANDOFFs onto the Billing tab; pinned are the period read from the
 * person's words, that no line or amount is ever computed for the pay app,
 * the duplicate-period link, and the retainage ceiling.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findMany: vi.fn(), findFirst: vi.fn() },
    jobLineItem: { count: vi.fn() },
    invoice: { findFirst: vi.fn(), findMany: vi.fn() },
    invoiceCounter: { findUnique: vi.fn() },
    retainageRelease: { findMany: vi.fn() },
  },
}));
vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { startPayApplicationCommand, billRetainageCommand } = await import("./payApplications");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-11-04" } as const;
const fulton = { id: "job-1", name: "Fulton Rd", status: "IN_PROGRESS", contact: { name: "Turner" } };

beforeEach(() => {
  fake.prisma.job.findMany.mockReset().mockResolvedValue([fulton]);
  fake.prisma.job.findFirst.mockReset().mockResolvedValue({ status: "IN_PROGRESS" });
  fake.prisma.jobLineItem.count.mockReset().mockResolvedValue(6);
  fake.prisma.invoice.findFirst.mockReset().mockResolvedValue(null);
  fake.prisma.invoice.findMany.mockReset().mockResolvedValue([{ retainageWithheld: 5000 }, { retainageWithheld: 3000 }]);
  fake.prisma.invoiceCounter.findUnique.mockReset().mockResolvedValue({ lastNumber: 3 });
  fake.prisma.retainageRelease.findMany.mockReset().mockResolvedValue([]);
});

describe("start_pay_application", () => {
  it("is a HANDOFF to the Billing tab on MANAGE_BILLING", () => {
    expect(startPayApplicationCommand.mode).toBe("HANDOFF");
    expect(startPayApplicationCommand.capability).toBe("MANAGE_BILLING");
    expect(startPayApplicationCommand.handoffHref("card", { jobId: "job-1" })).toBe("/jobs/job-1/billing?draft=card");
  });

  it("reads 'bill Fulton for October', said in November, as October 31 this year — and carries no amount or line", async () => {
    const result = await startPayApplicationCommand.resolve(ctx, { jobName: "Fulton", period: "October" });
    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.resolved).toEqual({ form: "pay_application", jobId: "job-1", jobName: "Fulton Rd", periodTo: "2026-10-31" });
    expect(result.preview.find((l) => l.label === "Application")?.value).toMatch(/#4/);
  });

  it("asks for the period instead of assuming this month", async () => {
    expect((await startPayApplicationCommand.resolve(ctx, { jobName: "Fulton" })).kind).toBe("need");
    expect((await startPayApplicationCommand.resolve(ctx, { jobName: "Fulton", period: "the usual" })).kind).toBe("need");
  });

  it("links to the application that already runs to that day", async () => {
    fake.prisma.invoice.findFirst.mockResolvedValue({ number: 3 });
    const result = await startPayApplicationCommand.resolve(ctx, { jobName: "Fulton", period: "October" });
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.existing?.label).toMatch(/#3/);
  });

  it("refuses a job with no schedule of values, and a job that is still an estimate", async () => {
    fake.prisma.jobLineItem.count.mockResolvedValue(0);
    expect((await startPayApplicationCommand.resolve(ctx, { jobName: "Fulton", period: "October" })).kind).toBe("refuse");
    fake.prisma.job.findFirst.mockResolvedValue({ status: "ESTIMATE" });
    expect((await startPayApplicationCommand.resolve(ctx, { jobName: "Fulton", period: "October" })).kind).toBe("refuse");
  });
});

describe("bill_retainage", () => {
  it("opens with the whole balance held when no amount is said", async () => {
    const result = await billRetainageCommand.resolve(ctx, { jobName: "Fulton" });
    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.resolved).toEqual({ form: "retainage", jobId: "job-1", jobName: "Fulton Rd", amount: null, periodTo: null });
    expect(result.preview.find((l) => l.label === "Amount")?.value).toMatch(/\$8,000\.00/);
  });

  it("carries a said amount, and refuses one above what is held", async () => {
    const ok = await billRetainageCommand.resolve(ctx, { jobName: "Fulton", amount: "4,000" });
    if (ok.kind !== "ready") throw new Error("unreachable");
    expect(ok.resolved.amount).toBe("4000.00");
    expect((await billRetainageCommand.resolve(ctx, { jobName: "Fulton", amount: "9000" })).kind).toBe("refuse");
  });

  it("refuses when nothing is held", async () => {
    fake.prisma.invoice.findMany.mockResolvedValue([]);
    expect((await billRetainageCommand.resolve(ctx, { jobName: "Fulton" })).kind).toBe("refuse");
  });
});
