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
 * The bound is not a PRECONDITION, though, and that distinction cost the
 * whole assistant once (#257): when the rows cannot be read at all, the
 * question goes through and the failure is shouted into the log and onto
 * the settings page, rather than the box refusing everything behind a
 * sentence that names nothing. See askAllowance.
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

/**
 * The command that brings a database level with the code. Named in the
 * log and on the settings page rather than left to be looked up: #257 was
 * found by someone clicking a retainage command and being told
 * "Something went wrong reading your data", which pointed at neither the
 * schema nor the fix.
 */
export const MIGRATE_COMMAND = "pnpm --filter @prova/db run migrate:deploy";

/** Prisma's code for "the table does not exist in the current database" —
 * a database behind the code, as distinct from a query that is wrong. */
function tableIsMissing(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2021";
}

/**
 * One log line for "the accounting could not be read", loud and naming the
 * fix. Ids and causes only, never the question.
 */
function usageUnreadable(what: string, err: unknown): void {
  const cause = tableIsMissing(err)
    ? `the AskUsage table does not exist in this database, so it is behind the code. Run \`${MIGRATE_COMMAND}\` against it.`
    : `AskUsage could not be read. If this database is behind the code, \`${MIGRATE_COMMAND}\` fixes it.`;
  console.error(`[ask] ${what}: ${cause}`, err);
}

export type Allowance = { ok: true } | { ok: false; error: string };

export async function askAllowance(companyId: string, userId: string, now: Date = new Date()): Promise<Allowance> {
  // `feature: "ask"` is load-bearing rather than tidy. These two ceilings are
  // about how many QUESTIONS a person may ask, and since 2026-09-14 this
  // table also holds compliance extractions, WIP narratives and estimate
  // drafts. Without the filter, uploading four compliance documents would
  // silently cost somebody four of their hourly questions — a limit tightening
  // itself as a side effect of a metering change nobody connected to it.
  //
  // Bounding those three is a real and separate problem: the audit that found
  // them put compliance extraction at $2.25-$4.50 a call, which a ROW count is
  // the wrong instrument for. That wants a spend ceiling, and it is not this.
  let person: number;
  let company: number;
  try {
    [person, company] = await Promise.all([
      prisma.askUsage.count({
        where: { userId, feature: "ask", createdAt: { gte: new Date(now.getTime() - HOUR) } },
      }),
      prisma.askUsage.count({
        where: { companyId, feature: "ask", createdAt: { gte: new Date(now.getTime() - DAY) } },
      }),
    ]);
  } catch (err) {
    // FAILS OPEN, and the reason is three functions down: recordAskUsage
    // already swallows its own write failure, because the accounting must
    // not cost the person their answer. The READ was not extended the
    // same courtesy, so a database one migration behind took the whole
    // assistant down behind a sentence that named nothing (#257) — every
    // question calls this, so a missing table is not one broken command,
    // it is the feature. Answering unbounded is the lesser fault: this is
    // an internal accounting table, and the alternative is the product
    // not working.
    //
    // Said plainly because it is a real cost, not a free win: while this
    // is failing, NOTHING is bounding the model calls. That is why the
    // line below is console.error rather than a warning, and why the
    // settings page says so on screen instead of printing a reassuring
    // zero.
    //
    // Note the two now compose: a database that has AskUsage but not yet
    // its `feature` column lands here too, which is the correct outcome —
    // the question is answered rather than refused by a schema gap.
    usageUnreadable("the limit check could not run, so this question went to the model unbounded", err);
    return { ok: true };
  }
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

/**
 * Which model caller a row is.
 *
 * Until 2026-09-14 this table held Ask and nothing else, while three other
 * callers in `packages/integrations/src/anthropic.ts` spent money silently —
 * so `/settings/assistant` reported a number that was not the bill.
 *
 * A union rather than a free string, unlike `outcome`: `outcome` carries a
 * model-supplied reason and must not need a migration to gain one, but the
 * set of model CALLERS is a fact about this codebase that somebody has to
 * add code to change. Adding a caller should make the compiler ask which
 * feature it is.
 */
export type AskUsageFeature =
  | "ask"
  | "wip-narrative"
  | "compliance-extract"
  | "draft-estimate-lines";

export type AskUsageRecord = {
  companyId: string;
  /** Nullable because the column is: a model call is not guaranteed to have
   *  a person behind it. Every caller today does pass one. */
  userId: string | null;
  model: string;
  usage: AskUsageTotals;
  outcome: AskUsageOutcome;
  /** Defaults to "ask" so every existing call site is unchanged. */
  feature?: AskUsageFeature;
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
  const feature = record.feature ?? "ask";
  console.log("[ask] usage", {
    feature,
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
        feature,
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
  /**
   * False when AskUsage could not be read. Every figure is then zero —
   * and zero is the dangerous answer here, because "0 questions sent to
   * the model" is exactly what a quiet month looks like. Without this
   * flag the page would report a broken table as a reassuring fact, which
   * is the same shape as every vacuous check this repo has paid for. The
   * page reads it and says which of the two it is looking at.
   */
  readable: boolean;
  /**
   * Ask questions only — the rows `askAllowance` counts, and therefore the
   * only figure the hourly and daily limits are about.
   *
   * SPLIT FROM `calls` BECAUSE THE PAGE PRINTED ONE AND MEANT THE OTHER.
   * The `feature` column arrived so the three non-Ask callers would stop
   * spending invisibly; the limit side was filtered to `ask` the same day
   * and the reading side was not. So the settings page summed all four
   * features, called the total "questions sent to the model", and printed
   * the Ask-only limits in the next clause — two numbers over different
   * row sets, touching, with nothing to say they were different. A company
   * running document extractions saw a question count it could not
   * reconcile against a limit those rows never counted toward.
   */
  questions: number;
  /** Every model call in the window, all features. This is the one that
   * maps to the Anthropic invoice, which is what the column was for. */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Per feature, so the bill can be attributed rather than just totalled.
   * An unrecognised feature keeps its raw name instead of being dropped —
   * a set that silently shrinks is this repo's most expensive shape. */
  byFeature: { feature: string; label: string; calls: number; tokens: number }[];
  byPerson: { who: string; calls: number; tokens: number }[];
};

/** Display names for the four known callers. Deliberately a lookup with a
 * fallback rather than an exhaustive Record: a feature added later must
 * still appear on the page, under its own name, rather than vanish. */
const FEATURE_LABELS: Record<string, string> = {
  ask: "Ask",
  "wip-narrative": "WIP narrative",
  "compliance-extract": "Document extraction",
  "draft-estimate-lines": "Estimate drafting",
};

/** The last thirty days for the settings page, grouped by who asked.
 * Counted in the database, named from the User rows that still exist. */
export async function usageSummary(companyId: string, now: Date = new Date()): Promise<UsageSummary> {
  const since = new Date(now.getTime() - 30 * DAY);
  // `.catch` rather than a try/catch around an annotated variable:
  // groupBy's return type is inferred from its argument, and annotating
  // the binding to hoist it out of a try block breaks that inference.
  // This also keeps the guard on exactly ONE call — a failure in the User
  // lookup below is not this defect and must still throw, since an
  // unreadable User means the person is not signed in and this page never
  // rendered.
  const groups = await prisma.askUsage
    .groupBy({
      by: ["userId", "feature"],
      where: { companyId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    })
    .catch((err: unknown) => {
      usageUnreadable("the usage figures could not be read for the settings page", err);
      return null;
    });
  if (groups === null) {
    return {
      readable: false,
      questions: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      byFeature: [],
      byPerson: [],
    };
  }
  const ids = groups.map((g) => g.userId).filter((id): id is string => id !== null);
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const tokensOf = (g: (typeof groups)[number]) =>
    (g._sum.inputTokens ?? 0) + (g._sum.outputTokens ?? 0);

  // One row per person and per feature comes back, so both breakdowns fold
  // out of the same query rather than a second one.
  const perPerson = new Map<string, { who: string; calls: number; tokens: number }>();
  const perFeature = new Map<string, { feature: string; label: string; calls: number; tokens: number }>();
  for (const g of groups) {
    const who = (g.userId && nameOf.get(g.userId)) || "a removed account";
    const person = perPerson.get(who) ?? { who, calls: 0, tokens: 0 };
    person.calls += g._count._all;
    person.tokens += tokensOf(g);
    perPerson.set(who, person);

    const feature = perFeature.get(g.feature) ?? {
      feature: g.feature,
      label: FEATURE_LABELS[g.feature] ?? g.feature,
      calls: 0,
      tokens: 0,
    };
    feature.calls += g._count._all;
    feature.tokens += tokensOf(g);
    perFeature.set(g.feature, feature);
  }

  return {
    readable: true,
    questions: groups.reduce((n, g) => n + (g.feature === "ask" ? g._count._all : 0), 0),
    calls: groups.reduce((n, g) => n + g._count._all, 0),
    inputTokens: groups.reduce((n, g) => n + (g._sum.inputTokens ?? 0), 0),
    outputTokens: groups.reduce((n, g) => n + (g._sum.outputTokens ?? 0), 0),
    byFeature: [...perFeature.values()].sort((a, b) => b.calls - a.calls),
    byPerson: [...perPerson.values()].sort((a, b) => b.calls - a.calls),
  };
}
