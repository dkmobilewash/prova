import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * prepare_lien_waiver against a fake Prisma and a fake pay application.
 * Pinned: the amount, through date and stage are the Billing tab's own
 * offer for that application; NO exception field exists in the payload;
 * an application that already has a waiver links instead of offering one.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findMany: vi.fn(), findFirst: vi.fn() },
    invoice: { findFirst: vi.fn() },
    lienWaiver: { findFirst: vi.fn() },
  },
  loadPayApplication: vi.fn(),
}));
vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/pay-application-query", () => ({ loadPayApplication: fake.loadPayApplication }));
vi.mock("@/lib/billing/closeout-billing", () => ({ isFinalBilling: () => false }));

const { prepareLienWaiverCommand } = await import("./lienWaivers");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-11-04" } as const;
const hutto = { id: "job-1", name: "EH Hutto", status: "IN_PROGRESS", contact: { name: "Hutto GC" } };

beforeEach(() => {
  fake.prisma.job.findMany.mockReset().mockResolvedValue([hutto]);
  fake.prisma.invoice.findFirst.mockReset().mockResolvedValue({ id: "inv-4", number: 4, periodTo: new Date("2026-10-31T00:00:00Z") });
  fake.prisma.lienWaiver.findFirst.mockReset().mockResolvedValue(null);
  fake.loadPayApplication.mockReset().mockResolvedValue({ isPayApplication: true, summary: { currentPaymentDue: 41234.5 } });
});

describe("prepare_lien_waiver", () => {
  it("is a HANDOFF to the Billing tab on MANAGE_BILLING", () => {
    expect(prepareLienWaiverCommand.mode).toBe("HANDOFF");
    expect(prepareLienWaiverCommand.capability).toBe("MANAGE_BILLING");
    expect(prepareLienWaiverCommand.handoffHref("card", { jobId: "job-1" })).toBe("/jobs/job-1/billing?draft=card");
  });

  it("'send the lien waiver for Hutto pay app 4' gets the application's own figures and no exception at all", async () => {
    const result = await prepareLienWaiverCommand.resolve(ctx, { jobName: "Hutto", payAppNumber: "4" });
    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.resolved).toEqual({
      form: "waiver",
      jobId: "job-1",
      jobName: "EH Hutto",
      invoiceId: "inv-4",
      invoiceNumber: 4,
      amount: 41234.5,
      throughDate: "2026-10-31",
      stage: "PROGRESS",
    });
    expect(JSON.stringify(result.resolved)).not.toMatch(/except/i);
    expect(result.preview.find((l) => l.label === "Exceptions")?.value).toMatch(/blank/);
  });

  it("asks which pay application rather than picking the newest", async () => {
    expect((await prepareLienWaiverCommand.resolve(ctx, { jobName: "Hutto" })).kind).toBe("need");
  });

  it("refuses a number the job has no application for", async () => {
    fake.prisma.invoice.findFirst.mockResolvedValue(null);
    expect((await prepareLienWaiverCommand.resolve(ctx, { jobName: "Hutto", payAppNumber: "9" })).kind).toBe("refuse");
  });

  it("links to the waiver already issued instead of offering a second", async () => {
    fake.prisma.lienWaiver.findFirst.mockResolvedValue({ id: "w-1" });
    const result = await prepareLienWaiverCommand.resolve(ctx, { jobName: "Hutto", payAppNumber: "4" });
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.existing?.label).toMatch(/already has a waiver/);
  });

  it("refuses when nothing is due on the application", async () => {
    fake.loadPayApplication.mockResolvedValue({ isPayApplication: true, summary: { currentPaymentDue: 0 } });
    expect((await prepareLienWaiverCommand.resolve(ctx, { jobName: "Hutto", payAppNumber: "4" })).kind).toBe("refuse");
  });
});
