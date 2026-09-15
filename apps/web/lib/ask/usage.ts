import { prisma } from "@prova/db";
import type { AskUsageTotals } from "@prova/integrations";

/**
 * What the Ask box costs, and how much of it one person or one company
 * may use.
 *
 * Every question that reaches the model writes one AskUsage row when the
 * loop reports its totals (ask.prisma). The row is the bound: before a
 * question goes to the model, `askAllowance` counts the rows in a rolling
 * hour for the person and a rolling day for the company and refuses in a
 * sentence when either is at its limit. Rows rather than tokens, so a
 * question that fails is bounded exactly like one that answers — a loop
 * hammering the route with a bad key is the case this exists for.
 *
 * THE LIMITS ARE A JUDGMENT CALL, not a derived fact. A foreman asks the
 * box a handful of times a day; an office manager on invoice day maybe
 * thirty. Sixty an hour per person is far above either and far below what
 * a runaway agent produces; five hundred a day per company bounds the
 * bill at roughly the cost of a lunch. Both are one constant to retune.
 */
export const ASK_LIMITS = {
  /** Questions one person may send the model in a rolling hour. */
  perPersonPerHour: 60,
  /** Questions one company may send the model in a rolling day. */
  perCompanyPerDay: 500,
} as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type Allowance = { ok: true } | { ok: false; error: string };

export async function askAllowance(companyId: string, userId: string, now: Date = new Date()): Promise<Allowance> {
  const [person, company] = await Promise.all([
    prisma.askUsage.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - HOUR) } } }),
    prisma.askUsage.count({ where: { companyId, createdAt: { gte: new Date(now.getTime() - DAY) } } }),
  ]);
  if (person >= ASK_LIMITS.perPersonPerHour) {
    return {
      ok: false,
      error: `You've asked ${ASK_LIMITS.perPersonPerHour} questions in the last hour, which is the limit. Give it a few minutes.`,
    };
  }
  if (company >= ASK_LIMITS.perCompanyPerDay) {
    return {
      ok: false,
      error: `Your company has asked ${ASK_LIMITS.perCompanyPerDay} questions in the last day, which is the limit. It frees up as the day rolls on.`,
    };
  }
  return { ok: true };
}

/** "answered", a card ("proposal"), chips ("clarify"), or the loop's own
 * failure reason. Stored as a string so a new reason needs no migration. */
export type AskUsageOutcome = "answered" | "proposal" | "clarify" | `error:${string}`;

export type AskUsageRecord = {
  companyId: string;
  userId: string;
  model: string;
  usage: AskUsageTotals;
  outcome: AskUsageOutcome;
};

/**
 * Writes the row and one log line. A row that fails to write must not
 * cost the person their answer — the answer has already streamed — so the
 * failure is logged and swallowed here, deliberately, and the log line
 * goes out BEFORE the write so the runtime log carries the cost either
 * way. Ids only in the line; never the question.
 */
export async function recordAskUsage(record: AskUsageRecord): Promise<void> {
  const { usage } = record;
  console.log("[ask] usage", {
    companyId: record.companyId,
    userId: record.userId,
    model: record.model,
    outcome: record.outcome,
    passes: usage.passes,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  });
  try {
    await prisma.askUsage.create({
      data: {
        companyId: record.companyId,
        userId: record.userId,
        model: record.model,
        passes: usage.passes,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        outcome: record.outcome,
      },
    });
  } catch (err) {
    console.error("[ask] usage row not written", err);
  }
}

export type UsageSummary = {
  questions: number;
  inputTokens: number;
  outputTokens: number;
  byPerson: { who: string; questions: number; tokens: number }[];
};

/** The last thirty days for the settings page, grouped by who asked.
 * Counted in the database, named from the User rows that still exist. */
export async function usageSummary(companyId: string, now: Date = new Date()): Promise<UsageSummary> {
  const since = new Date(now.getTime() - 30 * DAY);
  const groups = await prisma.askUsage.groupBy({
    by: ["userId"],
    where: { companyId, createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true },
  });
  const ids = groups.map((g) => g.userId).filter((id): id is string => id !== null);
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const byPerson = groups
    .map((g) => ({
      who: (g.userId && nameOf.get(g.userId)) || "a removed account",
      questions: g._count._all,
      tokens: (g._sum.inputTokens ?? 0) + (g._sum.outputTokens ?? 0),
    }))
    .sort((a, b) => b.questions - a.questions);
  return {
    questions: groups.reduce((n, g) => n + g._count._all, 0),
    inputTokens: groups.reduce((n, g) => n + (g._sum.inputTokens ?? 0), 0),
    outputTokens: groups.reduce((n, g) => n + (g._sum.outputTokens ?? 0), 0),
    byPerson,
  };
}
