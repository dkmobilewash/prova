import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * draft_purchase_order against a fake Prisma. Pinned: vendor and line found
 * from spoken words ("five-eighths type ex"), chips when either is
 * ambiguous, a quantity that is digits or a question, no price anywhere in
 * the payload, and the Buyout page it opens.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findMany: vi.fn(), findFirst: vi.fn() },
    vendor: { findMany: vi.fn(), findFirst: vi.fn() },
    jobLineItem: { findMany: vi.fn() },
  },
}));
vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { draftPurchaseOrderCommand } = await import("./purchaseOrders");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-11-04" } as const;
const hutto = { id: "job-1", name: "EH Hutto", status: "IN_PROGRESS", contact: { name: "Hutto GC" } };
const abc = { id: "v-1", name: "ABC Supply" };
const lines = [
  { id: "l-1", description: '5/8" Type X gypsum board', unit: "SHT" },
  { id: "l-2", description: '1/2" regular gypsum board', unit: "SHT" },
  { id: "l-3", description: "3-5/8 20ga steel stud", unit: "EA" },
];

beforeEach(() => {
  fake.prisma.job.findMany.mockReset().mockResolvedValue([hutto]);
  fake.prisma.job.findFirst.mockReset().mockResolvedValue({ status: "IN_PROGRESS" });
  fake.prisma.vendor.findMany.mockReset().mockResolvedValue([abc]);
  fake.prisma.vendor.findFirst.mockReset();
  fake.prisma.jobLineItem.findMany.mockReset().mockResolvedValue(lines);
});

const said = { jobName: "Hutto", vendorName: "ABC Supply", material: "five-eighths type ex", quantity: "200" };

describe("draft_purchase_order", () => {
  it("is a HANDOFF to the job's Buyout page, on the capability that page and draftPurchaseOrderLine check", () => {
    expect(draftPurchaseOrderCommand.mode).toBe("HANDOFF");
    expect(draftPurchaseOrderCommand.capability).toBe("VIEW_JOB_COSTS");
    expect(draftPurchaseOrderCommand.handoffHref("card", { jobId: "job-1" })).toBe("/jobs/job-1/buyout?draft=card");
  });

  it("finds ABC Supply and the 5/8 Type X line from dictation, and carries no price", async () => {
    const result = await draftPurchaseOrderCommand.resolve(ctx, said);
    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "EH Hutto",
      vendorId: "v-1",
      vendorName: "ABC Supply",
      lineItemId: "l-1",
      lineDescription: '5/8" Type X gypsum board',
      quantity: "200",
    });
    expect(JSON.stringify(result.resolved)).not.toMatch(/price/i);
  });

  it("offers chips when the material matches two lines equally", async () => {
    const result = await draftPurchaseOrderCommand.resolve(ctx, { ...said, material: "gypsum board" });
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("lineItemId");
    expect(result.options.map((o) => o.value)).toEqual(["l-1", "l-2"]);
  });

  it("refuses a material the estimate has no line for, with the Buyout page", async () => {
    const result = await draftPurchaseOrderCommand.resolve(ctx, { ...said, material: "acoustical ceiling tile" });
    expect(result).toMatchObject({ kind: "refuse", href: "/jobs/job-1/buyout" });
  });

  it("refuses a vendor that is not on the account, with the vendors page", async () => {
    fake.prisma.vendor.findMany.mockResolvedValue([]);
    const result = await draftPurchaseOrderCommand.resolve(ctx, { ...said, vendorName: "XYZ Lumber" });
    expect(result).toMatchObject({ kind: "refuse", href: "/vendors" });
  });

  it("asks for the quantity, and asks again when it is not digits", async () => {
    expect((await draftPurchaseOrderCommand.resolve(ctx, { ...said, quantity: "" })).kind).toBe("need");
    expect((await draftPurchaseOrderCommand.resolve(ctx, { ...said, quantity: "a couple hundred" })).kind).toBe("need");
  });

  it("refuses a job that is still an estimate", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ status: "ESTIMATE" });
    expect((await draftPurchaseOrderCommand.resolve(ctx, said)).kind).toBe("refuse");
  });
});
