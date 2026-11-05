import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * start_change_order against a fake Prisma. HANDOFF, so what is pinned is
 * the payload the Estimate tab prefills from, the refusal on a job that is
 * still an estimate, the duplicate-draft link, and the page it opens.
 */
const fake = vi.hoisted(() => ({
  prisma: { job: { findMany: vi.fn(), findFirst: vi.fn() }, changeOrder: { findFirst: vi.fn() } },
}));
vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { startChangeOrderCommand } = await import("./changeOrders");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-11-04" } as const;
const clerk = { id: "job-1", name: "Clerk of Courts", status: "IN_PROGRESS", contact: { name: "Mortenson" } };

beforeEach(() => {
  fake.prisma.job.findMany.mockReset().mockResolvedValue([clerk]);
  fake.prisma.job.findFirst.mockReset().mockResolvedValue({ status: "IN_PROGRESS" });
  fake.prisma.changeOrder.findFirst.mockReset().mockResolvedValue(null);
});

describe("start_change_order", () => {
  it("is a HANDOFF to the job's Estimate tab on VIEW_JOB_COSTS, the capability createChangeOrder checks", () => {
    expect(startChangeOrderCommand.mode).toBe("HANDOFF");
    expect(startChangeOrderCommand.execute).toBeUndefined();
    expect(startChangeOrderCommand.capability).toBe("VIEW_JOB_COSTS");
    expect(startChangeOrderCommand.handoffHref("card", { jobId: "job-1" })).toBe("/jobs/job-1/estimate?draft=card");
  });

  it("prefills the person's words for 'start a change order on Clerk for 12 extra door frames'", async () => {
    const result = await startChangeOrderCommand.resolve(ctx, { jobName: "Clerk", title: "12 extra door frames" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({ jobId: "job-1", jobName: "Clerk of Courts", title: "12 extra door frames", description: null });
    expect(result.preview.map((l) => l.value)).toContain("12 extra door frames");
    expect(result.existing).toBeUndefined();
  });

  it("asks what the change is for rather than inventing a title", async () => {
    const result = await startChangeOrderCommand.resolve(ctx, { jobName: "Clerk" });
    expect(result).toEqual({ kind: "need", missing: "what the change order is for, in a few words" });
  });

  it("asks which job before it reads anything", async () => {
    const result = await startChangeOrderCommand.resolve(ctx, { title: "12 extra door frames" });
    expect(result.kind).toBe("need");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("refuses a job that is still an estimate, before the person opens a form that would refuse them", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ status: "ESTIMATE" });
    const result = await startChangeOrderCommand.resolve(ctx, { jobName: "Clerk", title: "12 extra door frames" });
    expect(result.kind).toBe("refuse");
  });

  it("links to the draft already there instead of offering a second one", async () => {
    fake.prisma.changeOrder.findFirst.mockResolvedValue({ number: 7 });
    const result = await startChangeOrderCommand.resolve(ctx, { jobName: "Clerk", title: "12 Extra Door Frames" });
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.existing?.label).toMatch(/CO 7/);
  });
});
