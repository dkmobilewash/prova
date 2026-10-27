import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `add_estimate_line` against a fake Prisma and a fake `addLineItem`.
 *
 * Pinned: a price nobody said is a QUESTION and no card; the total and the
 * bid after it are computed from the person's figures and the live lines;
 * bad figures are a sentence; and at the tap the command re-checks
 * capability and stage before writing — asserted as the exact FormData
 * handed to the job page's own action.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findMany: vi.fn(), findFirst: vi.fn() },
    jobLineItem: { findMany: vi.fn() },
  },
  addLineItem: vi.fn(),
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/actions/jobs", () => ({ addLineItem: fake.addLineItem }));

const { addEstimateLineCommand } = await import("./estimating");

const ctx = {
  companyId: "co-1",
  userId: "u-1",
  principal: { role: "OWNER", jobFunction: null },
  today: "2026-10-27",
};

const riverside = { id: "job-1", name: "Riverside Plaza", status: "ESTIMATE", contact: { name: "Turner" } };

/** $78,350.00 of priced lines, a cost-only line, and nothing deleted (the
 * query filters those — asserted below). */
const LINES = [
  { id: "l1", description: "5/8 Type X", quantity: "2800", budgetedUnitCost: "9", unitPrice: "17.50", costCategory: null },
  { id: "l2", description: "Metal framing", quantity: "1", budgetedUnitCost: null, unitPrice: "29350", costCategory: null },
  { id: "l3", description: "General conditions", quantity: "1", budgetedUnitCost: "4000", unitPrice: null, costCategory: null },
];

const CLEANUP = { jobName: "Riverside", description: "Cleanup", quantity: "40", unit: "hours", unitPrice: "$65" };

beforeEach(() => {
  fake.prisma.job.findMany.mockReset().mockResolvedValue([riverside]);
  fake.prisma.job.findFirst.mockReset().mockResolvedValue({ status: "ESTIMATE" });
  fake.prisma.jobLineItem.findMany.mockReset().mockResolvedValue(LINES);
  fake.addLineItem.mockReset().mockResolvedValue({ ok: true });
});

async function ready(input: Record<string, string>) {
  const result = await addEstimateLineCommand.resolve(ctx, input);
  if (result.kind !== "ready") throw new Error(`expected a card, got ${JSON.stringify(result)}`);
  return result;
}

const value = (result: Awaited<ReturnType<typeof ready>>, label: string) =>
  result.preview.find((line) => line.label === label)?.value;

describe("add_estimate_line.resolve", () => {
  it("computes the line and the bid after it from the person's figures and the live lines", async () => {
    const result = await ready(CLEANUP);
    expect(value(result, "Line")).toBe("Cleanup — 40 HR × $65.00 = $2,600.00");
    expect(value(result, "Bid so far")).toBe("$78,350.00");
    expect(value(result, "Bid with this line")).toBe("$80,950.00");
    expect(value(result, "Cost")).toBeUndefined();
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Riverside Plaza",
      description: "Cleanup",
      quantity: "40",
      unit: "HR",
      unitPrice: "65.00",
      unitCost: null,
      totalCents: 260_000,
    });
    expect(result.existing).toBeUndefined();
    expect(fake.prisma.jobLineItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: "job-1", isDeleted: false } }),
    );
    expect(fake.prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "co-1", status: "ESTIMATE" }) }),
    );
  });

  it("shows a cost the person gave beside the price", async () => {
    const result = await ready({ ...CLEANUP, unitCost: "$40" });
    expect(value(result, "Cost")).toBe("40 HR × $40.00 = $1,600.00");
    expect(result.resolved.unitCost).toBe("40.00");
  });

  it("asks for a price nobody said, makes no card, and reads nothing", async () => {
    const { unitPrice: _price, ...noPrice } = CLEANUP;
    void _price;
    const result = await addEstimateLineCommand.resolve(ctx, noPrice);
    expect(result).toEqual({ kind: "need", missing: "the price per unit, as the person states it — never estimate one" });
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
    expect(fake.prisma.jobLineItem.findMany).not.toHaveBeenCalled();
  });

  it("refuses bad figures with a sentence, not a card", async () => {
    for (const bad of [{ quantity: "0" }, { quantity: "-3" }, { unitPrice: "0" }, { unitPrice: "-65" }, { unitPrice: "4.505" }, { unitPrice: "2.5k" }]) {
      const result = await addEstimateLineCommand.resolve(ctx, { ...CLEANUP, ...bad });
      expect(result.kind, JSON.stringify(bad)).toBe("refuse");
    }
  });

  it("refuses a job past the estimate stage — no estimate-stage match", async () => {
    fake.prisma.job.findMany.mockResolvedValue([]);
    const result = await addEstimateLineCommand.resolve(ctx, CLEANUP);
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toMatch(/change order/);
  });

  it("refuses a chip id that is not an estimate-stage job of this company", async () => {
    fake.prisma.job.findFirst.mockResolvedValue(null);
    const { jobName: _name, ...rest } = CLEANUP;
    void _name;
    const result = await addEstimateLineCommand.resolve(ctx, { ...rest, jobId: "someone-else" });
    expect(result.kind).toBe("refuse");
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: "someone-else", companyId: "co-1", status: "ESTIMATE" },
      select: { id: true, name: true },
    });
  });

  it("links to a line already called this instead of adding a twin", async () => {
    fake.prisma.jobLineItem.findMany.mockResolvedValue([
      ...LINES,
      { id: "l4", description: "cleanup ", quantity: "10", budgetedUnitCost: null, unitPrice: "50", costCategory: null },
    ]);
    const result = await ready(CLEANUP);
    expect(result.existing).toEqual({ label: 'Riverside Plaza already has a line "Cleanup"', href: "/jobs/job-1" });
  });
});

