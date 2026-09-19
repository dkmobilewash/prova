import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * findJob's miss path, on a company with no jobs at all.
 *
 * Found by the first-day audit, not by review: chip 4 ("Log today's field
 * report") on a brand-new company dead-ended twice — asked "Which job?",
 * then answered `No job matches "…"` — because the miss path assumed a
 * search that found nothing had been a search over SOMETHING. On an empty
 * account the honest answer is "you have no jobs yet", with the page that
 * fixes it, and every command that resolves a job gets that branch by
 * going through here.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { findJob } = await import("./findJob");

const ctx = {
  companyId: "co-1",
  userId: "u-1",
  principal: { role: "OWNER" as const, jobFunction: null },
  today: "2026-09-19",
};

beforeEach(() => {
  fake.prisma.job.findMany.mockReset();
  fake.prisma.job.findFirst.mockReset();
  fake.prisma.job.count.mockReset();
});

describe("findJob on a company with no jobs", () => {
  it("says there are no jobs yet and points at creating one, not at retyping the name", async () => {
    fake.prisma.job.findMany.mockResolvedValue([]);
    fake.prisma.job.count.mockResolvedValue(0);
    const result = await findJob(ctx, { jobName: "Riverside" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toMatch(/don't have any jobs yet/i);
    expect(result.reason).not.toMatch(/No job matches/);
    expect(result.href).toBe("/jobs/new");
  });

  it("still answers a plain miss with the name it searched, when jobs exist", async () => {
    fake.prisma.job.findMany.mockResolvedValue([]);
    fake.prisma.job.count.mockResolvedValue(3);
    const result = await findJob(ctx, { jobName: "Riverside" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toBe('No job matches "Riverside".');
  });

  it("does not pay for the count on the happy path", async () => {
    fake.prisma.job.findMany.mockResolvedValue([
      { id: "job-1", name: "Riverside Clinic buildout", status: "IN_PROGRESS", contact: { name: "Turner" } },
    ]);
    const result = await findJob(ctx, { jobName: "Riverside" });
    expect(result.kind).toBe("job");
    expect(fake.prisma.job.count).not.toHaveBeenCalled();
  });
});
