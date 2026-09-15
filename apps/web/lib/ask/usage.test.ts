import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bound and the row, against a fake Prisma. Pinned: the limit refuses
 * AT the number and not one before it, in a sentence that names the
 * number; the person's window is an hour and the company's a day; a row
 * that fails to write is logged and swallowed rather than costing the
 * answer; and the summary names people from the rows that still exist.
 *
 * And since #257: an unreadable AskUsage lets the question THROUGH and is
 * shouted about, rather than taking the assistant down — with the summary
 * reporting that it could not read rather than reporting zero.
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

const { ASK_LIMITS, MIGRATE_COMMAND, askAllowance, recordAskUsage, usageSummary } = await import("./usage");

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
      readable: true,
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

/**
 * #257. The table was missing on a dev machine and every question died
 * behind "Something went wrong reading your data".
 *
 * Both cases are pinned separately on purpose. P2021 is the drift case and
 * gets a sentence naming the migrate command; anything else (a pool
 * timeout, a dropped connection) must degrade the same way, because the
 * reason to let the question through is not "the table is missing", it is
 * "usage accounting is not a precondition of answering".
 */
describe("askAllowance when AskUsage cannot be read", () => {
  const P2021 = Object.assign(new Error("The table `public.AskUsage` does not exist in the current database."), {
    code: "P2021",
  });

  it("lets the question through and says so loudly, naming the migrate command", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.prisma.askUsage.count.mockRejectedValue(P2021);

    expect(await askAllowance("co-1", "u-1", now)).toEqual({ ok: true });

    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0][0]);
    // The three things the person reading the log needs: that the question
    // was NOT bounded, which table, and the command that fixes it.
    expect(line).toContain("unbounded");
    expect(line).toContain("AskUsage table does not exist");
    expect(line).toContain(MIGRATE_COMMAND);
    error.mockRestore();
  });

  it("degrades the same way for any other read failure, with a cause that does not claim P2021", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.prisma.askUsage.count.mockRejectedValue(new Error("Timed out fetching a new connection"));

    expect(await askAllowance("co-1", "u-1", now)).toEqual({ ok: true });

    const line = String(error.mock.calls[0][0]);
    expect(line).toContain("could not be read");
    expect(line).not.toContain("does not exist");
    expect(line).toContain(MIGRATE_COMMAND);
    error.mockRestore();
  });

  it("still refuses at the limit when the count works, so failing open did not disarm the bound", async () => {
    // The mutation this guards against: a try/catch wide enough to swallow
    // the refusal itself would pass every test above and quietly remove
    // the limit.
    fake.prisma.askUsage.count.mockResolvedValueOnce(ASK_LIMITS.perPersonPerHour).mockResolvedValueOnce(0);
    const refused = await askAllowance("co-1", "u-1", now);
    expect(refused.ok).toBe(false);
  });
});

describe("usageSummary when AskUsage cannot be read", () => {
  it("reports that it could not read, rather than reporting zero", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.prisma.askUsage.groupBy.mockRejectedValue(
      Object.assign(new Error("table missing"), { code: "P2021" }),
    );

    const summary = await usageSummary("co-1", now);

    // readable:false is the whole point — the zeros beside it are
    // indistinguishable from a quiet month, and the page must not print
    // them as if they were one.
    expect(summary).toEqual({ readable: false, questions: 0, inputTokens: 0, outputTokens: 0, byPerson: [] });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain(MIGRATE_COMMAND);
    error.mockRestore();
  });

  it("does not swallow a failure in the User lookup, which is a different fault", async () => {
    // Guarded deliberately narrowly: if User is unreadable the person is
    // not signed in and this page never rendered. Swallowing it here would
    // hide a real outage behind "usage unavailable".
    fake.prisma.askUsage.groupBy.mockResolvedValue([
      { userId: "u-1", _count: { _all: 2 }, _sum: { inputTokens: 10, outputTokens: 1 } },
    ]);
    fake.prisma.user.findMany.mockRejectedValue(new Error("connection lost"));
    await expect(usageSummary("co-1", now)).rejects.toThrow("connection lost");
  });
});