describe("add_estimate_line.execute", () => {
  const payload = {
    jobId: "job-1",
    jobName: "Riverside Plaza",
    description: "Cleanup",
    quantity: "40",
    unit: "HR",
    unitPrice: "65.00",
    unitCost: "40.00",
    totalCents: 260_000,
  };

  it("adds the line through the job page's own action with the server-held figures", async () => {
    const result = await addEstimateLineCommand.execute(ctx, payload);
    expect(result).toMatchObject({ ok: true, message: 'Added "Cleanup" to Riverside Plaza at $2,600.00.' });
    const [jobId, form] = fake.addLineItem.mock.calls[0] as [string, FormData];
    expect(jobId).toBe("job-1");
    expect(Object.fromEntries(form.entries())).toEqual({
      description: "Cleanup",
      unit: "HR",
      quantity: "40",
      unitPrice: "65.00",
      budgetedUnitCost: "40.00",
    });
  });

  it("posts no unit and no cost when the card had none", async () => {
    await addEstimateLineCommand.execute(ctx, { ...payload, unit: null, unitCost: null });
    const [, form] = fake.addLineItem.mock.calls[0] as [string, FormData];
    expect(Object.fromEntries(form.entries())).toEqual({ description: "Cleanup", quantity: "40", unitPrice: "65.00" });
  });

  it("refuses, and writes nothing, once the job is past the estimate stage", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ status: "CONTRACTED" });
    const result = await addEstimateLineCommand.execute(ctx, payload);
    expect(result.ok).toBe(false);
    expect(fake.addLineItem).not.toHaveBeenCalled();
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({ where: { id: "job-1", companyId: "co-1" }, select: { status: true } });
  });

  it("refuses, and writes nothing, for a person without estimating access", async () => {
    for (const principal of [
      { role: "MEMBER", jobFunction: "FIELD" },
      { role: "MEMBER", jobFunction: "ACCOUNTING" },
    ]) {
      const result = await addEstimateLineCommand.execute({ ...ctx, principal }, payload);
      expect(result.ok, principal.jobFunction).toBe(false);
    }
    expect(fake.addLineItem).not.toHaveBeenCalled();
  });

  it("lets an estimator through", async () => {
    const result = await addEstimateLineCommand.execute({ ...ctx, principal: { role: "MEMBER", jobFunction: "ESTIMATOR" } }, payload);
    expect(result.ok).toBe(true);
  });

  it("refuses a card missing its price", async () => {
    const result = await addEstimateLineCommand.execute(ctx, { ...payload, unitPrice: undefined });
    expect(result.ok).toBe(false);
    expect(fake.addLineItem).not.toHaveBeenCalled();
  });

  it("passes the action's own refusal through, and turns a throw into a sentence", async () => {
    fake.addLineItem.mockResolvedValueOnce({ ok: false, error: "Description is required" });
    expect(await addEstimateLineCommand.execute(ctx, payload)).toEqual({ ok: false, error: "Description is required" });
    fake.addLineItem.mockRejectedValueOnce(new Error("boom"));
    const thrown = await addEstimateLineCommand.execute(ctx, payload);
    expect(thrown.ok).toBe(false);
  });
});
