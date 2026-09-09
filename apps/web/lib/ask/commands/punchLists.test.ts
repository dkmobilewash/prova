import { beforeEach, describe, expect, it, vi } from "vitest";

/** add_punch_item against a fake Prisma: HANDOFF to /punch-lists, one
 * item per card, and the payload the page will prefill from. */
const fake = vi.hoisted(() => ({
  prisma: { job: { findMany: vi.fn(), findFirst: vi.fn() } },
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { addPunchItemCommand } = await import("./punchLists");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-09" };
const maple = { id: "job-1", name: "Maple Street", status: "IN_PROGRESS", contact: { name: "Turner" } };

beforeEach(() => {
  fake.prisma.job.findMany.mockReset();
  fake.prisma.job.findFirst.mockReset();
});

describe("add_punch_item", () => {
  it("is a HANDOFF to /punch-lists under MANAGE_FIELD", () => {
    expect(addPunchItemCommand.mode).toBe("HANDOFF");
    expect(addPunchItemCommand.execute).toBeUndefined();
    expect(addPunchItemCommand.handoffHref!("abc")).toBe("/punch-lists?draft=abc");
    expect(addPunchItemCommand.capability).toBe("MANAGE_FIELD");
  });

  it("asks which job before it reads anything", async () => {
    const result = await addPunchItemCommand.resolve(ctx, { description: "grid out of level" });
    expect(result.kind).toBe("need");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("asks what needs fixing once the job is known", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    const result = await addPunchItemCommand.resolve(ctx, { jobName: "Maple" });
    expect(result.kind).toBe("need");
    if (result.kind !== "need") throw new Error("unreachable");
    expect(result.missing).toMatch(/what needs fixing/);
  });

  it("refuses with the page to go to when no job matches", async () => {
    fake.prisma.job.findMany.mockResolvedValue([]);
    const result = await addPunchItemCommand.resolve(ctx, { jobName: "Nowhere", description: "x" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.href).toBe("/dashboard");
  });

  it("prefills the job and the item, in the person's words", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    const result = await addPunchItemCommand.resolve(ctx, {
      jobName: "Maple",
      description: "Ceiling grid out of level, east corridor",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Maple Street",
      description: "Ceiling grid out of level, east corridor",
    });
    expect(result.preview).toEqual([
      { label: "Job", value: "Maple Street" },
      { label: "Item", value: "Ceiling grid out of level, east corridor" },
    ]);
  });
});
