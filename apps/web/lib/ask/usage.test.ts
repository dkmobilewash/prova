import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bound and the row, against a fake Prisma. Pinned: the limit refuses
 * AT the number and not one before it, in a sentence that names the
 * number; the person's window is an hour and the company's a day; a row
 * that fails to write is logged and swallowed rather than costing the
 * answer; and the summary names people from the rows that still exist.
 */
const fake = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      askUsage: { count: fn(), create: fn(), groupBy: fn() },
      user: { findMany: fn() },
    },
  };
});

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { ASK_LIMITS, askAllowance, recordAskUsage, usageSummary } = await import("./usage");

const now = new Date("2026-09-11T12:00:00.000Z");
const totals = { passes: 2, inputTokens: 9000, outputTokens: 300, cacheReadTokens: 8000, cacheWriteTokens: 0 };

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) for (const m of Object.values(model)) m.mockReset();
});

describe("askAllowance", () => {
  it("counts the person over a rolling hour and the company over a rolling day", async () => {
    fake.prisma.askUsage.count.mockResolvedValue(0);
    expect(await askAllowance("co-1", "u-1", now)).toEqual({ ok: true });
    const [personArgs, companyArgs] = fake.prisma.askUsage.count.mock.calls.map((c) => c[0]);
    expect(personArgs).toEqual({ where: { userId: "u-1", createdAt: { gte: new Date("2026-09-11T11:00:00.000Z") } } });
    expect(companyArgs).toEqual({ where: { companyId: "co-1", createdAt: { gte: new Date("2026-09-10T12:00:00.000Z") } } });
  });

  it("allows the question before the limit and refuses at it, naming the number", async () => {
    fake.prisma.askUsage.count.mockResolvedValueOnce(ASK_LIMITS.perPersonPerHour - 1).mockResolvedValueOnce(0);
    expect(await askAllowance("co-1", "u-1", now)).toEqual({ ok: true });

    fake.prisma.askUsage.count.mockResolvedValueOnce(ASK_LIMITS.perPersonPerHour).mockResolvedValueOnce(0);
    const person = await askAllowance("co-1", "u-1", now);
    expect(person.ok).toBe(false);
    if (!person.ok) expect(person.error).toContain(`${ASK_LIMITS.perPersonPerHour} questions in the last hour`);

    fake.prisma.askUsage.count.mockResolvedValueOnce(0).mockResolvedValueOnce(ASK_LIMITS.perCompanyPerDay);
    const company = await askAllowance("co-1", "u-1", now);
    expect(company.ok).toBe(false);
    if (!company.ok) expect(company.error).toContain(`${ASK_LIMITS.perCompanyPerDay} questions in the last day`);
  });
});

describe("recordAskUsage", () => {
  it("writes exactly the totals the loop reported, with the outcome", async () => {
    fake.prisma.askUsage.create.mockResolvedValue({});
    await recordAskUsage({ companyId: "co-1", userId: "u-1", model: "claude-opus-5", usage: totals, outcome: "proposal" });
    expect(fake.prisma.askUsage.create).toHaveBeenCalledWith({
      data: {
        companyId: "co-1",
        userId: "u-1",
        model: "claude-opus-5",
        passes: 2,
        inputTokens: 9000,
        outputTokens: 300,
        cacheReadTokens: 8000,
        cacheWriteTokens: 0,
        outcome: "proposal",
      },
    });
  });

  it("never throws: a row that fails to write is logged, and the answer already streamed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.prisma.askUsage.create.mockRejectedValue(new Error("connection lost"));
    await expect(
      recordAskUsage({ companyId: "co-1", userId: "u-1", model: "claude-opus-5", usage: totals, outcome: "error:api" }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("usageSummary", () => {
  it("totals thirty days and names each person, most questions first", async () => {
    fake.prisma.askUsage.groupBy.mockResolvedValue([
      { userId: "u-2", _count: { _all: 3 }, _sum: { inputTokens: 300, outputTokens: 30 } },
      { userId: "u-1", _count: { _all: 10 }, _sum: { inputTokens: 1000, outputTokens: 100 } },
      { userId: null, _count: { _all: 1 }, _sum: { inputTokens: 50, outputTokens: 5 } },
    ]);
    fake.prisma.user.findMany.mockResolvedValue([
      { id: "u-1", name: "Dana", email: "dana@example.test" },
      { id: "u-2", name: null, email: "mike@example.test" },
    ]);
    const summary = await usageSummary("co-1", now);
    expect(fake.prisma.askUsage.groupBy.mock.calls[0][0]).toMatchObject({
      where: { companyId: "co-1", createdAt: { gte: new Date("2026-08-12T12:00:00.000Z") } },
    });
    expect(summary).toEqual({
      questions: 14,
      inputTokens: 1350,
      outputTokens: 135,
      byPerson: [
        { who: "Dana", questions: 10, tokens: 1100 },
        { who: "mike@example.test", questions: 3, tokens: 330 },
        { who: "a removed account", questions: 1, tokens: 55 },
      ],
    });
  });
});
