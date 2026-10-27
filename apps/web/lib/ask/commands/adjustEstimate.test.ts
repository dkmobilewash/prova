import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `adjust_estimate` against a fake Prisma and a fake `addLineItem`.
 *
 * Pinned: the card's figures are computed from the LIVE lines through
 * `bidTotalOf` (a deleted line and an unpriced line count nothing); the
 * model's words are the only input; a discount needs "off"; and at the tap
 * the command re-checks capability, stage and the base before writing —
 * asserted as the exact FormData handed to the job page's own action.
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

const { adjustEstimateCommand } = await import("./estimating");

const ctx = {
  companyId: "co-1",
  userId: "u-1",
  principal: { role: "OWNER", jobFunction: null },
  today: "2026-10-27",
};

const riverside = { id: "job-1", name: "Riverside Plaza", status: "ESTIMATE", contact: { name: "Turner" } };

/** $78,350.00 of priced lines, plus one cost-only line that counts $0. */
const LINES = [
  { id: "l1", description: "5/8 Type X", quantity: "2800", budgetedUnitCost: "9", unitPrice: "17.50", costCategory: null },
  { id: "l2", description: "Metal framing", quantity: "1", budgetedUnitCost: null, unitPrice: "29350", costCategory: null },
  { id: "l3", description: "General conditions", quantity: "1", budgetedUnitCost: "4000", unitPrice: null, costCategory: null },
];

beforeEach(() => {
  fake.prisma.job.findMany.mockReset().mockResolvedValue([riverside]);
  fake.prisma.job.findFirst.mockReset().mockResolvedValue({ status: "ESTIMATE" });
  fake.prisma.jobLineItem.findMany.mockReset().mockResolvedValue(LINES);
  fake.addLineItem.mockReset().mockResolvedValue({ ok: true });
});

async function ready(input: Record<string, string>) {
  const result = await adjustEstimateCommand.resolve(ctx, input);
  if (result.kind !== "ready") throw new Error(`expected a card, got ${JSON.stringify(result)}`);
  return result;
}

const value = (result: Awaited<ReturnType<typeof ready>>, label: string) =>
  result.preview.find((line) => line.label === label)?.value;

