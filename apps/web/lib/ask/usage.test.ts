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
    // `feature: "ask"` is part of the shape on purpose. Since 2026-09-14 this
    // table also holds compliance extractions, WIP narratives and estimate
    // drafts, and these two ceilings are about how many QUESTIONS a person
    // may ask — without the filter, four compliance uploads would silently
    // cost somebody four of their hourly questions.
    expect(personArgs).toEqual({
      where: { userId: "u-1", feature: "ask", createdAt: { gte: new Date("2026-09-11T11:00:00.000Z") } },
    });
    expect(companyArgs).toEqual({
      where: { companyId: "co-1", feature: "ask", createdAt: { gte: new Date("2026-09-10T12:00:00.000Z") } },
    });
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
        // Defaulted, not passed: every existing call site omits it and must
        // keep landing as an Ask row.
        feature: "ask",
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
  /**
   * The fixture deliberately mixes features on ONE person. Dana has six Ask
   * questions and four document extractions, and the two figures the page
   * prints side by side have to disagree about her: every call is part of
   * the bill, only the questions are part of the limit.
   *
   * WHAT THIS PINS. `askAllowance` filters `feature: "ask"`; `usageSummary`
   * did not, and the page rendered its unfiltered total as "questions sent
   * to the model" with the Ask-only limits in the next clause. Two numbers
   * over different row sets, touching, with nothing to say so. A fixture
   * with one feature in it — which is what this test had — cannot tell the
   * two apart, and that is exactly why the drift survived the change that
   * introduced it.
   */
  it("separates the bill from the limit: every call is billed, only Ask questions are bounded", async () => {
    fake.prisma.askUsage.groupBy.mockResolvedValue([
      { userId: "u-1", feature: "ask", _count: { _all: 6 }, _sum: { inputTokens: 600, outputTokens: 60 } },
      { userId: "u-1", feature: "compliance-extract", _count: { _all: 4 }, _sum: { inputTokens: 400, outputTokens: 40 } },
      { userId: "u-2", feature: "ask", _count: { _all: 3 }, _sum: { inputTokens: 300, outputTokens: 30 } },
      { userId: null, feature: "wip-narrative", _count: { _all: 1 }, _sum: { inputTokens: 50, outputTokens: 5 } },
    ]);
    fake.prisma.user.findMany.mockResolvedValue([
      { id: "u-1", name: "Dana", email: "dana@example.test" },
      { id: "u-2", name: null, email: "mike@example.test" },
    ]);
    const summary = await usageSummary("co-1", now);
    expect(fake.prisma.askUsage.groupBy.mock.calls[0][0]).toMatchObject({
      // `outcome` joined the grouping when the number-provenance guard
      // needed a firing rate on this page. It splits the groups further and
      // changes none of the totals below, which all sum across groups —
      // asserted here so that stays a deliberate shape rather than
      // something a later reader has to re-derive.
      by: ["userId", "feature", "outcome"],
      where: { companyId: "co-1", createdAt: { gte: new Date("2026-08-12T12:00:00.000Z") } },
    });

    // 14 calls, but only 9 of them are questions — the whole point.
    expect(summary.calls).toBe(14);
    expect(summary.questions).toBe(9);
    expect(summary.inputTokens).toBe(1350);
    expect(summary.outputTokens).toBe(135);

    expect(summary.byFeature).toEqual([
      { feature: "ask", label: "Ask", calls: 9, tokens: 990 },
      { feature: "compliance-extract", label: "Document extraction", calls: 4, tokens: 440 },
      { feature: "wip-narrative", label: "WIP narrative", calls: 1, tokens: 55 },
    ]);

    // Dana's two feature rows fold into one person row.
    expect(summary.byPerson).toEqual([
      { who: "Dana", calls: 10, tokens: 1100 },
      { who: "mike@example.test", calls: 3, tokens: 330 },
      { who: "a removed account", calls: 1, tokens: 55 },
    ]);
  });

  it("shows a feature nobody has labelled under its own name rather than dropping it", async () => {
    // A set that silently shrinks is the shape this repo has paid for
    // repeatedly. A fifth caller added later must appear on the page the
    // day it ships, not the day somebody remembers to add a label.
    fake.prisma.askUsage.groupBy.mockResolvedValue([
      { userId: "u-1", feature: "takeoff-vision", _count: { _all: 2 }, _sum: { inputTokens: 10, outputTokens: 1 } },
    ]);
    fake.prisma.user.findMany.mockResolvedValue([{ id: "u-1", name: "Dana", email: "d@example.test" }]);
    const summary = await usageSummary("co-1", now);
    expect(summary.byFeature).toEqual([
      { feature: "takeoff-vision", label: "takeoff-vision", calls: 2, tokens: 11 },
    ]);
    expect(summary.calls).toBe(2);
    expect(summary.questions).toBe(0);
  });

  it("counts the answers the number-provenance guard held back, and nothing else", async () => {
    // The firing rate the settings page prints. Pinned against three other
    // outcomes in the same window — a normal answer, a card, and a
    // DIFFERENT error — because the failure worth catching here is a count
    // that quietly folds in every `error:` row and reports the box as
    // fabricating figures whenever the API is having a bad afternoon.
    fake.prisma.askUsage.groupBy.mockResolvedValue([
      { userId: "u-1", feature: "ask", outcome: "answered", _count: { _all: 40 }, _sum: { inputTokens: 1, outputTokens: 1 } },
      { userId: "u-1", feature: "ask", outcome: "error:number_provenance", _count: { _all: 2 }, _sum: { inputTokens: 1, outputTokens: 1 } },
      { userId: "u-2", feature: "ask", outcome: "error:number_provenance", _count: { _all: 1 }, _sum: { inputTokens: 1, outputTokens: 1 } },
      { userId: "u-2", feature: "ask", outcome: "error:api", _count: { _all: 7 }, _sum: { inputTokens: 1, outputTokens: 1 } },
      { userId: "u-2", feature: "ask", outcome: "proposal", _count: { _all: 3 }, _sum: { inputTokens: 1, outputTokens: 1 } },
    ]);
    fake.prisma.user.findMany.mockResolvedValue([
      { id: "u-1", name: "Dana", email: "d@example.test" },
      { id: "u-2", name: "Mike", email: "m@example.test" },
    ]);
    const summary = await usageSummary("co-1", now);
    expect(summary.blockedAnswers).toBe(3);
    // Still counted as questions: they cost a model call and they count
    // against the limits, which is what `questions` means.
    expect(summary.questions).toBe(53);
  });

  it("reports none held back as none, not as an absence", async () => {
    fake.prisma.askUsage.groupBy.mockResolvedValue([
      { userId: "u-1", feature: "ask", outcome: "answered", _count: { _all: 12 }, _sum: { inputTokens: 1, outputTokens: 1 } },
    ]);
    fake.prisma.user.findMany.mockResolvedValue([{ id: "u-1", name: "Dana", email: "d@example.test" }]);
    expect((await usageSummary("co-1", now)).blockedAnswers).toBe(0);
  });
});