describe("adjust_estimate.resolve", () => {
  it("works 10% out of the bid as it stands, over the live lines only", async () => {
    const result = await ready({ jobName: "Riverside", kind: "percent", value: "10%", label: "Night work" });
    expect(value(result, "Line")).toBe("Night work — 10% of $78,350.00 = $7,835.00");
    expect(value(result, "Bid so far")).toBe("$78,350.00");
    expect(value(result, "Bid with this line")).toBe("$86,185.00");
    expect(value(result, "Entered as")).toBe("1 LS at $7,835.00");
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Riverside Plaza",
      kind: "percent",
      description: "Night work — 10% of $78,350.00 (the bid before this line)",
      unitPrice: "7835.00",
      amountCents: 783_500,
      baseCents: 7_835_000,
    });
    // The unpriced line is named rather than silently left out.
    expect(result.warnings.join(" ")).toMatch(/1 line has no price yet/);
    // Live lines, this job, and nothing else.
    expect(fake.prisma.jobLineItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: "job-1", isDeleted: false } }),
    );
    // Estimate-stage jobs only, in this company.
    expect(fake.prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "co-1", status: "ESTIMATE" }) }),
    );
  });

  it("puts a dollar figure on as typed", async () => {
    const result = await ready({ jobName: "Riverside", kind: "amount", value: "$2,500", label: "Mobilization" });
    expect(value(result, "Line")).toBe("Mobilization — $2,500.00");
    expect(result.resolved.unitPrice).toBe("2500.00");
    expect(result.resolved.description).toBe("Mobilization");
  });

  it("takes money off only on an explicit 'off'", async () => {
    const result = await ready({ jobName: "Riverside", kind: "percent", value: "3%", label: "GC discount", direction: "off" });
    expect(value(result, "Line")).toBe("GC discount — 3% off $78,350.00 = -$2,350.50");
    expect(value(result, "Bid with this line")).toBe("$75,999.50");
    expect(result.resolved.unitPrice).toBe("-2350.50");

    const unsaid = await adjustEstimateCommand.resolve(ctx, { jobName: "Riverside", kind: "percent", value: "-3%", label: "GC discount" });
    expect(unsaid.kind).toBe("refuse");
  });

  it("asks for what the person never said, and reads nothing", async () => {
    const result = await adjustEstimateCommand.resolve(ctx, { kind: "percent", value: "10%" });
    expect(result).toEqual({
      kind: "need",
      missing: "which job, a short name for the line in the person's own words, like 'Night work'",
    });
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("refuses absurd figures with a sentence, not a card", async () => {
    for (const input of [
      { kind: "percent", value: "150%" } as Record<string, string>,
      { kind: "percent", value: "100%", direction: "off" },
      { kind: "amount", value: "$0" },
    ]) {
      const result = await adjustEstimateCommand.resolve(ctx, { jobName: "Riverside", label: "Night work", ...input });
      expect(result.kind, JSON.stringify(input)).toBe("refuse");
    }
  });

  it("refuses a percentage of an estimate with nothing priced", async () => {
    fake.prisma.jobLineItem.findMany.mockResolvedValue([LINES[2]]);
    const result = await adjustEstimateCommand.resolve(ctx, { jobName: "Riverside", kind: "percent", value: "10%", label: "Night work" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toMatch(/no priced line/);
    expect(result.href).toBe("/jobs/job-1");
  });

  it("asks rather than guesses when the typing and the kind disagree", async () => {
    const result = await adjustEstimateCommand.resolve(ctx, { jobName: "Riverside", kind: "amount", value: "10%", label: "Night work" });
    expect(result.kind).toBe("need");
  });

  it("refuses a job past the estimate stage — no estimate-stage match", async () => {
    fake.prisma.job.findMany.mockResolvedValue([]);
    const result = await adjustEstimateCommand.resolve(ctx, { jobName: "Riverside", kind: "percent", value: "10%", label: "Night work" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toMatch(/change order/);
  });

  it("refuses a chip id that is not an estimate-stage job of this company", async () => {
    fake.prisma.job.findFirst.mockResolvedValue(null);
    const result = await adjustEstimateCommand.resolve(ctx, { jobId: "someone-else", kind: "percent", value: "10%", label: "Night work" });
    expect(result.kind).toBe("refuse");
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: "someone-else", companyId: "co-1", status: "ESTIMATE" },
      select: { id: true, name: true },
    });
  });

  it("links to a line that already says exactly this instead of adding a twin", async () => {
    fake.prisma.jobLineItem.findMany.mockResolvedValue([
      ...LINES,
      { id: "l4", description: "Mobilization", quantity: "1", budgetedUnitCost: null, unitPrice: "2500", costCategory: null },
    ]);
    const result = await ready({ jobName: "Riverside", kind: "amount", value: "$2,500", label: "Mobilization" });
    expect(result.existing?.href).toBe("/jobs/job-1");
  });
});

describe("adjust_estimate.execute", () => {
  const payload = {
    jobId: "job-1",
    jobName: "Riverside Plaza",
    kind: "percent",
    description: "Night work — 10% of $78,350.00 (the bid before this line)",
    unitPrice: "7835.00",
    amountCents: 783_500,
    baseCents: 7_835_000,
  };

  it("adds one lump-sum line through the job page's own action, with the server-held figure", async () => {
    const result = await adjustEstimateCommand.execute(ctx, payload);
    expect(result).toMatchObject({ ok: true, message: 'Added "Night work — 10% of $78,350.00 (the bid before this line)" to Riverside Plaza at $7,835.00.' });
    expect(fake.addLineItem).toHaveBeenCalledTimes(1);
    const [jobId, form] = fake.addLineItem.mock.calls[0] as [string, FormData];
    expect(jobId).toBe("job-1");
    expect(Object.fromEntries(form.entries())).toEqual({
      description: "Night work — 10% of $78,350.00 (the bid before this line)",
      unit: "LS",
      quantity: "1",
      unitPrice: "7835.00",
    });
  });

  it("refuses, and writes nothing, when the bid has moved since the card was made", async () => {
    fake.prisma.jobLineItem.findMany.mockResolvedValue([
      ...LINES,
      { id: "l5", description: "Ceilings", quantity: "1", budgetedUnitCost: null, unitPrice: "1000", costCategory: null },
    ]);
    const result = await adjustEstimateCommand.execute(ctx, payload);
    expect(result).toEqual({
      ok: false,
      error:
        "The bid on Riverside Plaza has changed since this card was made (it was $78,350.00, it is now $79,350.00). Nothing was added — ask again so the figure is worked out on the current total.",
    });
    expect(fake.addLineItem).not.toHaveBeenCalled();
  });

  it("refuses, and writes nothing, once the job is past the estimate stage", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ status: "CONTRACTED" });
    const result = await adjustEstimateCommand.execute(ctx, payload);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/past the estimate stage/);
    expect(fake.addLineItem).not.toHaveBeenCalled();
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({ where: { id: "job-1", companyId: "co-1" }, select: { status: true } });
  });

  it("refuses, and writes nothing, for a person without estimating access", async () => {
    for (const principal of [
      { role: "MEMBER", jobFunction: "FIELD" },
      { role: "MEMBER", jobFunction: "ACCOUNTING" },
    ]) {
      const result = await adjustEstimateCommand.execute({ ...ctx, principal }, payload);
      expect(result.ok, principal.jobFunction).toBe(false);
    }
    expect(fake.addLineItem).not.toHaveBeenCalled();
    expect(fake.prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it("lets an estimator through", async () => {
    const result = await adjustEstimateCommand.execute({ ...ctx, principal: { role: "MEMBER", jobFunction: "ESTIMATOR" } }, payload);
    expect(result.ok).toBe(true);
  });

  it("refuses a card whose payload is missing its base", async () => {
    const result = await adjustEstimateCommand.execute(ctx, { ...payload, baseCents: undefined });
    expect(result.ok).toBe(false);
    expect(fake.addLineItem).not.toHaveBeenCalled();
  });

  it("passes the action's own refusal through, and turns a throw into a sentence", async () => {
    fake.addLineItem.mockResolvedValueOnce({ ok: false, error: "Description is required" });
    expect(await adjustEstimateCommand.execute(ctx, payload)).toEqual({ ok: false, error: "Description is required" });

    fake.addLineItem.mockRejectedValueOnce(new Error("This job is contracted"));
    const thrown = await adjustEstimateCommand.execute(ctx, payload);
    expect(thrown.ok).toBe(false);
    if (thrown.ok) throw new Error("unreachable");
    expect(thrown.error).toMatch(/did not complete/);
  });
});