describe("a lead-search row", () => {
  it("is written under its own feature — the rows the spec's cost table is replaced from — and is not an Ask row", async () => {
    fake.prisma.askUsage.create.mockResolvedValue({});
    await recordAskUsage({
      companyId: "co-1", userId: "u-1", model: "claude-opus-5", usage: { ...totals, webSearches: 3 },
      outcome: "answered", feature: "lead-search",
    });
    expect(fake.prisma.askUsage.create.mock.calls[0][0].data.feature).toBe("lead-search");
    // askAllowance counts `feature: "ask"` (pinned above), so this row can
    // never cost a person one of their hourly questions.
    fake.prisma.askUsage.count.mockResolvedValue(0);
    await askAllowance("co-1", "u-1", now);
    for (const call of fake.prisma.askUsage.count.mock.calls) expect(call[0].where.feature).toBe("ask");
  });

  it("shows on the settings page under its own name", async () => {
    fake.prisma.askUsage.groupBy.mockResolvedValue([
      { userId: "u-1", feature: "lead-search", outcome: "answered", _count: { _all: 2 }, _sum: { inputTokens: 120_000, outputTokens: 6_000 } },
    ]);
    fake.prisma.user.findMany.mockResolvedValue([{ id: "u-1", name: "Dana", email: "d@x" }]);
    const summary = await usageSummary("co-1", now);
    expect(summary.byFeature).toEqual([{ feature: "lead-search", label: "Lead search (web)", calls: 2, tokens: 126_000 }]);
    expect(summary.questions).toBe(0);
  });
});

describe("the feature label", () => {
  /* Three callers in packages/integrations/src/anthropic.ts spent money with
     no usage row until 2026-09-14. They write rows now; this is the label
     that keeps them out of the Ask ceilings. */
  it("records the caller that asked, when one is given", async () => {
    fake.prisma.askUsage.create.mockResolvedValue({});
    await recordAskUsage({
      companyId: "co-1", userId: "u-1", model: "m", usage: totals,
      outcome: "answered", feature: "compliance-extract",
    });
    expect(fake.prisma.askUsage.create.mock.calls[0][0].data.feature).toBe("compliance-extract");
  });

  it("takes a null userId, because the column is nullable and a call need not have a person", async () => {
    fake.prisma.askUsage.create.mockResolvedValue({});
    await recordAskUsage({
      companyId: "co-1", userId: null, model: "m", usage: totals,
      outcome: "answered", feature: "draft-estimate-lines",
    });
    expect(fake.prisma.askUsage.create.mock.calls[0][0].data.userId).toBeNull();
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
    expect(summary).toEqual({
      readable: false,
      questions: 0,
      calls: 0,
      // Zero held back is the same kind of lie as zero questions when the
      // table cannot be read, and `readable` is what the page reads to
      // decide not to print either.
      blockedAnswers: 0,
      inputTokens: 0,
      outputTokens: 0,
      byFeature: [],
      byPerson: [],
    });
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
